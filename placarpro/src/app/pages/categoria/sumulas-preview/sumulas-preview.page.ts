import { Component, ElementRef, HostBinding, HostListener, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import {
  ArbitroJogo,
  EventoJogo,
  EventoTipo,
  FuncaoArbitro,
  Jogo,
} from '../../../campeonatos/models/jogo.model';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { NavBackService } from '../../../shared/nav-back.service';

/** Modelos visuais de súmula disponíveis. Adicione um novo valor aqui
 *  + entrada em `modelosSumula` + entrada em `mapaModalidadeModelo` +
 *  bloco HTML correspondente no template pra suportar. */
export type ModeloSumula =
  | 'padrao'
  | 'futsal'
  | 'handebol'
  | 'basquete'
  | 'volei'
  | 'raquete';

interface LinhaSelecao {
  jogo: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  dataBr: string;
  fase: string;
}

interface JogadorEscalado {
  jogador: Jogador;
  amarelos: number;
  vermelhos: number;
  gols: number;
}

interface SumulaView {
  jogo: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  escMandante: JogadorEscalado[];
  escVisitante: JogadorEscalado[];
  arbitros: ArbitroJogo[];
}

/**
 * Página de impressão MÚLTIPLA de súmulas (padrão carteirinhas-preview):
 *  - Header com "Imprimir" + voltar
 *  - Painel lateral à esquerda com lista de partidas (checkboxes)
 *  - Área principal renderiza UMA súmula por partida selecionada
 *  - Cada súmula tem `page-break-after: always` na impressão
 *  - Ctrl+P imprime TODAS de uma vez
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/sumulas`
 */
@Component({
  selector: 'app-sumulas-preview',
  templateUrl: './sumulas-preview.page.html',
  styleUrls: ['./sumulas-preview.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class SumulasPreviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly navBack = inject(NavBackService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';

  campeonato?: Campeonato;
  categoria?: Categoria;
  /** Todos os jogos da categoria — exibidos no painel pra seleção. */
  linhas: LinhaSelecao[] = [];
  /** IDs selecionados pra imprimir. */
  selecionadas = new Set<string>();
  /** Mapa de jogadores por equipeId (usado pelas escalações). */
  private jogadoresPorEquipe = new Map<string, Jogador[]>();
  /** Cache de eventos por jogoId (resolvido sob demanda). */
  private eventosCache = new Map<string, EventoJogo[]>();

  /** Súmulas montadas pra renderizar (uma por jogoId selecionado). */
  sumulas: SumulaView[] = [];

  /** Painel aberto/fechado (mobile). */
  painelAberto = true;
  loading = true;
  busca = '';
  /** ID do jogo sendo visualizado em modo "preview individual" (overlay). */
  verSumulaId: string | null = null;

  /** Quando o overlay está aberto, adiciona uma classe no :host pra que
   *  o CSS esconda o page header e dê tela cheia ao modal. */
  @HostBinding('class.visualizando') get classeVisualizando(): boolean {
    return !!this.verSumulaId;
  }
  /** Cache de views de súmula pra visualização individual rápida (sem
   *  precisar estar selecionada). */
  private viewIndividualCache = new Map<string, SumulaView>();

  /** Helpers pra template */
  readonly NUMEROS_13 = Array.from({ length: 13 }, (_, i) => i + 1);
  readonly NUMEROS_13_2 = Array.from({ length: 13 }, (_, i) => i + 14);
  readonly COLUNAS_VAZIAS = Array.from({ length: 13 });
  readonly LINHAS_JOGADORES = 19;

  /**
   * Modelo (layout) de súmula. Adicione novos modelos aqui e crie o
   * bloco visual no HTML com `*ngIf="modeloSelecionado === 'X'"`.
   *
   *  - `padrao`:    layout original (FALTAS 1-5 + ACUMULATIVAS 1-7).
   *                 Bom pra futebol/futebol 7 (esporte de campo).
   *  - `futsal`:    modelo SICOOB (ACUMULATIVAS 1-5, X centralizado,
   *                 TÉCNICO/CAPITÃO vertical na lateral).
   *  - `handebol`:  2 períodos de 30min, 7 jogadores em campo, cartões.
   *  - `basquete`:  4 quartos, faltas pessoais (max 5) + faltas de equipe.
   *  - `volei`:     5 sets de 25 pts, pedidos de tempo, sem cartões.
   *  - `raquete`:   tênis/mesa/beach — sets+games+tiebreak.
   */
  readonly modelosSumula: { id: ModeloSumula; label: string }[] = [
    { id: 'padrao',   label: 'Padrão (Futebol)' },
    { id: 'futsal',   label: 'Futsal' },
    { id: 'handebol', label: 'Handebol' },
    { id: 'basquete', label: 'Basquetebol' },
    { id: 'volei',    label: 'Vôlei' },
    { id: 'raquete',  label: 'Tênis / Raquete' },
  ];
  /** Modelo atualmente selecionado — auto-detectado pela modalidade na
   *  `ngOnInit`, e alterável pelo dropdown no header da preview. */
  modeloSelecionado: ModeloSumula = 'padrao';

  /** Sequências numéricas reutilizadas em vários templates. */
  readonly NUMEROS_1_5 = Array.from({ length: 5 }, (_, i) => i + 1);
  /** Sets/quartos/games — usado em handebol (2 períodos), basquete
   *  (4 quartos), vôlei (5 sets), tênis (5 sets). Renderiza só os
   *  primeiros N conforme o esporte. */
  readonly SETS_5 = Array.from({ length: 5 }, (_, i) => i + 1);
  readonly QUARTOS_4 = Array.from({ length: 4 }, (_, i) => i + 1);
  readonly PERIODOS_2 = Array.from({ length: 2 }, (_, i) => i + 1);

  /**
   * Mapa modalidade → modelo de súmula. Centraliza o auto-detect no
   * `ngOnInit`. Modalidades sem entrada caem no `padrao`. Adicione
   * aqui quando criar template novo. */
  private readonly mapaModalidadeModelo: Record<string, ModeloSumula> = {
    futebol:        'padrao',
    futebol7:       'padrao',
    futsal:         'futsal',
    handebol:       'handebol',
    basquete:       'basquete',
    basquetebol:    'basquete',
    volei:          'volei',
    voleiPraia:     'volei',
    futevolei:      'volei',
    tenis:          'raquete',
    tenisMesa:      'raquete',
    beachTennis:    'raquete',
  };

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) {
      this.loading = false;
      return;
    }
    try {
      const [camp, cat, jogos, equipes, jogadores] = await Promise.all([
        firstValueFrom(this.campsSrv.get$(this.campeonatoId)),
        firstValueFrom(this.catsSrv.get$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.jogosSrv.list$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId)),
      ]);
      this.campeonato = camp;
      this.categoria = cat;

      // Auto-detecta modelo pelo esporte da categoria — o user ainda
      // pode trocar manualmente no dropdown. Modalidades não-mapeadas
      // caem em `padrao` (genérico).
      const modAuto = cat?.modalidade
        ? this.mapaModalidadeModelo[cat.modalidade]
        : undefined;
      if (modAuto) {
        this.modeloSelecionado = modAuto;
      }

      // Index jogadores por equipe
      for (const j of jogadores) {
        if (!j.equipeId) continue;
        if (!this.jogadoresPorEquipe.has(j.equipeId)) {
          this.jogadoresPorEquipe.set(j.equipeId, []);
        }
        this.jogadoresPorEquipe.get(j.equipeId)!.push(j);
      }

      // Monta linhas pro painel de seleção
      const eqMap = new Map<string, Equipe>();
      equipes.forEach(e => e.id && eqMap.set(e.id, e));

      this.linhas = (jogos ?? [])
        .map(j => ({
          jogo: j,
          mandante: j.mandanteId ? eqMap.get(j.mandanteId) : undefined,
          visitante: j.visitanteId ? eqMap.get(j.visitanteId) : undefined,
          dataBr: j.dataHora ? j.dataHora.slice(0, 10).split('-').reverse().join('/') : '',
          fase: j.fase || 'Sem fase',
        }))
        .sort((a, b) => (a.jogo.dataHora || '￿').localeCompare(b.jogo.dataHora || '￿'));

      // Pré-seleciona via query param ?ids=a,b,c (vindo de outro fluxo)
      const idsParam = this.route.snapshot.queryParamMap.get('ids');
      if (idsParam) {
        idsParam.split(',').filter(Boolean).forEach(id => this.selecionadas.add(id));
        await this.recarregarSumulas();
      }
    } finally {
      this.loading = false;
    }
  }

  /** Toggle de seleção e re-render do preview. */
  async toggle(jogoId?: string): Promise<void> {
    if (!jogoId) return;
    if (this.selecionadas.has(jogoId)) {
      this.selecionadas.delete(jogoId);
    } else {
      this.selecionadas.add(jogoId);
    }
    await this.recarregarSumulas();
  }

  isSelecionada(jogoId?: string): boolean {
    return !!jogoId && this.selecionadas.has(jogoId);
  }

  async selecionarTodas(): Promise<void> {
    for (const l of this.linhasFiltradas) {
      if (l.jogo.id) this.selecionadas.add(l.jogo.id);
    }
    await this.recarregarSumulas();
  }

  async limparSelecao(): Promise<void> {
    this.selecionadas.clear();
    this.sumulas = [];
  }

  get qtdSelecionadas(): number {
    return this.selecionadas.size;
  }

  get linhasFiltradas(): LinhaSelecao[] {
    const t = this.busca.trim().toLowerCase();
    if (!t) return this.linhas;
    return this.linhas.filter(l =>
      (l.mandante?.nome ?? '').toLowerCase().includes(t) ||
      (l.visitante?.nome ?? '').toLowerCase().includes(t) ||
      l.fase.toLowerCase().includes(t),
    );
  }

  togglePainel(): void {
    this.painelAberto = !this.painelAberto;
  }

  async imprimir(): Promise<void> {
    if (this.selecionadas.size === 0) return;
    // Garante que o preview está sincronizado antes de imprimir
    if (this.sumulas.length !== this.selecionadas.size) {
      await this.recarregarSumulas();
    }
    setTimeout(() => window.print(), 50);
  }

  /**
   * Abre o overlay de visualização individual de uma súmula (icone "olho"
   * em cada card). Carrega os dados sob demanda — não precisa estar
   * selecionada pra visualizar.
   */
  async abrirVisualizacao(jogoId?: string): Promise<void> {
    if (!jogoId) return;
    if (!this.viewIndividualCache.has(jogoId) && !this.sumulas.find(s => s.jogo.id === jogoId)) {
      const linha = this.linhas.find(l => l.jogo.id === jogoId);
      if (linha) {
        const eventos = await this.getEventos(jogoId);
        this.viewIndividualCache.set(jogoId, this.montarSumulaView(linha, eventos));
      }
    }
    this.verSumulaId = jogoId;
    // Calcula a escala da rotação assim que abre (no próximo tick pra dar
    // tempo do template renderizar e o viewport estar correto).
    setTimeout(() => this.atualizarEscalaRotacao(), 50);
  }

  fecharVisualizacao(): void {
    this.verSumulaId = null;
  }

  /** Recalcula a escala da súmula rotacionada conforme o tamanho da tela.
   *  Mede a folha e o body do modal pra encaixar a folha rotacionada
   *  dentro do espaço visível disponível. Necessário porque scale() em
   *  CSS não aceita calc() com units. */
  @HostListener('window:resize')
  atualizarEscalaRotacao(): void {
    const host = this.host?.nativeElement;
    if (!host) return;

    const body = host.querySelector('.sp-modal-body') as HTMLElement | null;
    const folha = host.querySelector('.sp-modal-folha') as HTMLElement | null;

    // Fallback: viewport - estimativas de A4 paisagem (1097x794) caso a
    // folha ainda não tenha renderizado.
    let availW = window.innerWidth;
    let availH = window.innerHeight;
    let folhaW = 1097;
    let folhaH = 794;

    if (body) {
      availW = body.clientWidth || availW;
      availH = body.clientHeight || availH;
    }
    if (folha) {
      // offsetWidth/Height NÃO incluem transforms — refletem dimensões de layout.
      folhaW = folha.offsetWidth || folhaW;
      folhaH = folha.offsetHeight || folhaH;
    }

    // Pós-rotação 90°: a "largura visual" = folhaH e a "altura visual" = folhaW.
    const padding = 8; // margem de segurança
    const scaleW = (availW - padding) / folhaH;
    const scaleH = (availH - padding) / folhaW;
    const escala = Math.min(scaleW, scaleH, 1);
    host.style.setProperty('--sumula-escala', String(escala));
  }

  /** Retorna a view da súmula por ID — primeiro tenta no cache de selecionadas,
   *  senão no cache de visualização individual. */
  getSumulaPorId(jogoId: string | null): SumulaView | undefined {
    if (!jogoId) return undefined;
    return (
      this.sumulas.find(s => s.jogo.id === jogoId) ??
      this.viewIndividualCache.get(jogoId)
    );
  }

  /** Imprime APENAS a súmula no overlay aberto. Usamos uma classe no body
   *  pra esconder tudo no @media print exceto o overlay. */
  imprimirVisualizacaoUnica(): void {
    document.body.classList.add('printing-single');
    setTimeout(() => {
      window.print();
      // Remove a classe depois pra não afetar futuras impressões
      setTimeout(() => document.body.classList.remove('printing-single'), 500);
    }, 50);
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'config',
    ]);
  }

  // ─────────────────────────────────────────────────
  //  Construção das visualizações de súmula
  // ─────────────────────────────────────────────────

  /** Recarrega as views de súmula pras IDs selecionadas. */
  private async recarregarSumulas(): Promise<void> {
    const idsOrdenadas = this.linhas
      .filter(l => l.jogo.id && this.selecionadas.has(l.jogo.id))
      .map(l => l.jogo.id!);

    const views: SumulaView[] = [];
    for (const id of idsOrdenadas) {
      const linha = this.linhas.find(l => l.jogo.id === id);
      if (!linha) continue;
      const eventos = await this.getEventos(id);
      views.push(this.montarSumulaView(linha, eventos));
    }
    this.sumulas = views;
  }

  private async getEventos(jogoId: string): Promise<EventoJogo[]> {
    if (this.eventosCache.has(jogoId)) return this.eventosCache.get(jogoId)!;
    try {
      const evs = await firstValueFrom(
        this.jogosSrv.listEventos$(this.campeonatoId, this.categoriaId, jogoId),
      );
      this.eventosCache.set(jogoId, evs ?? []);
      return evs ?? [];
    } catch {
      this.eventosCache.set(jogoId, []);
      return [];
    }
  }

  private montarSumulaView(linha: LinhaSelecao, eventos: EventoJogo[]): SumulaView {
    const jogo = linha.jogo;
    const escMandante = this.montarEscalados(
      this.jogadoresPorEquipe.get(jogo.mandanteId ?? '') ?? [],
      eventos,
      jogo.mandanteId ?? '',
    );
    const escVisitante = this.montarEscalados(
      this.jogadoresPorEquipe.get(jogo.visitanteId ?? '') ?? [],
      eventos,
      jogo.visitanteId ?? '',
    );
    return {
      jogo,
      mandante: linha.mandante,
      visitante: linha.visitante,
      escMandante,
      escVisitante,
      arbitros: jogo.arbitros ?? [],
    };
  }

  private montarEscalados(
    jogadores: Jogador[],
    eventos: EventoJogo[],
    equipeId: string,
  ): JogadorEscalado[] {
    return jogadores
      .map(j => {
        const meus = eventos.filter(e => e.jogadorId === j.id && e.equipeId === equipeId);
        return {
          jogador: j,
          gols: meus.filter(e => e.tipo === 'gol').reduce((s, e) => s + (e.quantidade ?? 1), 0),
          amarelos: meus.filter(e => e.tipo === 'amarelo').length,
          vermelhos: meus.filter(e => e.tipo === 'vermelho').length,
        };
      })
      .sort((a, b) => (a.jogador.nome ?? '').localeCompare(b.jogador.nome ?? '', 'pt-BR'));
  }

  // ─────────────────────────────────────────────────
  //  Helpers do template
  // ─────────────────────────────────────────────────

  nomeCompleto(eq?: Equipe): string {
    if (!eq) return '';
    return eq.cidade ? `${eq.nome} (${eq.cidade})` : eq.nome;
  }

  cidadeEquipes(s: SumulaView): string {
    const cm = s.mandante?.cidade;
    const cv = s.visitante?.cidade;
    if (cm && cv && cm !== cv) return `${cm} / ${cv}`;
    return cm || cv || '';
  }

  arbitroPor(funcao: FuncaoArbitro, arbitros: ArbitroJogo[]): string {
    return arbitros.find(a => a.funcao === funcao)?.nome ?? '';
  }

  formatarSomenteData(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return iso;
    }
  }

  preencherLinhas(escalados: JogadorEscalado[], quantidade: number): (JogadorEscalado | undefined)[] {
    const out: (JogadorEscalado | undefined)[] = [...escalados];
    while (out.length < quantidade) out.push(undefined);
    return out.slice(0, Math.max(quantidade, out.length));
  }

  /**
   * Quantas linhas renderizar pros dois lados (mandante + visitante) —
   * SEMPRE o maior dos três valores:
   *  - quantidade de jogadores escalados no mandante
   *  - quantidade de jogadores escalados no visitante
   *  - mínimo do modelo (default: `LINHAS_JOGADORES` do padrão)
   *
   * Resultado: blocos A e B ficam com a MESMA altura visual; linhas
   * extras viram empty rows (`undefined`) renderizadas em branco.
   * Sem isso, equipes com 18 jogadores ficavam visualmente maiores que
   * equipes com 14 — desalinhando a folha A4.
   */
  linhasParaAmbas(s: SumulaView, minimo?: number): number {
    return Math.max(
      minimo ?? this.LINHAS_JOGADORES,
      s.escMandante?.length ?? 0,
      s.escVisitante?.length ?? 0,
    );
  }

  /** Mínimos por modelo — usado nas templates de cada esporte pra
   *  o `linhasParaAmbas(s, MIN_X)` sempre alinhar A e B. */
  readonly MIN_LINHAS_HANDEBOL = 14;
  readonly MIN_LINHAS_BASQUETE = 12;
  readonly MIN_LINHAS_VOLEI    = 14;
  readonly MIN_LINHAS_RAQUETE  = 4;

  trackBySumula(_i: number, s: SumulaView): string {
    return s.jogo.id ?? `${_i}`;
  }

  trackByLinha(_i: number, l: LinhaSelecao): string {
    return l.jogo.id ?? `${_i}`;
  }
}
