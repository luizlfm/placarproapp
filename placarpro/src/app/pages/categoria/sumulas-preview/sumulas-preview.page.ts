import { Component, ElementRef, HostBinding, HostListener, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import domtoimage from 'dom-to-image-more';
import { SumulaPage } from '../jogo-detalhe/sumula/sumula.page';
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
import { salvarPdf } from '../../../shared/pdf-download.helper';

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
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

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

  /**
   * URL data:image/png de cada súmula renderizada como imagem (preview
   * pixel-perfect ao PDF). Chave = jogoId. Quando setada, o template
   * mostra a img em vez do HTML cru.
   *
   * Idéia: gerar o PNG via mesma pipeline do `baixarPdf` (dom-to-image-more)
   * de modo que o usuário vê na tela EXATAMENTE o que sairá no PDF
   * — sem problemas de CSS (vertical-text, colunas desalinhadas, etc).
   */
  previewImagens: Record<string, string> = {};
  /** Flag global enquanto qualquer captura está rodando. */
  gerandoPreviews = false;

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

  /**
   * "Imprimir (N)" → gera um PDF MULTIPÁGINA (1 súmula por página,
   * A4 paisagem) via html2canvas + jsPDF e abre numa nova aba com
   * autoPrint() — o reader do PDF já dispara o diálogo de impressão.
   *
   * Por que NÃO usar `window.print()` direto:
   *   1. @media print é frágil — regras de viewport (max-width:900px)
   *      persistem durante o print, ion-content tem scroll interno,
   *      page-break-after às vezes é "engolido" por containers grid/flex.
   *   2. O resultado dependia do viewport do user — em mobile saía 1
   *      folha em branco. No desktop também acontecia em certos zooms.
   *
   * Vantagens do PDF programático:
   *   - SEM cabeçalho da página, SEM toolbar, SEM menu — só a folha pura
   *   - Mesma saída em web e mobile (não depende de viewport)
   *   - User pode salvar ou imprimir do reader do PDF
   *   - Funciona offline (jsPDF roda local)
   */
  async imprimir(): Promise<void> {
    return this.gerarPdfMultipage('print');
  }

  /**
   * Baixa o PDF multipágina diretamente, sem abrir diálogo.
   * Mesma pipeline do `imprimir()` mas chama `pdf.save()` no fim em
   * vez de `autoPrint + window.open`.
   */
  async baixarPdf(): Promise<void> {
    return this.gerarPdfMultipage('download');
  }

  /**
   * Núcleo compartilhado de imprimir() e baixarPdf().
   * Gera um PDF multipágina (1 súmula por página) e:
   *   - destino `print`: `pdf.autoPrint()` + abre em nova aba (browser
   *     dispara diálogo de impressão automaticamente)
   *   - destino `download`: `pdf.save(nome)` (download direto)
   */
  private async gerarPdfMultipage(destino: 'print' | 'download'): Promise<void> {
    if (this.selecionadas.size === 0) return;

    const loading = await this.loadingCtrl.create({
      message: `Gerando ${this.selecionadas.size} súmula${this.selecionadas.size > 1 ? 's' : ''}...`,
      spinner: 'crescent',
    });
    await loading.present();

    try {
      await this.recarregarSumulas();
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await this.aguardarImagens(5000);

      const rootInline = this.host.nativeElement as HTMLElement;
      await this.inlineImagens(rootInline);

      const root = this.host.nativeElement as HTMLElement;
      const folhas = Array.from(
        root.querySelectorAll<HTMLElement>('.sumula-folha'),
      ).filter(f => !f.hasAttribute('hidden'));

      if (folhas.length === 0) {
        throw new Error('Nenhuma súmula encontrada — selecione ao menos uma partida.');
      }

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < folhas.length; i++) {
        loading.message = `Gerando súmula ${i + 1} de ${folhas.length}...`;
        await new Promise<void>(r => setTimeout(r, 0));

        const dataUrl = await this.capturarFolhaParaPdf(folhas[i]);
        if (!dataUrl) continue;

        const tmpImg = new Image();
        await new Promise<void>((resolve, reject) => {
          tmpImg.onload = () => resolve();
          tmpImg.onerror = () => reject(new Error('falha png'));
          tmpImg.src = dataUrl;
        });

        const imgRatio = tmpImg.naturalHeight / tmpImg.naturalWidth;
        const imgW = pageW;
        let imgH = imgW * imgRatio;
        if (imgH > pageH) imgH = pageH;
        if (i > 0) pdf.addPage('a4', 'landscape');
        pdf.addImage(dataUrl, 'PNG', 0, 0, imgW, imgH);

        await new Promise<void>(r => setTimeout(r, 0));
      }

      if (destino === 'print') {
        pdf.autoPrint();
        const blobUrl = pdf.output('bloburl');
        window.open(blobUrl, '_blank');
      } else {
        // download direto — pdf.save() força via <a download>.
        // No iOS Safari, salvarPdf() usa Web Share API pra abrir share sheet
        // nativo (com opção "Salvar em Arquivos") em vez de abrir PDF inline.
        const nome = `sumulas-${this.campeonato?.titulo?.replace(/\s+/g, '_') || 'campeonato'}.pdf`;
        await salvarPdf(pdf, nome, this.toastCtrl, this.modalCtrl);
      }
    } catch (err) {
      console.error(`[${destino}] erro`, err);
      const t = await this.toastCtrl.create({
        message: 'Falha ao gerar PDF. Tente novamente.',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Captura uma `.sumula-folha` como PNG data URL via dom-to-image-more.
   * Clona pra container off-screen no body pra evitar constraints do
   * modal/preview, aplica bordas 0.5px inline pra ficar hairline no PDF.
   */
  private async capturarFolhaParaPdf(folhaOriginal: HTMLElement): Promise<string | null> {
    const offscreen = document.createElement('div');
    offscreen.style.cssText = `
      position: fixed;
      top: -10000px;
      left: 0;
      width: 290mm;
      background: #ffffff;
      pointer-events: none;
      z-index: -1;
    `;
    try {
      const folhaClone = folhaOriginal.cloneNode(true) as HTMLElement;
      folhaClone.style.transform = 'none';
      folhaClone.style.position = 'static';
      folhaClone.style.top = 'auto';
      folhaClone.style.left = 'auto';
      folhaClone.style.margin = '0';
      folhaClone.style.boxShadow = 'none';

      // Bordas finas inline.
      folhaClone.style.setProperty('border-width', '0.5px', 'important');
      folhaClone.querySelectorAll<HTMLElement>('*').forEach(el => {
        el.style.setProperty('border-width', '0.5px', 'important');
      });

      // Fix TÉCNICO/CAPITÃO rotacionado.
      folhaClone.querySelectorAll<HTMLElement>('.vertical-text').forEach(v => {
        const texto = (v.textContent || '').trim();
        if (!texto) return;
        v.style.writingMode = 'horizontal-tb';
        v.style.transform = 'none';
        v.style.position = 'relative';
        v.style.padding = '0';
        v.innerHTML =
          '<div style="position:absolute;top:50%;left:50%;' +
          'transform:translate(-50%,-50%) rotate(-90deg);' +
          'transform-origin:center center;white-space:nowrap;' +
          'font:inherit;color:inherit;">' +
          texto +
          '</div>';
      });

      offscreen.appendChild(folhaClone);
      document.body.appendChild(offscreen);

      // Aguarda layout + imagens do clone decodificarem.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      const imgsClone = Array.from(folhaClone.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgsClone.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const fin = (): void => resolve();
            img.addEventListener('load', fin, { once: true });
            img.addEventListener('error', fin, { once: true });
            setTimeout(fin, 2000);
          });
        }),
      );
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const rect = folhaClone.getBoundingClientRect();

      const dataUrl = await domtoimage.toPng(folhaClone, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scale: 3,
        cacheBust: false,
      });
      return dataUrl;
    } catch (err) {
      console.error('[capturarFolhaParaPdf] erro', err);
      return null;
    } finally {
      try {
        if (offscreen.parentNode) {
          offscreen.parentNode.removeChild(offscreen);
        }
      } catch { /* ignore */ }
    }
  }

  /**
   * Aguarda todas as `<img>` da página de súmulas (folhas + logos)
   * terminarem de carregar. Resolve quando todas terminam (sucesso
   * ou erro) ou quando o timeout expira.
   */
  private aguardarImagens(timeoutMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      const root = this.host.nativeElement as HTMLElement;
      const imgs = Array.from(
        root.querySelectorAll('.sumula-folha img'),
      ) as HTMLImageElement[];
      const pendentes = imgs.filter(img => !img.complete);
      if (pendentes.length === 0) return resolve();

      let restantes = pendentes.length;
      const fin = (): void => {
        restantes--;
        if (restantes <= 0) resolve();
      };
      pendentes.forEach(img => {
        img.addEventListener('load', fin, { once: true });
        img.addEventListener('error', fin, { once: true });
      });
      setTimeout(() => resolve(), timeoutMs);
    });
  }

  /**
   * Converte todas as `<img>` em base64 ANTES do html2canvas — sem isso
   * logos saem em branco no PDF. Usa novo `<Image>` com `crossOrigin =
   * 'anonymous'` + canvas pra extrair data URL (mais confiável que
   * fetch+FileReader, que esbarra em cache opaque).
   */
  private async inlineImagens(container: HTMLElement): Promise<void> {
    const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(
      imgs.map(async imgEl => {
        const src = imgEl.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        try {
          const dataUrl = await this.urlParaDataUrl(src);
          if (dataUrl) {
            imgEl.src = dataUrl;
            if (imgEl.decode) await imgEl.decode().catch(() => undefined);
          }
        } catch {
          /* segue sem essa imagem */
        }
      }),
    );
  }

  /** Carrega URL como data URL. Tenta fetch(no-store) e fallback Image+canvas. */
  private async urlParaDataUrl(src: string): Promise<string | null> {
    // Caminho 1: fetch (sem cache opaque).
    try {
      const res = await fetch(src, { mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      }
    } catch (err) {
      console.warn('[inlineImagens] fetch falhou pra', src, err);
    }

    // Caminho 2: Image() + canvas.
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          console.warn('[inlineImagens] canvas falhou', err);
          resolve(null);
        }
      };
      img.onerror = err => {
        console.warn('[inlineImagens] Image load falhou pra', src, err);
        resolve(null);
      };
      img.src = src;
    });
  }

  /**
   * Abre a visualização da súmula como MODAL (em vez do overlay in-page
   * antigo) — reaproveita a `SumulaPage` em modo modal, ganhando de
   * graça: rotação 90° no mobile, pinch-zoom + pan, botão "Baixar PDF",
   * impressão. Mantém a mesma UX da súmula aberta pelo jogo-detalhe.
   */
  async abrirVisualizacao(jogoId?: string): Promise<void> {
    if (!jogoId) return;
    const modal = await this.modalCtrl.create({
      component: SumulaPage,
      cssClass: 'sumula-modal',
      componentProps: {
        isModal: true,
        campeonatoIdInput: this.campeonatoId,
        categoriaIdInput: this.categoriaId,
        jogoIdInput: jogoId,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  /** Mantido pra compatibilidade com o overlay antigo (caso ainda
   *  esteja sendo referenciado em outros lugares do template).
   *  TODO: remover quando o overlay for limpado do HTML. */
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

    // Limpa previews antigas (de súmulas que saíram da seleção) e dispara
    // regeneração pras novas. Debounce 600ms pra dar tempo do user clicar
    // várias opções sem regenerar a cada toggle.
    this.agendarGeracaoPreviews();
  }

  private regenPreviewsTimer: ReturnType<typeof setTimeout> | null = null;

  /** Agenda regeneração das previews (debounce). */
  private agendarGeracaoPreviews(): void {
    if (this.regenPreviewsTimer) clearTimeout(this.regenPreviewsTimer);
    this.regenPreviewsTimer = setTimeout(() => {
      void this.gerarPreviewsImagens();
    }, 600);
  }

  /**
   * Captura cada `.sumula-folha` renderizada como PNG via dom-to-image-more
   * e popula `previewImagens[jogoId]`. O template então mostra a img em vez
   * do HTML. Pixel-perfect com o PDF.
   */
  private async gerarPreviewsImagens(): Promise<void> {
    if (this.sumulas.length === 0) {
      this.previewImagens = {};
      return;
    }

    this.gerandoPreviews = true;
    // Aguarda 2 frames pra Angular renderizar as folhas no DOM.
    await new Promise<void>(r => requestAnimationFrame(() => r()));
    await new Promise<void>(r => requestAnimationFrame(() => r()));

    const root = this.host.nativeElement as HTMLElement;
    // Inline imagens das folhas (logos do campeonato + equipes) pra evitar
    // CORS no canvas — só faz isso uma vez no root inteiro.
    await this.inlineImagens(root);

    // Localiza todas as folhas visíveis (não escondidas por modelo).
    const folhas = Array.from(
      root.querySelectorAll<HTMLElement>('.sumula-folha'),
    ).filter(f => !f.hasAttribute('hidden'));

    // Atualiza um Map novo (não muta o anterior — mantém previews já feitas
    // pras súmulas que não mudaram).
    const novoMap: Record<string, string> = {};

    for (let i = 0; i < folhas.length && i < this.sumulas.length; i++) {
      const jogoId = this.sumulas[i].jogo.id;
      if (!jogoId) continue;
      // Yield antes de cada captura pra não congelar a UI.
      await new Promise<void>(r => setTimeout(r, 0));
      try {
        const dataUrl = await this.capturarFolhaParaPdf(folhas[i]);
        if (dataUrl) novoMap[jogoId] = dataUrl;
      } catch (err) {
        console.warn('[sumulas-preview] preview falhou pra jogo', jogoId, err);
      }
    }

    this.previewImagens = novoMap;
    this.gerandoPreviews = false;
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
