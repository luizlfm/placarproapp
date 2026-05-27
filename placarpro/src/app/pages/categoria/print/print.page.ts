import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ModalController, PopoverController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import {
  ClassificacaoService,
  ClassificacaoGrupo,
  LinhaClassificacao,
} from '../../../campeonatos/classificacao.service';
import { RankingsService, LinhaRanking, TipoRanking } from '../../../campeonatos/rankings.service';
import { FasesService } from '../../../campeonatos/fases.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { Fase } from '../../../campeonatos/models/fase.model';
import { NavBackService } from '../../../shared/nav-back.service';
import {
  ExportarEquipesPopoverComponent,
  AcaoExportarEquipes,
} from './exportar-equipes-popover/exportar-equipes-popover.component';
import {
  ColunasEquipesModalComponent,
  ColunaEquipe,
  COLUNAS_EQUIPES_PADRAO,
} from './colunas-equipes-modal/colunas-equipes-modal.component';
import { FaseEquipesModalComponent } from './fase-equipes-modal/fase-equipes-modal.component';
import {
  ColunasJogadoresModalComponent,
  ColunaJogador,
  COLUNAS_JOGADORES_PADRAO,
} from './colunas-jogadores-modal/colunas-jogadores-modal.component';

export type TipoRelatorio =
  | 'equipes'
  | 'jogadores'
  | 'partidas'
  | 'classificacao'
  | 'rankings';

interface EquipeView extends Equipe {
  qtdJogadores: number;
  /** Estatísticas vindas da classificação — populadas pra colunas de pontos. */
  stats?: LinhaClassificacao;
}

interface GrupoJogadores {
  equipe: Equipe;
  jogadores: Jogador[];
}

interface JogoView extends Jogo {
  nomeMandante: string;
  nomeVisitante: string;
  logoMandante?: string;
  logoVisitante?: string;
}

/** Grupo de partidas para exibir com sub-header (1ª Fase · Rodada 1). */
interface GrupoPartidas {
  fase: string;
  rodada: number | null;
  partidas: JogoView[];
}

interface PrintView {
  campeonato?: Campeonato;
  categoria?: Categoria;
  equipes: EquipeView[];
  gruposJogadores: GrupoJogadores[];
  partidas: JogoView[];
  /** Partidas agrupadas por fase + rodada para sub-headers no relatório. */
  gruposPartidas: GrupoPartidas[];
  classificacao: ClassificacaoGrupo[];
  rankingArtilharia: LinhaRanking[];
  rankingAssistencias: LinhaRanking[];
  rankingAmarelos: LinhaRanking[];
  rankingVermelhos: LinhaRanking[];
}

/** Configuração de cada ranking exibível no relatório tipo='rankings'. */
export interface RankingOpcao {
  id: TipoRanking;
  label: string;
  icone: string;
  colunaTotal: string;
  selecionado: boolean;
}

/**
 * Página dedicada de impressão. Renderiza um layout limpo A4 dependendo
 * do `tipo` na URL: equipes | jogadores | partidas | classificacao | rankings.
 *
 * O usuário clica em "Imprimir" no toolbar pra disparar `window.print()`.
 * Tudo no shell (sidebar/header) é escondido via classe `.no-print` e
 * `@media print` na própria página.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/print/:tipo`
 */
