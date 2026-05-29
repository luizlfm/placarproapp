import { Component, ElementRef, HostBinding, HostListener, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { SumulaPage } from '../jogo-detalhe/sumula/sumula.page';
import { PdfViewerModalComponent } from '../../../shared/components/pdf-viewer-modal/pdf-viewer-modal.component';
import { SumulaPdfmakeService } from './sumula-pdfmake.service';
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
import { imprimirPdf, salvarPdf } from '../../../shared/pdf-download.helper';

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
  private readonly sumulaPdfMakeSrv = inject(SumulaPdfmakeService);
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
  /** Dimensões originais dos canvas das previews (largura×altura em px).
   *  Usado em `gerarPdfMultipage` pra montar o PDF sem precisar recapturar. */
  previewImagensDim: Record<string, { width: number; height: number }> = {};
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

  /** Disparado pelo `<select>` de modelo. Limpa as previews do modelo
   *  antigo e dispara regeneração com o novo layout. */
  onModeloChange(): void {
    this.previewImagens = {};
    this.agendarGeracaoPreviews();
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
    if (!(await this.garantirSelecao())) return;
    return this.imprimirNativo();
  }

  /** No iOS, "Baixar PDF" também usa o print nativo (no share sheet
   *  do print há a opção "Salvar como PDF" / "Salvar em Arquivos"). */
  async baixarPdf(): Promise<void> {
    if (!(await this.garantirSelecao())) return;
    return this.imprimirNativo();
  }

  /** Gera PDF via Cloud Function (Puppeteer headless no servidor).
   *  Layout idêntico ao HTML/CSS do app, qualquer quantidade, zero
   *  RAM no iPhone. Demora ~5-15s dependendo do número de súmulas. */
  private async imprimirNativo(): Promise<void> {
    const loading = await this.loadingCtrl.create({
      message: 'Preparando PDF no servidor...',
      spinner: 'crescent',
    });
    await loading.present();
    try {
      // NÃO carrega/renderiza folhas no DOM — manda só os IDs pro server.
      const jogoIds = Array.from(this.selecionadas);

      loading.message = `Gerando PDF (${jogoIds.length} súmula(s))...`;

      // Chama a Cloud Function via HTTP direto (mais leve que SDK Fire).
      const URL_FN = 'https://us-central1-placapro-d276d.cloudfunctions.net/gerarSumulasPdf';
      const resp = await fetch(URL_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campeonatoId: this.campeonatoId,
          categoriaId: this.categoriaId,
          jogoIds,
        }),
      });
      if (!resp.ok) {
        const erro = await resp.text().catch(() => 'erro');
        throw new Error(`Servidor: ${resp.status} ${erro}`);
      }
      const blob = await resp.blob();

      const fileName = `sumulas-${this.campeonato?.titulo?.replace(/\s+/g, '_') || 'campeonato'}.pdf`;

      const modal = await this.modalCtrl.create({
        component: PdfViewerModalComponent,
        componentProps: { blob, fileName, acao: 'salvar' },
        cssClass: 'pdf-popup-modal',
      });
      await modal.present();
    } catch (err) {
      const e = err as { message?: string };
      console.error('[imprimirNativo] erro', err);
      const t = await this.toastCtrl.create({
        message: `Erro ao gerar PDF: ${e?.message || 'desconhecido'}`,
        duration: 8000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      await loading.dismiss();
    }
  }

  /** Monta HTML completo (CSS + folhas) pra enviar ao Puppeteer. Pega
   *  todos os <link rel="stylesheet"> e <style> do head atual + as
   *  `.sumula-folha` visíveis no DOM. Cada folha ganha page-break-after. */
  private montarHtmlStandalone(): string {
    // Pega CSS atual — links absolutos + styles inline.
    const stylesheets = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'))
      .map(el => {
        const href = (el as HTMLLinkElement).href;
        return `<link rel="stylesheet" href="${href}">`;
      })
      .join('\n');
    const styles = Array.from(document.head.querySelectorAll('style'))
      .map(el => el.outerHTML)
      .join('\n');

    // Pega só as folhas VISÍVEIS do modelo selecionado.
    const folhas = Array.from(document.querySelectorAll<HTMLElement>('.sumula-folha'))
      .filter(f => !f.hasAttribute('hidden'))
      .map(f => f.outerHTML)
      .join('\n');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <base href="${location.origin}/">
  ${stylesheets}
  ${styles}
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    .sumula-folha {
      page-break-after: always !important;
      break-after: page !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 4mm !important;
      box-sizing: border-box !important;
      transform: none !important;
      zoom: 1 !important;
      display: block !important;
      visibility: visible !important;
      position: static !important;
      box-shadow: none !important;
    }
    .sumula-folha:last-child {
      page-break-after: auto !important;
    }
    img.sumula-preview-img,
    .no-print { display: none !important; }
  </style>
</head>
<body>
  ${folhas}
</body>
</html>`;
  }

  private formatarDataHora(dt?: string | Date | null): string {
    if (!dt) return '';
    try {
      const d = typeof dt === 'string' ? new Date(dt) : dt;
      if (isNaN(d.getTime())) return '';
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return '';
    }
  }

  /** Handlers dos botões do header — wrapper que loga e impede default
   *  caso algum overlay pai do shell esteja consumindo o click. */
  onClickPdf(ev?: Event): void {
    console.log('[sumulas-preview] click PDF');
    ev?.stopPropagation();
    void this.baixarPdf();
  }

  onClickImprimir(ev?: Event): void {
    console.log('[sumulas-preview] click Imprimir');
    ev?.stopPropagation();
    void this.imprimir();
  }

  /** Se nenhuma partida está selecionada, mostra toast e retorna false. */
  private async garantirSelecao(): Promise<boolean> {
    if (this.selecionadas.size > 0) return true;
    const t = await this.toastCtrl.create({
      message: 'Selecione ao menos 1 partida.',
      duration: 2400,
      color: 'warning',
      position: 'top',
    });
    await t.present();
    return false;
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

      // Garante que `previewImagens` está populada com as imagens das partidas
      // selecionadas. Se debounce não disparou ainda OU alguma partida não
      // tem preview, gera agora sincronizadamente.
      const jogoIdsSelecionados = this.sumulas.map(s => s.jogo.id).filter((id): id is string => !!id);
      const faltando = jogoIdsSelecionados.some(id => !this.previewImagens[id]);
      if (faltando) {
        loading.message = 'Renderizando súmulas...';
        if (this.regenPreviewsTimer) {
          clearTimeout(this.regenPreviewsTimer);
          this.regenPreviewsTimer = null;
        }
        await this.gerarPreviewsImagens();
      }

      if (Object.keys(this.previewImagens).length === 0) {
        throw new Error('Nenhuma súmula encontrada — selecione ao menos uma partida.');
      }

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      // REUSA as imagens que já foram geradas pelo `gerarPreviewsImagens()`
      // (uma por uma, com sucesso). Capturar de novo aqui dispara html2canvas
      // múltiplas vezes em sequência rápida → Safari iOS estoura RAM e mata
      // a aba. Como `previewImagens[jogoId]` já existe pra cada partida
      // selecionada, basta usar diretamente.
      let primeira = true;
      const jogoIds = this.sumulas.map(s => s.jogo.id).filter((id): id is string => !!id);
      for (let i = 0; i < jogoIds.length; i++) {
        const jogoId = jogoIds[i];
        loading.message = `Montando ${i + 1} de ${jogoIds.length}...`;
        const dataUrl = this.previewImagens[jogoId];
        const dim = this.previewImagensDim[jogoId];
        if (!dataUrl || !dim || !dim.width || !dim.height) {
          console.warn(`[${destino}] sem preview pra jogo ${jogoId}, pulando`);
          continue;
        }
        const imgRatio = dim.height / dim.width;
        const imgW = pageW;
        let imgH = imgW * imgRatio;
        if (imgH > pageH) imgH = pageH;
        if (!primeira) pdf.addPage('a4', 'landscape');
        pdf.addImage(dataUrl, 'JPEG', 0, 0, imgW, imgH);
        primeira = false;
        // Yield pra UI não congelar com PDFs grandes
        await new Promise<void>(r => setTimeout(r, 0));
      }

      if (destino === 'print') {
        const nomeImpressao = `sumulas-${this.campeonato?.titulo?.replace(/\s+/g, '_') || 'campeonato'}.pdf`;
        await imprimirPdf(pdf, nomeImpressao, this.toastCtrl, this.modalCtrl);
      } else {
        // download direto — pdf.save() força via <a download>.
        // No iOS Safari, salvarPdf() usa Web Share API pra abrir share sheet
        // nativo (com opção "Salvar em Arquivos") em vez de abrir PDF inline.
        const nome = `sumulas-${this.campeonato?.titulo?.replace(/\s+/g, '_') || 'campeonato'}.pdf`;
        await salvarPdf(pdf, nome, this.toastCtrl, this.modalCtrl);
      }
    } catch (err) {
      const e = err as { name?: string; message?: string; stack?: string };
      const detalhe = `name=${e?.name}\nmessage=${e?.message}\nstack=${(e?.stack || '').slice(0, 500)}`;
      console.error(`[${destino}] erro\n` + detalhe);
      const msg = err instanceof Error ? err.message : String(err);
      const t = await this.toastCtrl.create({
        message: `Erro ao gerar PDF: ${msg || 'desconhecido'}`,
        duration: 8000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      await loading.dismiss();
    }
  }

  /**
   * Captura uma `.sumula-folha` como JPEG data URL via html2canvas.
   * Clona pra container off-screen no body pra evitar constraints do
   * modal/preview, aplica bordas 0.5px inline pra ficar hairline no PDF.
   * Retorna `{ dataUrl, width, height }` pra evitar recarregar em <img>
   * (Safari iOS rejeita data URLs gigantes).
   */
  private async capturarFolhaParaPdf(folhaOriginal: HTMLElement): Promise<{ dataUrl: string; width: number; height: number } | null> {
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
      folhaClone.style.boxShadow = 'none';
      // Remove [hidden] e força display:block visível — o clone pode herdar
      // hidden da original (quando previewImagens[jogoId] existe, o HTML
      // fica hidden e mostra a img preview). No PDF queremos sempre captura.
      folhaClone.removeAttribute('hidden');
      folhaClone.style.setProperty('display', 'block', 'important');
      folhaClone.style.setProperty('visibility', 'visible', 'important');
      folhaClone.style.setProperty('position', 'static', 'important');
      folhaClone.style.setProperty('top', 'auto', 'important');
      folhaClone.style.setProperty('left', 'auto', 'important');
      folhaClone.style.setProperty('margin', '0', 'important');
      folhaClone.style.setProperty('width', '290mm', 'important');
      folhaClone.style.setProperty('max-width', '290mm', 'important');
      folhaClone.style.setProperty('zoom', '1', 'important');
      // Garante visibility visible em descendentes.
      folhaClone.querySelectorAll<HTMLElement>('*').forEach(el => {
        if (el.hasAttribute('hidden')) el.removeAttribute('hidden');
        el.style.setProperty('visibility', 'visible', 'important');
      });

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

      const canvas = await html2canvas(folhaClone, {
        backgroundColor: '#ffffff',
        scale: 0.7,
        useCORS: true,
        logging: false,
        imageTimeout: 0,
        removeContainer: true,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const out = { dataUrl, width: canvas.width, height: canvas.height };
      // Libera o canvas backing store explicitamente — Safari iOS demora
      // pra fazer GC, e em loops sequenciais (várias súmulas) a memória
      // acumula até estourar e a aba é morta.
      canvas.width = 0;
      canvas.height = 0;
      // Limpa TODAS as <img> do clone (cada uma é um base64 grande na RAM)
      // antes de descartar — sem isso o Safari iOS segura essas refs por
      // muito tempo e a 12ª captura estoura.
      const imgsRemover = folhaClone.querySelectorAll('img');
      for (let k = 0; k < imgsRemover.length; k++) {
        (imgsRemover[k] as HTMLImageElement).src = '';
        (imgsRemover[k] as HTMLImageElement).removeAttribute('src');
      }
      return out;
    } catch (err) {
      console.error('[capturarFolhaParaPdf] erro', err);
      return null;
    } finally {
      try {
        // Limpa tudo do offscreen explicitamente antes de remover do DOM,
        // pra forçar liberação das <img> base64 (cada uma é grande em RAM).
        offscreen.innerHTML = '';
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
    const FALLBACK_TRANSPARENT =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(
      imgs.map(async imgEl => {
        const src = imgEl.getAttribute('src') || '';
        if (!src) return;
        if (src.startsWith('data:image/png') || src.startsWith('data:image/jpeg')) return;
        let dataUrl: string | null = null;
        try {
          dataUrl = await this.urlParaDataUrl(src);
        } catch {
          dataUrl = null;
        }
        if (dataUrl && dataUrl.startsWith('data:image/svg+xml')) {
          try { dataUrl = await this.svgParaPng(dataUrl); } catch { dataUrl = null; }
        }
        imgEl.src = dataUrl || FALLBACK_TRANSPARENT;
        if (imgEl.decode) await imgEl.decode().catch(() => undefined);
      }),
    );
  }

  private svgParaPng(svgDataUrl: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 512;
          c.height = img.naturalHeight || 512;
          const ctx = c.getContext('2d');
          if (!ctx) return reject(new Error('no-ctx'));
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('svg-load-fail'));
      img.src = svgDataUrl;
    });
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

    // Se a preview do modelo atual não existe, gera on-demand.
    // (Acontece quando o user clica em visualizar sem ter selecionado a
    // partida, ou logo após mudar o modelo antes do debounce disparar.)
    if (!this.previewImagens[jogoId]) {
      const naoEstavaSelecionada = !this.selecionadas.has(jogoId);
      this.selecionadas.add(jogoId);
      const loading = await this.loadingCtrl.create({
        message: 'Renderizando súmula...',
        spinner: 'crescent',
      });
      await loading.present();
      try {
        await this.recarregarSumulas();
        // Cancela o debounce e gera sincronizado.
        if (this.regenPreviewsTimer) {
          clearTimeout(this.regenPreviewsTimer);
          this.regenPreviewsTimer = null;
        }
        await this.gerarPreviewsImagens();
      } catch (err) {
        console.warn('[sumulas-preview] preview on-demand falhou', err);
      } finally {
        await loading.dismiss();
        // Se a partida não estava selecionada originalmente, deseleciona
        // (mas mantém a imagem em `previewImagens` pra próxima visualização).
        if (naoEstavaSelecionada) {
          this.selecionadas.delete(jogoId);
        }
      }
    }

    const modal = await this.modalCtrl.create({
      component: SumulaPage,
      cssClass: 'sumula-modal',
      componentProps: {
        isModal: true,
        campeonatoIdInput: this.campeonatoId,
        categoriaIdInput: this.categoriaId,
        jogoIdInput: jogoId,
        // Passa a imagem renderizada com o MODELO SELECIONADO (handebol,
        // futsal, etc). Sem isso, SumulaPage geraria sua própria preview
        // com o template padrão, ignorando o modelo escolhido.
        previewImagemUrlInput: this.previewImagens[jogoId] || undefined,
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

  /** Agenda regeneração das previews (debounce). Pula automático se
   *  > 3 selecionadas (estouraria RAM no iOS). PDF roda no servidor. */
  private agendarGeracaoPreviews(): void {
    if (this.regenPreviewsTimer) clearTimeout(this.regenPreviewsTimer);
    if (this.sumulas.length > 3) {
      this.previewImagens = {};
      this.previewImagensDim = {};
      return;
    }
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
      this.previewImagensDim = {};
      return;
    }

    // Guard: se já está gerando, espera terminar em vez de duplicar (cada
    // chamada concorrente consome RAM no Safari iOS e estoura).
    if (this.gerandoPreviews) {
      while (this.gerandoPreviews) {
        await new Promise<void>(r => setTimeout(r, 200));
      }
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

    // CACHE: mantém as previews já geradas pras súmulas que não mudaram
    // — assim 1ª captura: gera 3 imgs, 2ª captura (após +1 partida):
    // só gera a partida nova, evitando recarregar tudo.
    const novoMap: Record<string, string> = { ...this.previewImagens };
    const novoDim: Record<string, { width: number; height: number }> = { ...this.previewImagensDim };

    // Remove previews de partidas que saíram da seleção atual.
    const idsAtivos = new Set(
      this.sumulas.map(s => s.jogo.id).filter((id): id is string => !!id),
    );
    Object.keys(novoMap).forEach(id => {
      if (!idsAtivos.has(id)) {
        delete novoMap[id];
        delete novoDim[id];
      }
    });

    for (let i = 0; i < folhas.length && i < this.sumulas.length; i++) {
      const jogoId = this.sumulas[i].jogo.id;
      if (!jogoId) continue;
      // Pula partidas que já têm preview no cache (evita re-renderizar).
      if (novoMap[jogoId] && novoDim[jogoId]) continue;
      // Pausa entre capturas — escala conforme já capturou pra dar tempo
      // do Safari iOS fazer GC. Após N capturas, RAM começa a apertar.
      const novasJaCapturadas = Object.keys(novoMap).length - Object.keys(this.previewImagens).length;
      if (novasJaCapturadas > 0) {
        // Pausa progressiva: 300ms até 4 folhas, 600ms até 8, 1000ms acima.
        const pausa = novasJaCapturadas < 4 ? 300
          : novasJaCapturadas < 8 ? 600
          : 1000;
        await new Promise<void>(r => setTimeout(r, pausa));
      }
      try {
        const capt = await this.capturarFolhaParaPdf(folhas[i]);
        if (capt) {
          novoMap[jogoId] = capt.dataUrl;
          novoDim[jogoId] = { width: capt.width, height: capt.height };
        }
      } catch (err) {
        console.warn('[sumulas-preview] preview falhou pra jogo', jogoId, err);
      }
    }

    this.previewImagens = novoMap;
    this.previewImagensDim = novoDim;
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