@Component({
  selector: 'app-relatorio-print',
  templateUrl: './print.page.html',
  styleUrls: ['./print.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PrintPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly classifSrv = inject(ClassificacaoService);
  private readonly rankingsSrv = inject(RankingsService);
  private readonly fasesSrv = inject(FasesService);
  private readonly navBack = inject(NavBackService);
  private readonly popCtrl = inject(PopoverController);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';
  readonly tipo: TipoRelatorio =
    (this.route.snapshot.paramMap.get('tipo') as TipoRelatorio) ?? 'equipes';

  /** Colunas selecionadas para o relatório de equipes. */
  colunas: ColunaEquipe[] = COLUNAS_EQUIPES_PADRAO.map(c => ({ ...c }));
  /** Colunas selecionadas para o relatório de jogadores. */
  colunasJogadores: ColunaJogador[] = COLUNAS_JOGADORES_PADRAO.map(c => ({ ...c }));

  /**
   * IDs das equipes incluídas no relatório de jogadores.
   * `null` significa "ainda não inicializado" — na primeira renderização,
   * todas as equipes ficam marcadas.
   */
  equipesJogadoresIds: Set<string> | null = null;

  /** Fase atualmente filtrada (null = todas). */
  faseAtual: Fase | null = null;
  /** Lista de fases disponíveis (carregada uma vez no ngOnInit). */
  fasesDisponiveis: Fase[] = [];

  /** Subject que dispara recomputação da classificação quando a fase muda. */
  private readonly faseSubject = new BehaviorSubject<Fase | null>(null);

  /**
   * Rankings disponíveis para o relatório tipo='rankings'. Usuário pode marcar/desmarcar
   * cada um na barra de controles do topo.
   */
  rankings: RankingOpcao[] = [
    { id: 'artilharia',  label: 'Artilharia',         icone: 'football-outline',    colunaTotal: 'Gols',      selecionado: true  },
    { id: 'assistencia', label: 'Assistências',       icone: 'hand-right-outline',  colunaTotal: 'Assist.',   selecionado: true  },
    { id: 'amarelos',    label: 'Cartões Amarelos',   icone: 'square-outline',      colunaTotal: 'Amarelos',  selecionado: false },
    { id: 'vermelhos',   label: 'Cartões Vermelhos',  icone: 'square-outline',      colunaTotal: 'Vermelhos', selecionado: false },
  ];

  view$: Observable<PrintView | undefined> = of(undefined);

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) return;
    this.view$ = this.montarView();
    void this.carregarFases();
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'relatorios',
    ]);
  }

  imprimir(): void {
    window.print();
  }

  // ====================== POPOVER + MODAIS DE EQUIPES ======================

  /** Abre o popover "Exportar" (apenas pra tipo='equipes'). */
  async abrirPopoverExportar(ev: Event): Promise<void> {
    const pop = await this.popCtrl.create({
      component: ExportarEquipesPopoverComponent,
      event: ev,
      componentProps: { temFases: this.fasesDisponiveis.length > 0 },
      cssClass: 'exportar-popover',
      showBackdrop: false,
    });
    await pop.present();
    const { data } = await pop.onDidDismiss<{ acao?: AcaoExportarEquipes }>();
    switch (data?.acao) {
      case 'colunas': void this.abrirModalColunas(); break;
      case 'fase': void this.abrirModalFase(); break;
      case 'excel': void this.exportarCsv(); break;
      case 'imprimir': this.imprimir(); break;
    }
  }

  private async abrirModalColunas(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ColunasEquipesModalComponent,
      componentProps: { colunas: this.colunas.map(c => ({ ...c })) },
      breakpoints: [0, 0.85, 1],
      initialBreakpoint: 0.85,
      cssClass: 'colunas-equipes-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ colunas?: ColunaEquipe[] }>();
    if (role === 'save' && data?.colunas) {
      this.colunas = data.colunas;
    }
  }

  private async abrirModalFase(): Promise<void> {
    if (this.fasesDisponiveis.length === 0) {
      await this.toast('Nenhuma fase cadastrada nesta categoria.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: FaseEquipesModalComponent,
      componentProps: {
        fases: this.fasesDisponiveis,
        faseAtualId: this.faseAtual?.id ?? null,
      },
      breakpoints: [0, 0.6, 1],
      initialBreakpoint: 0.6,
      cssClass: 'fase-equipes-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ faseId?: string | null }>();
    if (role === 'save') {
      const id = data?.faseId ?? null;
      this.faseAtual = id ? this.fasesDisponiveis.find(f => f.id === id) ?? null : null;
      this.faseSubject.next(this.faseAtual);
    }
  }

  /** Indica se uma coluna está marcada para exibir. */
  colunaAtiva(id: string): boolean {
    return this.colunas.find(c => c.id === id)?.selecionado ?? false;
  }

  // ====================== MODAL DE COLUNAS — JOGADORES ======================

  /** Abre o modal de seleção de colunas pra impressão de jogadores. */
  async abrirModalColunasJogadores(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ColunasJogadoresModalComponent,
      componentProps: { colunas: this.colunasJogadores.map(c => ({ ...c })) },
      breakpoints: [0, 0.85, 1],
      initialBreakpoint: 0.85,
      cssClass: 'colunas-jogadores-modal',
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ colunas?: ColunaJogador[] }>();
    if (role === 'save' && data?.colunas) {
      this.colunasJogadores = data.colunas;
    }
  }

  /** True se a coluna de jogadores está marcada (usado pra *ngIf no template). */
  colunaJogAtiva(id: string): boolean {
    return this.colunasJogadores.find(c => c.id === id)?.selecionado ?? false;
  }

  /** Total de colunas visíveis na tabela de jogadores (inclui o # fixo). */
  totalColunasJogVisiveis(): number {
    return 1 /* coluna # */ + this.colunasJogadores.filter(c => c.selecionado).length;
  }

  /** Alterna uma coluna de jogadores direto pela barra de controles. */
  alternarColunaJogador(c: ColunaJogador): void {
    c.selecionado = !c.selecionado;
  }

  /** Marca/desmarca todas as colunas de jogadores de uma vez. */
  marcarTodasColunasJogadores(marcar: boolean): void {
    this.colunasJogadores = this.colunasJogadores.map(c => ({ ...c, selecionado: marcar }));
  }

  /**
   * Inicializa o set de equipes na primeira renderização — todas começam marcadas.
   * Chamado pelo template via `*ngIf="inicializarEquipesJog(v.gruposJogadores)"`.
   */
  inicializarEquipesJog(grupos: GrupoJogadores[]): boolean {
    if (this.equipesJogadoresIds === null) {
      this.equipesJogadoresIds = new Set(
        grupos.map(g => g.equipe.id).filter((id): id is string => !!id),
      );
    }
    return true;
  }

  /** True se a equipe está marcada para incluir no relatório. */
  equipeJogAtiva(equipeId?: string): boolean {
    if (!equipeId) return false;
    return this.equipesJogadoresIds?.has(equipeId) ?? true;
  }

  /** Alterna a inclusão de uma equipe no relatório. */
  alternarEquipeJog(equipeId?: string): void {
    if (!equipeId || !this.equipesJogadoresIds) return;
    if (this.equipesJogadoresIds.has(equipeId)) {
      this.equipesJogadoresIds.delete(equipeId);
    } else {
      this.equipesJogadoresIds.add(equipeId);
    }
    // Força re-render criando novo Set (referência diferente para CD)
    this.equipesJogadoresIds = new Set(this.equipesJogadoresIds);
  }

  /** Marca/desmarca TODAS as equipes (atalho da barra). */
  marcarTodasEquipesJog(grupos: GrupoJogadores[], marcar: boolean): void {
    if (marcar) {
      this.equipesJogadoresIds = new Set(
        grupos.map(g => g.equipe.id).filter((id): id is string => !!id),
      );
    } else {
      this.equipesJogadoresIds = new Set<string>();
    }
  }

  /** Quantas equipes estão marcadas? — usado pra aviso quando nenhuma. */
  get totalEquipesJogSelecionadas(): number {
    return this.equipesJogadoresIds?.size ?? 0;
  }

  /** TrackBy para a barra de chips de equipes. */
  trackByEquipeId(_i: number, g: GrupoJogadores): string {
    return g.equipe.id ?? '';
  }

  /** TrackBy para a barra de chips de colunas de jogadores. */
  trackByColunaJog(_i: number, c: ColunaJogador): string {
    return c.id;
  }

  /** Alterna uma coluna direto pela barra de controles (sem abrir modal). */
  alternarColuna(c: ColunaEquipe): void {
    c.selecionado = !c.selecionado;
  }

  /** Marca/desmarca todas as colunas — usado pelos botões "Marcar todas" e "Limpar". */
  marcarTodasColunas(marcar: boolean): void {
    this.colunas = this.colunas.map(c => ({ ...c, selecionado: marcar }));
  }

  /** Aplica filtro de fase pela barra de chips no topo. */
  filtrarFase(f: Fase | null): void {
    this.faseAtual = f;
    this.faseSubject.next(f);
  }

  /** Wrapper público para o botão "Excel" da barra superior. */
  exportarCsvPublico(): void {
    void this.exportarCsv();
  }

  // ====================== RANKINGS — seleção ======================

  /** Indica se o ranking `id` está marcado para imprimir. */
  rankingAtivo(id: TipoRanking): boolean {
    return this.rankings.find(r => r.id === id)?.selecionado ?? false;
  }

  /** Alterna a seleção do ranking pela barra de controles. */
  alternarRanking(r: RankingOpcao): void {
    r.selecionado = !r.selecionado;
  }

  /** Marca/desmarca todos os rankings de uma vez. */
  marcarTodosRankings(marcar: boolean): void {
    this.rankings = this.rankings.map(r => ({ ...r, selecionado: marcar }));
  }

  /** Retorna os dados do ranking conforme tipo, para a tabela do template. */
  dadosRanking(view: PrintView, tipo: TipoRanking): LinhaRanking[] {
    switch (tipo) {
      case 'artilharia':  return view.rankingArtilharia;
      case 'assistencia': return view.rankingAssistencias;
      case 'amarelos':    return view.rankingAmarelos;
      case 'vermelhos':   return view.rankingVermelhos;
      default:            return [];
    }
  }

  /** Quantos rankings estão marcados? — usado pra exibir aviso quando nenhum. */
  get totalRankingsSelecionados(): number {
    return this.rankings.filter(r => r.selecionado).length;
  }

  /** TrackBy para a barra de chips de rankings. */
  trackByRanking(_i: number, r: RankingOpcao): TipoRanking {
    return r.id;
  }

  /** Quantas colunas estão visíveis (colspan de "empty"). */
  totalColunasVisiveis(): number {
    const visiveis = this.colunas.filter(c => c.selecionado).length;
    return Math.max(1, visiveis);
  }

  /** Formato pro gols-average na tabela e CSV. */
  golsAverage(stats?: LinhaClassificacao): string {
    if (!stats) return '—';
    if (stats.golsContra === 0) return stats.golsPro > 0 ? '∞' : '—';
    return (stats.golsPro / stats.golsContra).toFixed(2);
  }

  /** Rótulo da fase atualmente filtrada (mostrado no header da folha). */
  rotuloFaseAtual(): string {
    return this.faseAtual ? this.faseAtual.nome : 'Todas as fases';
  }

  /** URL absoluta da tela de edição da equipe — usada na coluna "Link". */
  linkEditarEquipe(eq: EquipeView): string {
    if (!eq.id || typeof window === 'undefined') return '';
    return `${window.location.origin}/app/campeonato/${this.campeonatoId}/categoria/${this.categoriaId}/equipes`;
  }

  // ====================== CSV / EXCEL ======================

  /**
   * Gera CSV (separador ; — Excel BR) com BOM UTF-8 e baixa.
   * Usa as colunas marcadas pelo usuário.
   */
  async exportarCsv(): Promise<void> {
    const view = await firstValueFrom(this.view$);
    if (!view) {
      await this.toast('Aguarde os dados carregarem.', 'danger');
      return;
    }
    const selecionadas = this.colunas.filter(c => c.selecionado);
    if (selecionadas.length === 0) {
      await this.toast('Selecione ao menos uma coluna em "Selecionar colunas".', 'danger');
      return;
    }

    const cabecalho = selecionadas.map(c => c.label);
    const linhas = view.equipes.map(eq => selecionadas.map(c => this.valorCsv(c.id, eq)));

    const csv = [cabecalho, ...linhas]
      .map(linha => linha.map(escapeCsv).join(';'))
      .join('\r\n');

    const conteudo = '﻿' + csv; // BOM UTF-8 para Excel
    const nome = `equipes-${slugify(view.campeonato?.titulo ?? 'campeonato')}.csv`;
    baixarArquivo(conteudo, nome, 'text/csv;charset=utf-8');
    await this.toast('Arquivo gerado.', 'success');
  }

  private valorCsv(id: string, eq: EquipeView): string {
    switch (id) {
      case 'nome': return eq.nome ?? '';
      case 'escudo': return eq.logoUrl ?? '';
      case 'tecnico': return eq.tecnico ?? '';
      case 'link': return this.linkEditarEquipe(eq);
      case 'pontos': return String(eq.stats?.pontos ?? '');
      case 'jogos': return String(eq.stats?.jogos ?? '');
      case 'vitorias': return String(eq.stats?.vitorias ?? '');
      case 'empates': return String(eq.stats?.empates ?? '');
      case 'derrotas': return String(eq.stats?.derrotas ?? '');
      case 'golsPro': return String(eq.stats?.golsPro ?? '');
      case 'golsContra': return String(eq.stats?.golsContra ?? '');
      case 'saldoGols': return String(eq.stats?.saldoGols ?? '');
      case 'golsAverage': return this.golsAverage(eq.stats);
      case 'aproveitamento':
        return eq.stats != null ? `${Math.round(eq.stats.aproveitamento)}%` : '';
      default: return '';
    }
  }

  private async carregarFases(): Promise<void> {
    try {
      const fases = await firstValueFrom(
        this.fasesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
          startWith<Fase[]>([]),
          catchError(() => of<Fase[]>([])),
        ),
      );
      this.fasesDisponiveis = fases.filter(f => !!f.id);
    } catch {
      this.fasesDisponiveis = [];
    }
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }

  hojeBr(): string {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  }

  /** Rótulo do tipo pra cabeçalho da folha. */
  tituloTipo(): string {
    switch (this.tipo) {
      case 'equipes': return 'Relação de Equipes';
      case 'jogadores': return 'Relação de Jogadores';
      case 'partidas': return 'Tabela de Partidas';
      case 'classificacao': return 'Classificação';
      case 'rankings': return 'Rankings';
    }
  }

  /** Mostra DD/MM/YYYY a partir de ISO. */
  formatarData(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}/${mm}/${d.getFullYear()}`;
    } catch {
      return iso;
    }
  }

  /** Mostra HH:MM a partir de ISO. */
  formatarHora(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${hh}:${mi}`;
    } catch {
      return '';
    }
  }

  /** Rótulo curto de status. */
  rotuloStatus(s?: string): string {
    switch (s) {
      case 'encerrado': return 'Encerrado';
      case 'em-andamento': return 'Em andamento';
      case 'agendado': return 'Agendado';
      case 'cancelado': return 'Cancelado';
      case 'wo': return 'W.O.';
      default: return s ?? '—';
    }
  }

  /** Classe CSS para o badge de status (usada na coluna Status do relatório). */
  classeStatus(s?: string): string {
    switch (s) {
      case 'encerrado':    return 'st-encerrado';
      case 'em-andamento': return 'st-andamento';
      case 'agendado':     return 'st-agendado';
      case 'cancelado':    return 'st-cancelado';
      case 'wo':           return 'st-wo';
      default:             return '';
    }
  }

  /** Rótulo da fase + rodada (ex.: "1ª Fase · Rodada 1"). */
  rotuloGrupoPartidas(g: GrupoPartidas): string {
    const partes: string[] = [];
    if (g.fase) partes.push(g.fase);
    if (g.rodada != null) partes.push(`Rodada ${g.rodada}`);
    return partes.join(' · ') || 'Sem fase definida';
  }

  private montarView(): Observable<PrintView | undefined> {
    const safe = <T>(o$: Observable<T>, fb: T): Observable<T> =>
      o$.pipe(startWith(fb), catchError(() => of(fb)));

    const campeonato$ = safe(this.campsSrv.get$(this.campeonatoId), undefined as Campeonato | undefined);
    const categoria$  = safe(this.catsSrv.get$(this.campeonatoId, this.categoriaId), undefined as Categoria | undefined);
    const equipes$    = safe(this.equipesSrv.list$(this.campeonatoId, this.categoriaId), [] as Equipe[]);
    const jogadores$  = safe(this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId), [] as Jogador[]);
    const jogos$      = safe(this.jogosSrv.list$(this.campeonatoId, this.categoriaId), [] as Jogo[]);
    // Classificação reage à fase selecionada (faseSubject) — refaz quando muda.
    const classif$ = this.faseSubject.pipe(
      switchMap(fase =>
        safe(
          this.classifSrv.classificacao$(this.campeonatoId, this.categoriaId, fase, false),
          [] as ClassificacaoGrupo[],
        ),
      ),
    );
    const rArt$ = safe(
      this.rankingsSrv.ranking$(this.campeonatoId, this.categoriaId, 'artilharia' as TipoRanking),
      [] as LinhaRanking[],
    );
    const rAss$ = safe(
      this.rankingsSrv.ranking$(this.campeonatoId, this.categoriaId, 'assistencia' as TipoRanking),
      [] as LinhaRanking[],
    );
    const rAm$ = safe(
      this.rankingsSrv.ranking$(this.campeonatoId, this.categoriaId, 'amarelos' as TipoRanking),
      [] as LinhaRanking[],
    );
    const rVm$ = safe(
      this.rankingsSrv.ranking$(this.campeonatoId, this.categoriaId, 'vermelhos' as TipoRanking),
      [] as LinhaRanking[],
    );

    return combineLatest([
      campeonato$, categoria$, equipes$, jogadores$, jogos$, classif$, rArt$, rAss$, rAm$, rVm$,
    ]).pipe(
      map(([camp, cat, equipes, jogadores, jogos, classif, rArt, rAss, rAm, rVm]) => {
        // Indexa estatísticas por equipeId.
        const statsPorEquipe = new Map<string, LinhaClassificacao>();
        for (const g of classif) {
          for (const l of g.linhas) {
            if (l.equipe.id) statsPorEquipe.set(l.equipe.id, l);
          }
        }

        const equipesView: EquipeView[] = [...equipes]
          .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'))
          .map(e => ({
            ...e,
            qtdJogadores: jogadores.filter(j => j.equipeId === e.id).length,
            stats: e.id ? statsPorEquipe.get(e.id) : undefined,
          }));

        const gruposJogadores: GrupoJogadores[] = equipesView.map(eq => ({
          equipe: eq,
          jogadores: jogadores
            .filter(j => j.equipeId === eq.id)
            .sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
        }));

        const partidas: JogoView[] = [...jogos]
          .sort((a, b) => {
            const fA = (a.fase ?? '').localeCompare(b.fase ?? '', 'pt-BR');
            if (fA !== 0) return fA;
            const rA = (a.rodada ?? 0) - (b.rodada ?? 0);
            if (rA !== 0) return rA;
            return (a.dataHora ?? '').localeCompare(b.dataHora ?? '');
          })
          .map(j => {
            const eqM = equipes.find(e => e.id === j.mandanteId);
            const eqV = equipes.find(e => e.id === j.visitanteId);
            return {
              ...j,
              nomeMandante: eqM?.nome ?? '— Equipe não definida —',
              nomeVisitante: eqV?.nome ?? '— Equipe não definida —',
              logoMandante: eqM?.logoUrl,
              logoVisitante: eqV?.logoUrl,
            };
          });

        // Agrupa por fase + rodada pra criar sub-headers no relatório.
        // Mantém a ordem natural já estabelecida pelo sort acima.
        const gruposPartidas: GrupoPartidas[] = [];
        for (const p of partidas) {
          const fase = p.fase ?? '';
          const rodada = p.rodada ?? null;
          const ultimo = gruposPartidas[gruposPartidas.length - 1];
          if (ultimo && ultimo.fase === fase && ultimo.rodada === rodada) {
            ultimo.partidas.push(p);
          } else {
            gruposPartidas.push({ fase, rodada, partidas: [p] });
          }
        }

        return {
          campeonato: camp,
          categoria: cat,
          equipes: equipesView,
          gruposJogadores,
          partidas,
          gruposPartidas,
          classificacao: classif,
          rankingArtilharia: rArt,
          rankingAssistencias: rAss,
          rankingAmarelos: rAm,
          rankingVermelhos: rVm,
        };
      }),
    );
  }

  trackByEquipe(_i: number, e: Equipe): string { return e.id ?? ''; }
  trackByJogador(_i: number, j: Jogador): string { return j.id ?? ''; }
  trackByJogo(_i: number, j: Jogo): string { return j.id ?? ''; }
  trackByGrupo(_i: number, g: GrupoJogadores): string { return g.equipe.id ?? ''; }
  trackByGrupoPartidas(_i: number, g: GrupoPartidas): string {
    return `${g.fase}|${g.rodada ?? ''}`;
  }
  trackByLinhaRanking(_i: number, l: LinhaRanking): string {
    return l.jogador.id ?? `${_i}`;
  }
  trackByColuna(_i: number, c: ColunaEquipe): string {
    return c.id;
  }
}

// ============== Helpers CSV =================

function escapeCsv(v: string | number): string {
  const s = String(v ?? '');
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'arquivo'
  );
}

function baixarArquivo(conteudo: string, nome: string, mime: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
