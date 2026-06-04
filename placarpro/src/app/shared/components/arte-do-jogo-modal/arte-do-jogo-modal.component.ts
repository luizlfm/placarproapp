import { Component, ElementRef, HostListener, Input, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import html2canvas from 'html2canvas';
import { ArteModelosService, ArteModeloDoc } from '../../../campeonatos/arte-modelos.service';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';

type ElTipo = 'texto' | 'imagem' | 'forma';
type FormaKind = 'ret' | 'faixa' | 'circ' | 'tri' | 'pontos';

/** Um elemento livre na arte. Posição = centro em % do canvas; tamanhos em
 *  cqw (escalam com o canvas e exportam certo no html2canvas). */
interface ArteEl {
  id: string;
  tipo: ElTipo;
  xPct: number;
  yPct: number;
  rotacao?: number;     // graus
  opacidade?: number;   // 0..1
  bloqueado?: boolean;  // trava interação
  oculto?: boolean;     // não renderiza
  flipH?: boolean;
  flipV?: boolean;
  sombraEl?: boolean;   // sombra projetada (imagem/forma)
  // texto
  texto?: string;
  fonte?: string;
  tamanho?: number;     // cqw
  cor?: string;
  negrito?: boolean;
  italico?: boolean;
  align?: 'left' | 'center' | 'right';
  sombra?: boolean;
  maiusculas?: boolean;
  espac?: number;       // letter-spacing (cqw)
  realce?: string | null; // cor de realce (fundo do texto)
  // imagem
  src?: string;
  imgLargura?: number;  // cqw
  circular?: boolean;
  // forma
  forma?: FormaKind;
  formaLargura?: number; // cqw
  formaAltura?: number;  // cqw
  borda?: boolean;       // contorno (fundo transparente + borda colorida)
  bordaW?: number;       // espessura do contorno (cqw)
}

interface DadosJogo {
  placar: string; titulo: string; sub: string;
  nomeM: string; nomeV: string; data: string; local: string;
  logoM?: string; logoV?: string; logoCamp?: string;
}


/**
 * Editor da arte do jogo (canvas estilo Canva) com MODELOS profissionais
 * prontos (halftone, formas de acento, VS com escudos, badge de data),
 * elementos arrastáveis/redimensionáveis, rotação/opacidade, fundos
 * (cores/foto/banco) e export PNG via html2canvas.
 */
@Component({
  selector: 'app-arte-do-jogo-modal',
  templateUrl: './arte-do-jogo-modal.component.html',
  styleUrls: ['./arte-do-jogo-modal.component.scss'],
  standalone: false,
})
export class ArteDoJogoModalComponent implements OnInit, OnDestroy {
  @Input() jogo!: Jogo;
  @Input() mandante?: Equipe;
  @Input() visitante?: Equipe;
  @Input() campeonato?: Campeonato;
  @Input() categoria?: Categoria;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly arteSrv = inject(ArteModelosService);

  // ─── modelos salvos pelo usuário (Firestore, sincronizado) ─────────
  modelosSalvos: ArteModeloDoc[] = [];
  modeloPadraoId = '';
  private subModelos?: Subscription;
  private aplicouPadrao = false;

  @ViewChild('canvas', { read: ElementRef }) canvasEl?: ElementRef<HTMLElement>;

  gerando = false;
  capturando = false;
  selecionadoId: string | null = null;
  /** Conjunto de elementos selecionados (multi-seleção). */
  selecao = new Set<string>();
  /** Modo de seleção múltipla: toque inclui/remove elementos do conjunto. */
  multiSel = false;

  /** Painel/seção ativa do rail de edição (estilo Canva). */
  painelAtivo: 'modelos' | 'adicionar' | 'elementos' | 'fundo' | 'camadas' | 'editar' = 'modelos';
  readonly rail: { id: 'modelos' | 'adicionar' | 'elementos' | 'fundo' | 'camadas' | 'editar'; label: string; icon: string }[] = [
    { id: 'modelos', label: 'Modelos', icon: 'grid-outline' },
    { id: 'adicionar', label: 'Adicionar', icon: 'add-circle-outline' },
    { id: 'elementos', label: 'Elementos', icon: 'shapes-outline' },
    { id: 'fundo', label: 'Fundo', icon: 'image-outline' },
    { id: 'camadas', label: 'Camadas', icon: 'albums-outline' },
    { id: 'editar', label: 'Editar', icon: 'options-outline' },
  ];

  // ─── elementos (Iconify — ícones/gráficos livres, sem chave) ───────
  elemQuery = 'soccer';
  elemBuscando = false;
  elemErro = '';
  elemResultados: { nome: string; url: string }[] = [];
  /** 'icones' = flat na cor do tema · 'cor' = emojis coloridos/3D (Noto/Fluent). */
  elemModo: 'icones' | 'cor' = 'cor';

  // ─── modelos profissionais ─────────────────────────────────────────
  readonly modelos: { id: string; label: string }[] = [
    { id: 'confronto', label: 'Confronto' },
    { id: 'diajogo', label: 'Dia de Jogo' },
    { id: 'decisao', label: 'Decisão' },
    { id: 'matchday', label: 'Matchday' },
  ];
  modeloAtivo = 'confronto';

  /** Cor de acento do tema (usada pelos modelos). */
  accent = '#16e6a6';

  // ─── fundo ─────────────────────────────────────────────────────────
  fundo = 'escuro';
  fundoImgUrl: string | null = null;
  fundoAba: 'cores' | 'foto' | 'banco' = 'cores';
  /** Escurecimento (overlay preto) sobre o fundo: 0..0.85. */
  fundoOverlay = 0.25;
  /** Ajuste da imagem de fundo: zoom (%) e deslocamento (%). */
  fundoZoom = 100;
  fundoPosX = 0;
  fundoPosY = 0;
  /** Cor sólida personalizada do fundo (quando não há imagem nem preset). */
  fundoCor: string | null = null;

  get fundoTransform(): string {
    return `translate(${this.fundoPosX}%, ${this.fundoPosY}%) scale(${this.fundoZoom / 100})`;
  }
  private resetFundoAjuste(): void {
    this.fundoZoom = 100;
    this.fundoPosX = 0;
    this.fundoPosY = 0;
  }

  readonly fundos: { id: string; label: string }[] = [
    { id: 'gramado', label: 'Gramado' },
    { id: 'estadio', label: 'Estádio' },
    { id: 'quadra', label: 'Quadra' },
    { id: 'gradient', label: 'Gradiente' },
    { id: 'escuro', label: 'Escuro' },
    { id: 'liso', label: 'Liso' },
    { id: 'noturno', label: 'Noturno' },
    { id: 'holofote', label: 'Holofote' },
    { id: 'diagonal', label: 'Diagonal' },
    { id: 'fogo', label: 'Fogo' },
    { id: 'oceano', label: 'Oceano' },
    { id: 'roxo', label: 'Roxo' },
  ];

  /** Fotos de fundo prontas (embutidas no app, otimizadas 1080×1350). */
  readonly fundosFoto: { id: string; label: string; url: string }[] = [
    { id: 'arena', label: 'Arena', url: 'assets/fundos/arena.jpg' },
    { id: 'noite', label: 'Noturno', url: 'assets/fundos/estadio-noite.jpg' },
    { id: 'dia', label: 'Diurno', url: 'assets/fundos/estadio-dia.jpg' },
  ];

  // ─── banco de imagens online (Openverse — sem chave) ───────────────
  buscaQuery = 'estádio futebol';
  buscando = false;
  buscaErro = '';
  resultados: { thumb: string; full: string; autor: string }[] = [];

  readonly fontes: string[] = [
    'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black', 'Teko', 'Russo One',
    'Rajdhani', 'Bungee', 'Saira Condensed', 'Montserrat', 'Poppins', 'Inter', 'Georgia',
  ];

  /** Elementos rápidos (inserção direta, coloridos). */
  readonly elemRapidos: { nome: string; rotulo: string }[] = [
    { nome: 'noto:soccer-ball', rotulo: 'Bola' },
    { nome: 'noto:trophy', rotulo: 'Troféu' },
    { nome: 'noto:1st-place-medal', rotulo: 'Medalha' },
    { nome: 'noto:fire', rotulo: 'Fogo' },
    { nome: 'noto:glowing-star', rotulo: 'Estrela' },
    { nome: 'noto:crown', rotulo: 'Coroa' },
  ];

  elementos: ArteEl[] = [];

  // ─── estado de arraste/resize ──────────────────────────────────────
  private modo: 'idle' | 'drag' | 'resize' | 'grupo' = 'idle';
  private elAtivo?: ArteEl;

  /** Caixa do grupo (multi-seleção) em % do canvas: l/w em %largura, t/h em %altura. */
  grupo: { l: number; t: number; w: number; h: number } | null = null;
  private grupoCx = 50;
  private grupoCy = 50;
  private startGrupo = { cx: 0, cy: 0, dist: 1 };
  private grupoStartSizes = new Map<string, { size: number; h: number; x: number; y: number }>();
  get emArraste(): boolean { return this.modo === 'drag' || this.modo === 'resize'; }
  private startX = 0;
  private startY = 0;
  private startVal = { x: 0, y: 0, size: 0 };
  private startRatio = 1;
  private startDist = 1;
  private startCx = 0;
  private startCy = 0;
  private startW = 20;
  private startH = 20;
  private startDistX = 1;
  private startDistY = 1;
  private resizeDir: 'c' | 'x' | 'y' = 'c';
  private rect?: DOMRect;
  private moved = false;
  private downId: string | null = null;
  private downWasSel = false;
  private downMulti = false;
  private grpStart = new Map<string, { x: number; y: number }>();
  private clipboard: ArteEl[] = [];

  // histórico (desfazer/refazer)
  private historia: string[] = [];
  private futuro: string[] = [];
  private histPronto = false;

  /** Guias de alinhamento exibidas durante o arraste (coordenada % ou null). */
  guiaV: number | null = null;
  guiaH: number | null = null;

  ngOnInit(): void {
    this.aplicarModelo(this.modeloAtivo);
    this.historia = [this.snapshot()];
    this.histPronto = true;

    // modelos salvos na nuvem (tempo real) + aplica o padrão na 1ª carga
    this.subModelos = this.arteSrv.listar().subscribe(list => {
      this.modelosSalvos = list;
      const padrao = list.find(m => m.padrao);
      this.modeloPadraoId = padrao?.id ?? '';
      if (!this.aplicouPadrao && padrao && this.historia.length <= 1) {
        this.aplicouPadrao = true;
        this.restaurar(padrao.dados);
        this.reinjetarDados(this.elementos);
        this.modeloAtivo = 'salvo:' + padrao.id;
        this.historia = [this.snapshot()];
      }
    });
  }

  ngOnDestroy(): void {
    this.subModelos?.unsubscribe();
  }

  /** Reinjeta os dados do jogo atual nos textos/escudos de ids conhecidos. */
  private reinjetarDados(els: ArteEl[]): void {
    const d = this.dadosJogo();
    for (const e of els) {
      if (e.tipo === 'texto') {
        if (e.id === 'nomeM') e.texto = d.nomeM;
        else if (e.id === 'nomeV') e.texto = d.nomeV;
        else if (e.id === 'data') e.texto = d.data;
        else if (e.id === 'camp' || e.id === 'rodape') e.texto = d.titulo;
        else if (e.id === 'placar') e.texto = d.placar;
        else if (e.id === 'local') e.texto = d.local;
        else if (e.id === 'subtitulo') e.texto = d.sub;
      } else if (e.tipo === 'imagem') {
        if (e.id === 'escM' && d.logoM) e.src = d.logoM;
        else if (e.id === 'escV' && d.logoV) e.src = d.logoV;
        else if (e.id === 'logoCamp' && d.logoCamp) e.src = d.logoCamp;
      }
    }
  }

  async salvarModeloAtual(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Salvar como modelo',
      message: 'Dê um nome pra reutilizar esse layout em outros jogos.',
      inputs: [{ name: 'nome', type: 'text', placeholder: 'Ex: Meu modelo padrão' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Salvar', handler: (v) => { this.gravarNovoModelo(v?.nome); } },
      ],
    });
    await alert.present();
  }
  private async gravarNovoModelo(nome: string): Promise<void> {
    const n = (nome ?? '').trim() || ('Modelo ' + (this.modelosSalvos.length + 1));
    const id = Date.now().toString(36);
    try {
      await this.arteSrv.salvar({ id, nome: n, dados: this.snapshotLeve(), padrao: false });
      const t = await this.toastCtrl.create({ message: 'Modelo "' + n + '" salvo na nuvem!', duration: 1800, color: 'success', position: 'top' });
      await t.present();
    } catch (e) {
      console.error('[ArteJogo] salvar modelo erro', e);
      const t = await this.toastCtrl.create({
        message: 'Não deu pra salvar. Verifique login e o tamanho da imagem de fundo.',
        duration: 3200, color: 'danger', position: 'top',
      });
      await t.present();
    }
  }
  async salvarComoPadrao(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Modelo padrão',
      message: 'Salva o layout atual e o define como PADRÃO (abre nele automaticamente em todos os jogos).',
      inputs: [{ name: 'nome', type: 'text', placeholder: 'Ex: Meu padrão', value: 'Meu padrão' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Salvar padrão', handler: (v) => { this.gravarModeloPadrao(v?.nome); } },
      ],
    });
    await alert.present();
  }
  private async gravarModeloPadrao(nome: string): Promise<void> {
    const n = (nome ?? '').trim() || 'Meu padrão';
    const id = Date.now().toString(36);
    try {
      await this.arteSrv.salvar({ id, nome: n, dados: this.snapshotLeve(), padrao: true });
      // limpa o padrão dos demais (o novo já nasce padrao:true)
      await this.arteSrv.definirPadrao(id, this.modelosSalvos);
      this.modeloAtivo = 'salvo:' + id;
      const t = await this.toastCtrl.create({ message: '⭐ "' + n + '" salvo como modelo padrão!', duration: 2200, color: 'success', position: 'top' });
      await t.present();
    } catch (e) {
      console.error('[ArteJogo] salvar padrão erro', e);
      const t = await this.toastCtrl.create({ message: 'Não deu pra salvar. Verifique login e o tamanho da imagem de fundo.', duration: 3200, color: 'danger', position: 'top' });
      await t.present();
    }
  }
  aplicarModeloSalvo(m: ArteModeloDoc): void {
    this.restaurar(m.dados);
    this.reinjetarDados(this.elementos);
    this.modeloAtivo = 'salvo:' + m.id;
    this.commit();
  }
  async removerModeloSalvo(m: ArteModeloDoc): Promise<void> {
    await this.arteSrv.remover(m.id);
  }
  async definirPadrao(m: ArteModeloDoc): Promise<void> {
    const alvo = this.modeloPadraoId === m.id ? null : m.id;
    await this.arteSrv.definirPadrao(alvo, this.modelosSalvos);
  }

  // ─── histórico ─────────────────────────────────────────────────────
  private snapshot(): string {
    return JSON.stringify({
      el: this.elementos, fundo: this.fundo, img: this.fundoImgUrl,
      ov: this.fundoOverlay, ac: this.accent, mod: this.modeloAtivo,
      fz: this.fundoZoom, fx: this.fundoPosX, fy: this.fundoPosY, fc: this.fundoCor,
    });
  }
  /** Snapshot "leve": descarta imagens pesadas (fotos/PNGs em dataURL acima
   *  de ~20KB) pra caber no limite de 1MB do Firestore. Ícones SVG pequenos
   *  e caminhos de asset/URL são mantidos. */
  private snapshotLeve(): string {
    const leve = (s: string | null | undefined): string | null => {
      if (s && s.startsWith('data:') && s.length > 20000) return null;
      return s ?? null;
    };
    const els = this.elementos.map(e => {
      if (e.tipo === 'imagem' && e.src && e.src.startsWith('data:') && e.src.length > 20000) {
        return { ...e, src: '' };
      }
      return e;
    });
    return JSON.stringify({
      el: els, fundo: this.fundo, img: leve(this.fundoImgUrl),
      ov: this.fundoOverlay, ac: this.accent, mod: this.modeloAtivo,
      fz: this.fundoZoom, fx: this.fundoPosX, fy: this.fundoPosY, fc: this.fundoCor,
    });
  }

  /** Captura o layout atual (compacto) pra fixar no código como modelo
   *  oficial. Copia pro clipboard; cole no chat pro dev cravar no builder. */
  async capturarLayout(): Promise<void> {
    const tag = (s?: string) => (s && s.startsWith('data:') ? '<<imagem-enviada>>' : (s ?? ''));
    const layout = {
      modelo: this.modeloAtivo,
      fundo: this.fundo,
      fundoCor: this.fundoCor,
      overlay: this.fundoOverlay,
      fundoImg: tag(this.fundoImgUrl || ''),
      zoom: this.fundoZoom, posX: this.fundoPosX, posY: this.fundoPosY,
      accent: this.accent,
      elementos: this.elementos.map(e => ({
        ...e,
        src: e.tipo === 'imagem' ? tag(e.src) : undefined,
      })),
    };
    const json = JSON.stringify(layout, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      const t = await this.toastCtrl.create({ message: 'Layout copiado! Cole aqui no chat pra eu fixar no código.', duration: 4000, color: 'success', position: 'top' });
      await t.present();
    } catch {
      console.log('[ArteJogo] LAYOUT CAPTURADO:\n' + json);
      const a = await this.alertCtrl.create({
        header: 'Layout (copie tudo)',
        message: '<pre style="white-space:pre-wrap;font-size:10px;max-height:50vh;overflow:auto">' + json.replace(/</g, '&lt;') + '</pre>',
        buttons: ['OK'],
      });
      await a.present();
    }
  }

  /** Salva o estado atual no histórico (chamar APÓS uma mudança). */
  commit(): void {
    if (!this.histPronto) return;
    this.historia.push(this.snapshot());
    if (this.historia.length > 80) this.historia.shift();
    this.futuro = [];
  }
  private restaurar(s: string): void {
    const o = JSON.parse(s);
    this.elementos = o.el;
    this.fundo = o.fundo;
    this.fundoImgUrl = o.img;
    this.fundoOverlay = o.ov;
    this.accent = o.ac;
    this.modeloAtivo = o.mod;
    this.fundoZoom = o.fz ?? 100;
    this.fundoPosX = o.fx ?? 0;
    this.fundoPosY = o.fy ?? 0;
    this.fundoCor = o.fc ?? null;
    this.selecao.clear();
    this.selecionadoId = null;
  }
  get podeDesfazer(): boolean { return this.historia.length > 1; }
  get podeRefazer(): boolean { return this.futuro.length > 0; }
  desfazer(): void {
    if (this.historia.length <= 1) return;
    this.futuro.push(this.historia.pop()!);
    this.restaurar(this.historia[this.historia.length - 1]);
  }
  refazer(): void {
    if (!this.futuro.length) return;
    const s = this.futuro.pop()!;
    this.historia.push(s);
    this.restaurar(s);
  }

  // ─── dados do jogo ─────────────────────────────────────────────────
  private dadosJogo(): DadosJogo {
    const placarVis = this.jogo?.status === 'encerrado' || this.jogo?.status === 'em-andamento';
    const placar = placarVis
      ? `${this.jogo?.golsMandante ?? 0}  ×  ${this.jogo?.golsVisitante ?? 0}`
      : 'VS';
    // Dados fictícios quando faltar info (preview/jogo incompleto) — evita
    // campos vazios na arte.
    const t = (v: string | undefined | null, fallback: string) => {
      const s = (v ?? '').trim();
      return s.length ? s : fallback;
    };
    return {
      placar,
      titulo: t(this.campeonato?.titulo, 'COPA REGIONAL 2026').toUpperCase(),
      sub: t(this.categoria?.titulo, 'Categoria'),
      nomeM: t(this.mandante?.nome, 'TIME MANDANTE'),
      nomeV: t(this.visitante?.nome, 'TIME VISITANTE'),
      data: this.formatarData(this.jogo?.dataHora ?? '') || 'SÁB • 20:00',
      local: t(this.jogo?.local, 'Estádio Municipal'),
      logoM: this.mandante?.logoUrl,
      logoV: this.visitante?.logoUrl,
      logoCamp: this.campeonato?.logoUrl,
    };
  }

  // ─── fábricas ──────────────────────────────────────────────────────
  private T(o: Partial<ArteEl> & { id: string; texto: string; xPct: number; yPct: number; tamanho: number }): ArteEl {
    return {
      tipo: 'texto', fonte: 'Anton', cor: '#ffffff', negrito: true, italico: false,
      align: 'center', sombra: true, opacidade: 1, rotacao: 0, ...o,
    };
  }
  private img(id: string, src: string, x: number, y: number, larg: number, circular: boolean): ArteEl {
    return { id, tipo: 'imagem', src, xPct: x, yPct: y, imgLargura: larg, circular, opacidade: 1, rotacao: 0 };
  }
  private F(id: string, forma: FormaKind, x: number, y: number, larg: number, alt: number, cor: string, opac = 1, rot = 0): ArteEl {
    return { id, tipo: 'forma', forma, xPct: x, yPct: y, formaLargura: larg, formaAltura: alt, cor, opacidade: opac, rotacao: rot };
  }

  // ─── modelos ───────────────────────────────────────────────────────
  /** Texto escuro de contraste pra usar sobre preenchimentos de acento. */
  private readonly dk = '#08130b';

  aplicarModelo(id: string): void {
    this.modeloAtivo = id;
    this.selecionar(null);
    const d = this.dadosJogo();
    switch (id) {
      case 'diajogo': this.modeloDiaJogo(d); break;
      case 'decisao': this.modeloDecisao(d); break;
      case 'matchday': this.modeloMatchday(d); break;
      case 'confronto':
      default: this.modeloConfronto(d); break;
    }
    this.commit();
  }

  /** Confronto — VS equilibrado, bloco diagonal de profundidade, escudos
   *  grandes com VS num círculo de acento e badge de data. */
  private modeloConfronto(d: DadosJogo): void {
    this.fundo = 'noturno';
    this.fundoImgUrl = 'assets/fundos/arena.jpg';
    this.fundoCor = null;
    this.resetFundoAjuste();
    this.fundoOverlay = 0.22;
    const a = this.accent;
    const els: ArteEl[] = [
      this.F('blk', 'ret', 21.8, 52, 66, 200, a, 0.12, -18),
      this.F('ht1', 'pontos', 89, 3.5, 28, 16, '#ffffff', 0.85),
      this.T({ id: 'camp', texto: d.titulo, xPct: 50, yPct: 27.3, tamanho: 3, fonte: 'Rajdhani', negrito: false }),
      this.T({ id: 'titulo', texto: 'JOGO DA RODADA', xPct: 50, yPct: 33.9, tamanho: 8.5, espac: 1.1 }),
    ];
    if (d.logoM) els.push(this.img('escM', d.logoM, 26.3, 55.1, 36, false));
    if (d.logoV) els.push(this.img('escV', d.logoV, 70.3, 57.7, 36, false));
    els.push(
      this.T({ id: 'vs', texto: 'VS', xPct: 50, yPct: 63.7, tamanho: 11.9, fonte: 'Teko', sombra: false }),
      this.T({ id: 'nomeM', texto: d.nomeM, xPct: 26.3, yPct: 75.8, tamanho: 3.6, fonte: 'Rajdhani' }),
      this.T({ id: 'nomeV', texto: d.nomeV, xPct: 70.3, yPct: 75.8, tamanho: 3.6, fonte: 'Rajdhani' }),
      this.F('badge', 'ret', 49.8, 85.4, 54, 8.5, '#1c1c1c', 0.7),
      this.T({ id: 'data', texto: d.data, xPct: 49.8, yPct: 85.4, tamanho: 3.8, fonte: 'Poppins', sombra: false }),
      this.T({ id: 'local', texto: d.local, xPct: 49.8, yPct: 93.1, tamanho: 2.6, fonte: 'Montserrat', negrito: false, espac: 0.9 }),
    );
    if (d.logoCamp) els.push(this.img('logoCamp', d.logoCamp, 50, 15.6, 24, false));
    els.push(
      this.F('dec1', 'pontos', 5.3, 87.3, 5, 22, '#ffffff', 0.9),
      this.F('dec2', 'ret', 96.2, 99, 33.1, 16.4, '#000000', 0.6, -33),
      this.F('dec3', 'ret', 98.3, 103, 33.1, 8, '#ffffff', 0.6, -33),
      this.F('dec4', 'ret', 3.3, 1, 33.1, 16.6, '#000000', 0.6, -33),
    );
    this.elementos = els;
  }

  /** Decisão — assimétrico, itálico, dois tons, halftone, triângulo de
   *  acento, VS com listras e badge de contorno ("grande final"). */
  private modeloDecisao(d: DadosJogo): void {
    this.fundo = 'escuro';
    this.fundoImgUrl = 'assets/fundos/arena.jpg';
    this.fundoCor = null;
    this.resetFundoAjuste();
    this.fundoOverlay = 0.4;
    const els: ArteEl[] = [
      this.F('tri1', 'tri', 99, 99, 48, 50, '#000000', 0.8, 18),
      this.F('ht1', 'pontos', 1, 1.5, 31, 18, '#ffffff', 0.9),
      this.F('ht2', 'pontos', 3.3, 94.2, 26, 4.5, '#ffffff', 0.45),
      this.T({ id: 'kicker', texto: 'GRANDE', xPct: 51.2, yPct: 7.6, tamanho: 4.2, italico: true, sombra: false }),
      this.T({ id: 'titulo', texto: 'DECISÃO', xPct: 51.2, yPct: 15.1, tamanho: 10.5, italico: true, align: 'left' }),
      this.T({ id: 'camp', texto: d.titulo, xPct: 51.2, yPct: 22.6, tamanho: 2.8, fonte: 'Montserrat', negrito: false, align: 'left' }),
    ];
    if (d.logoM) els.push(this.img('escM', d.logoM, 27.6, 37.5, 17.4, false));
    els.push(this.T({ id: 'nomeM', texto: d.nomeM, xPct: 53, yPct: 37.5, tamanho: 8.9, fonte: 'Saira Condensed', align: 'left' }));
    els.push(
      this.F('vsL', 'faixa', 36.8, 48, 12, 0.5, '#ffffff', 1),
      this.T({ id: 'vs', texto: 'VS', xPct: 50, yPct: 48, tamanho: 6.5, italico: true }),
      this.F('vsR', 'faixa', 66.8, 48, 12, 0.5, '#ffffff', 1),
    );
    if (d.logoV) els.push(this.img('escV', d.logoV, 77.2, 56.6, 18.2, false));
    els.push(
      this.T({ id: 'nomeV', texto: d.nomeV, xPct: 42.7, yPct: 56.6, tamanho: 8.5, fonte: 'Saira Condensed', align: 'left' }),
      this.T({ id: 'sub', texto: 'duelam pelo título', xPct: 50, yPct: 64.7, tamanho: 4, fonte: 'Rajdhani', italico: true, negrito: false }),
    );
    const badge = this.F('badge', 'ret', 50, 74.7, 37, 9, '#ffffff', 1);
    badge.borda = true;
    els.push(
      badge,
      this.T({ id: 'data', texto: d.data, xPct: 50, yPct: 74.7, tamanho: 3.8, fonte: 'Teko', sombra: false }),
      this.T({ id: 'tag', texto: 'Não dá pra perder!', xPct: 35, yPct: 88, tamanho: 3.4, italico: true, negrito: false }),
      this.F('dec1', 'pontos', 96.8, 5.1, 26, 4.5, '#ffffff', 0.45),
      this.F('dec2', 'pontos', 99, 96.4, 31, 18, '#ffffff', 0.5),
    );
    if (d.logoCamp) els.push(this.img('logoCamp', d.logoCamp, 18, 11, 20, false));
    this.elementos = els;
  }

  /** Matchday — moldura, barra "DIA DE JOGO", VS central e badges. */
  private modeloMatchday(d: DadosJogo): void {
    this.fundo = 'escuro';
    this.fundoImgUrl = 'assets/fundos/estadio-dia.jpg';
    this.fundoCor = null;
    this.resetFundoAjuste();
    this.fundoOverlay = 0.3;
    const frame = this.F('frame', 'ret', 50, 50, 103.9, 117, '#ffffff', 1);
    frame.borda = true;
    const badge = this.F('badge', 'ret', 50, 80.8, 50, 8.5, '#ffffff', 1);
    badge.borda = true;
    const els: ArteEl[] = [
      frame,
      this.F('topbar', 'ret', 50, 31.8, 53.9, 8, '#f0b817', 1),
      this.T({ id: 'md', texto: 'DIA DE JOGO', xPct: 50, yPct: 31.8, tamanho: 6.5, fonte: 'Rajdhani', sombra: false }),
      this.T({ id: 'camp', texto: d.titulo, xPct: 48.9, yPct: 37.8, tamanho: 3.2, fonte: 'Rajdhani', negrito: false }),
    ];
    if (d.logoM) els.push(this.img('escM', d.logoM, 23.8, 53.4, 33.3, false));
    if (d.logoV) els.push(this.img('escV', d.logoV, 74, 55.1, 32.3, false));
    els.push(
      this.T({ id: 'vs', texto: 'VS', xPct: 50, yPct: 60.4, tamanho: 9.2, fonte: 'Rajdhani' }),
      this.T({ id: 'nomeM', texto: d.nomeM, xPct: 26, yPct: 71.4, tamanho: 5, fonte: 'Rajdhani' }),
      this.T({ id: 'nomeV', texto: d.nomeV, xPct: 74, yPct: 71.4, tamanho: 5, fonte: 'Rajdhani' }),
      badge,
      this.T({ id: 'data', texto: d.data, xPct: 50, yPct: 80.8, tamanho: 3.4, fonte: 'Teko', espac: 1.1, sombra: false }),
      this.T({ id: 'local', texto: d.local, xPct: 50, yPct: 87.6, tamanho: 4, fonte: 'Montserrat', negrito: false }),
    );
    if (d.logoCamp) els.push(this.img('logoCamp', d.logoCamp, 50, 16.5, 27.4, false));
    this.elementos = els;
  }

  /** Dia de Jogo — fundo de estádio, acentos nos cantos, "DIA DE / JOGO"
   *  em dois tons, X com escudos, badge de data e nomes. (Personagens 3D
   *  e logo do campeonato você adiciona como Imagem.) */
  private modeloDiaJogo(d: DadosJogo): void {
    this.fundo = 'escuro';
    this.fundoImgUrl = 'assets/fundos/arena.jpg';
    this.fundoCor = null;
    this.resetFundoAjuste();
    this.fundoOverlay = 0.3;
    const els: ArteEl[] = [
      this.F('tl', 'tri', 1, 4.8, 27.4, 12.1, '#ffffff', 0.65, -25),
      this.F('tr', 'tri', 98.75, 1, 28.5, 12.6, '#ffffff', 0.7, -29),
      this.T({ id: 'camp', texto: d.titulo, xPct: 50, yPct: 24, tamanho: 2.8, fonte: 'Rajdhani', negrito: false }),
    ];
    if (d.logoM) els.push(this.img('escM', d.logoM, 22.75, 44.2, 53.3, false));
    if (d.logoV) els.push(this.img('escV', d.logoV, 78, 46, 54.4, false));
    els.push(
      this.T({ id: 'kicker', texto: 'DIA DE', xPct: 50, yPct: 49, tamanho: 5, fonte: 'Oswald', italico: true }),
      this.T({ id: 'titulo', texto: 'JOGO', xPct: 50, yPct: 58, tamanho: 14, italico: true }),
      this.F('badge', 'ret', 50, 70, 50, 8, '#000000', 0.5),
      this.T({ id: 'data', texto: d.data, xPct: 50, yPct: 70, tamanho: 3.4, fonte: 'Rajdhani', sombra: false }),
      this.T({ id: 'local', texto: d.local, xPct: 50, yPct: 75.4, tamanho: 4.6, fonte: 'Rajdhani', negrito: false, italico: true, sombra: false }),
      this.T({ id: 'nomeM', texto: d.nomeM, xPct: 26, yPct: 83, tamanho: 4, fonte: 'Rajdhani' }),
      this.T({ id: 'vs', texto: 'VS', xPct: 50, yPct: 83, tamanho: 4.2, fonte: 'Oswald' }),
      this.T({ id: 'nomeV', texto: d.nomeV, xPct: 74, yPct: 83, tamanho: 4, fonte: 'Rajdhani' }),
    );
    if (d.logoCamp) els.push(this.img('logoCamp', d.logoCamp, 50, 12, 24.8, false));
    els.push(
      this.F('dec1', 'tri', 98.75, 99, 28.5, 12.6, '#ffffff', 0.8, -29),
      this.F('dec2', 'tri', 1, 99, 27.4, 12.1, '#ffffff', 0.75, -25),
    );
    this.elementos = els;
  }

  /** Re-tematiza os modelos com a cor de acento atual. */
  reaplicarAccent(): void {
    this.aplicarModelo(this.modeloAtivo);
  }

  // ─── seleção / propriedades ────────────────────────────────────────
  get sel(): ArteEl | undefined {
    return this.elementos.find(e => e.id === this.selecionadoId);
  }
  selecionar(id: string | null): void {
    if (!id) {
      this.selecao.clear();
      this.selecionadoId = null;
      return;
    }
    if (this.multiSel) {
      if (this.selecao.has(id)) this.selecao.delete(id);
      else this.selecao.add(id);
      this.selecionadoId = this.selecao.size ? id : null;
    } else {
      this.selecao.clear();
      this.selecao.add(id);
      this.selecionadoId = id;
    }
    if (this.selecionadoId && !this.capturando) this.painelAtivo = 'editar';
    this.agendarRecalcGrupo();
  }

  toggleMulti(): void {
    this.multiSel = !this.multiSel;
  }

  /** Abre um painel do rail; ao abrir Elementos, já carrega a grade. */
  abrirPainel(id: 'modelos' | 'adicionar' | 'elementos' | 'fundo' | 'camadas' | 'editar'): void {
    this.painelAtivo = id;
    if (id === 'elementos' && !this.elemResultados.length && !this.elemBuscando) {
      this.buscarElementos();
    }
  }

  // ─── zoom do workspace (apenas visual; não afeta o export) ─────────
  zoom = 100;
  zoomMais(): void { this.zoom = this.clamp(this.zoom + 10, 40, 220); }
  zoomMenos(): void { this.zoom = this.clamp(this.zoom - 10, 40, 220); }
  zoomReset(): void { this.zoom = 100; }

  /** Clique no canvas vazio: desseleciona e abre o painel de Fundo
   *  (permite editar/escurecer/remover a imagem de fundo). */
  cliqueCanvas(): void {
    this.selecionar(null);
    if (!this.capturando) this.painelAtivo = 'fundo';
  }

  estaSelecionado(id: string): boolean {
    return this.selecao.has(id);
  }
  fundoClass(): string {
    if (this.fundoImgUrl) return '';
    if (this.fundoCor) return '';
    return `fundo-${this.fundo}`;
  }

  /** Estilo CSS do elemento forma (background/clip por tipo). */
  formaEstilo(el: ArteEl): { [k: string]: string } {
    const cor = el.cor ?? '#ffffff';
    if (el.forma === 'pontos') {
      return {
        'background-image': `radial-gradient(${cor} 30%, transparent 32%)`,
        'background-size': '2.6cqw 2.6cqw',
      };
    }
    if (el.borda) {
      return { background: 'transparent', border: `${el.bordaW ?? 0.7}cqw solid ${cor}` };
    }
    return { background: cor };
  }

  // ─── alinhar / espelhar / bloquear / ocultar ───────────────────────
  alinhar(tipo: 'esq' | 'cx' | 'dir' | 'topo' | 'cy' | 'base'): void {
    const els = this.elementos.filter(e => this.selecao.has(e.id));
    if (els.length < 2) return;
    const xs = els.map(e => e.xPct), ys = els.map(e => e.yPct);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    for (const e of els) {
      if (tipo === 'esq') e.xPct = minX;
      else if (tipo === 'cx') e.xPct = (minX + maxX) / 2;
      else if (tipo === 'dir') e.xPct = maxX;
      else if (tipo === 'topo') e.yPct = minY;
      else if (tipo === 'cy') e.yPct = (minY + maxY) / 2;
      else if (tipo === 'base') e.yPct = maxY;
    }
    this.commit();
  }

  /** Alinha o elemento selecionado em relação à PÁGINA (canvas). */
  alinharPagina(tipo: 'esq' | 'cx' | 'dir' | 'topo' | 'cy' | 'base'): void {
    const el = this.sel;
    const canvas = this.canvasEl?.nativeElement;
    if (!el || !canvas) return;
    const cRect = canvas.getBoundingClientRect();
    const node = canvas.querySelector('.ae-el[data-id="' + el.id + '"]') as HTMLElement | null;
    let halfW = 5, halfH = 5;
    if (node) {
      const r = node.getBoundingClientRect();
      halfW = (r.width / cRect.width) * 100 / 2;
      halfH = (r.height / cRect.height) * 100 / 2;
    }
    const m = 1.5;
    if (tipo === 'esq') el.xPct = this.clamp(halfW + m, 1, 99);
    else if (tipo === 'cx') el.xPct = 50;
    else if (tipo === 'dir') el.xPct = this.clamp(100 - halfW - m, 1, 99);
    else if (tipo === 'topo') el.yPct = this.clamp(halfH + m, 1, 99);
    else if (tipo === 'cy') el.yPct = 50;
    else if (tipo === 'base') el.yPct = this.clamp(100 - halfH - m, 1, 99);
    this.commit();
  }

  /** Distribui 3+ selecionados com espaçamento igual no eixo. */
  distribuir(eixo: 'h' | 'v'): void {
    const els = this.elementos.filter(e => this.selecao.has(e.id));
    if (els.length < 3) return;
    els.sort((a, b) => (eixo === 'h' ? a.xPct - b.xPct : a.yPct - b.yPct));
    const ini = eixo === 'h' ? els[0].xPct : els[0].yPct;
    const fim = eixo === 'h' ? els[els.length - 1].xPct : els[els.length - 1].yPct;
    const passo = (fim - ini) / (els.length - 1);
    els.forEach((e, i) => {
      const v = ini + passo * i;
      if (eixo === 'h') e.xPct = v; else e.yPct = v;
    });
    this.commit();
  }

  /** Escala (aumenta/diminui) o tamanho de todos os selecionados. */
  escalarSelecao(fator: number): void {
    let mudou = false;
    for (const e of this.elementos) {
      if (!this.selecao.has(e.id) || e.bloqueado) continue;
      if (e.tipo === 'texto') e.tamanho = this.clamp((e.tamanho ?? 4) * fator, 1.2, 40);
      else if (e.tipo === 'imagem') e.imgLargura = this.clamp((e.imgLargura ?? 20) * fator, 4, 100);
      else {
        e.formaLargura = this.clamp((e.formaLargura ?? 20) * fator, 2, 130);
        e.formaAltura = this.clamp((e.formaAltura ?? 20) * fator, 0.5, 150);
      }
      mudou = true;
    }
    if (mudou) this.commit();
    this.agendarRecalcGrupo();
  }

  /** Recalcula a caixa que envolve os selecionados (via medição no DOM). */
  private recalcGrupo(): void {
    const canvas = this.canvasEl?.nativeElement;
    if (this.selecao.size < 2 || !canvas) { this.grupo = null; return; }
    const cR = canvas.getBoundingClientRect();
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    this.selecao.forEach(id => {
      const n = canvas.querySelector('.ae-el[data-id="' + id + '"]') as HTMLElement | null;
      if (!n) return;
      const r = n.getBoundingClientRect();
      minX = Math.min(minX, ((r.left - cR.left) / cR.width) * 100);
      minY = Math.min(minY, ((r.top - cR.top) / cR.height) * 100);
      maxX = Math.max(maxX, ((r.right - cR.left) / cR.width) * 100);
      maxY = Math.max(maxY, ((r.bottom - cR.top) / cR.height) * 100);
    });
    if (minX > maxX) { this.grupo = null; return; }
    this.grupo = { l: minX, t: minY, w: maxX - minX, h: maxY - minY };
  }
  private agendarRecalcGrupo(): void {
    setTimeout(() => this.recalcGrupo(), 0);
  }

  /** Início do arraste da alça do grupo (escala todos os selecionados). */
  onGrupoDown(ev: PointerEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const canvas = this.canvasEl?.nativeElement;
    this.rect = canvas?.getBoundingClientRect();
    if (!this.rect || !this.grupo) return;
    this.modo = 'grupo';
    this.moved = false;
    this.grupoCx = this.grupo.l + this.grupo.w / 2;   // % largura
    this.grupoCy = this.grupo.t + this.grupo.h / 2;   // % altura
    const cx = this.rect.left + (this.grupoCx / 100) * this.rect.width;
    const cy = this.rect.top + (this.grupoCy / 100) * this.rect.height;
    this.startGrupo = { cx, cy, dist: Math.hypot(ev.clientX - cx, ev.clientY - cy) || 1 };
    this.grupoStartSizes.clear();
    for (const e of this.elementos) {
      if (!this.selecao.has(e.id)) continue;
      const size = e.tipo === 'texto' ? (e.tamanho ?? 4)
        : e.tipo === 'imagem' ? (e.imgLargura ?? 20) : (e.formaLargura ?? 20);
      this.grupoStartSizes.set(e.id, { size, h: e.formaAltura ?? 20, x: e.xPct, y: e.yPct });
    }
  }

  flip(el: ArteEl, eixo: 'h' | 'v'): void {
    if (eixo === 'h') el.flipH = !el.flipH;
    else el.flipV = !el.flipV;
    this.commit();
  }
  toggleBloqueado(el: ArteEl): void {
    el.bloqueado = !el.bloqueado;
    this.commit();
  }
  toggleOculto(el: ArteEl): void {
    el.oculto = !el.oculto;
    this.commit();
  }

  removerSelecionados(): void {
    if (!this.selecao.size) return;
    this.elementos = this.elementos.filter(e => !this.selecao.has(e.id));
    this.selecao.clear();
    this.selecionadoId = null;
    this.commit();
  }

  // ── copiar / colar / selecionar tudo ──
  private copiar(): void {
    this.clipboard = this.elementos
      .filter(e => this.selecao.has(e.id))
      .map(e => JSON.parse(JSON.stringify(e)) as ArteEl);
  }
  colar(): void {
    if (!this.clipboard.length) return;
    this.selecao.clear();
    this.clipboard.forEach((c, i) => {
      const novo = JSON.parse(JSON.stringify(c)) as ArteEl;
      novo.id = 'cp-' + Date.now().toString(36) + (this.elementos.length + i);
      novo.xPct = this.clamp(c.xPct + 4, 1, 99);
      novo.yPct = this.clamp(c.yPct + 4, 1, 99);
      this.elementos.push(novo);
      this.selecao.add(novo.id);
      this.selecionadoId = novo.id;
    });
    this.commit();
  }
  selecionarTudo(): void {
    this.selecao = new Set(this.elementos.filter(e => !e.oculto && !e.bloqueado).map(e => e.id));
    const arr = [...this.selecao];
    this.selecionadoId = arr.length ? arr[arr.length - 1] : null;
    if (this.selecionadoId && !this.capturando) this.painelAtivo = 'editar';
  }

  // ─── fundos: presets / foto / banco ────────────────────────────────
  setFundoPreset(id: string): void {
    this.fundo = id;
    this.fundoImgUrl = null;
    this.fundoCor = null;
    this.commit();
  }
  /** Cor sólida personalizada como fundo. */
  setFundoCor(cor: string): void {
    this.fundoCor = cor;
    this.fundoImgUrl = null;
    this.commit();
  }
  onUploadFundo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.fundoImgUrl = String(reader.result); this.resetFundoAjuste(); this.commit(); };
    reader.readAsDataURL(file);
    input.value = '';
  }
  limparFundoImg(): void {
    this.fundoImgUrl = null;
    this.resetFundoAjuste();
    this.commit();
  }

  /** Aplica uma foto de fundo pronta (asset embutido). */
  usarFundoFoto(url: string): void {
    this.fundoImgUrl = url;
    this.resetFundoAjuste();
    this.commit();
  }

  // ── banco de imagens (Wikimedia Commons — sem chave) ──
  async buscarBanco(): Promise<void> {
    const q = this.buscaQuery.trim();
    if (!q) return;
    this.buscando = true;
    this.buscaErro = '';
    this.resultados = [];
    try {
      // origin=* → requisição anônima com CORS liberado; namespace 6 = arquivos;
      // iiurlwidth=700 devolve uma miniatura servida pelo upload.wikimedia (CORS ok).
      const params =
        'action=query&format=json&origin=*&generator=search&gsrnamespace=6' +
        '&gsrlimit=24&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=700' +
        '&gsrsearch=' + encodeURIComponent(q + ' filetype:bitmap');
      const resp = await fetch('https://commons.wikimedia.org/w/api.php?' + params);
      if (!resp.ok) { this.buscaErro = 'Falha na busca (erro ' + resp.status + ').'; return; }
      const data = await resp.json() as {
        query?: { pages?: Record<string, {
          imageinfo?: { thumburl?: string; url?: string; extmetadata?: { Artist?: { value?: string } } }[];
        }> };
      };
      const pages = data.query?.pages ? Object.values(data.query.pages) : [];
      this.resultados = pages.map(p => {
        const info = p.imageinfo?.[0];
        const artist = (info?.extmetadata?.Artist?.value ?? '').replace(/<[^>]*>/g, '').trim();
        const thumb = info?.thumburl ?? '';
        return { thumb, full: thumb || info?.url || '', autor: artist };
      }).filter(r => r.thumb);
      if (!this.resultados.length) this.buscaErro = 'Nada encontrado para "' + q + '".';
    } catch (e) {
      console.error('[ArteJogo] busca Wikimedia erro', e);
      this.buscaErro = 'Erro de rede ao buscar imagens.';
    } finally {
      this.buscando = false;
    }
  }

  /** Aplica a imagem escolhida. Converte pra dataURL (export sem CORS);
   *  se a original falhar, tenta a miniatura (servida pelo Openverse). */
  async usarImagemBanco(r: { full: string; thumb: string }): Promise<void> {
    this.buscando = true;
    try {
      this.fundoImgUrl = await this.baixarDataUrl(r.full);
    } catch {
      try {
        this.fundoImgUrl = await this.baixarDataUrl(r.thumb);
      } catch (e) {
        console.error('[ArteJogo] baixar imagem erro', e);
        this.fundoImgUrl = r.thumb || r.full;
      }
    } finally {
      this.buscando = false;
      this.resetFundoAjuste();
      this.commit();
    }
  }

  private async baixarDataUrl(url: string): Promise<string> {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('http ' + resp.status);
    const blob = await resp.blob();
    return this.blobParaDataUrl(blob);
  }

  // ── elementos (Iconify) ──
  private iconUrl(nome: string, altura: number, cor?: string): string {
    let u = 'https://api.iconify.design/' + nome.replace(':', '/') + '.svg?height=' + altura;
    if (cor) u += '&color=' + encodeURIComponent(cor);
    return u;
  }
  setElemModo(m: 'icones' | 'cor'): void {
    if (this.elemModo === m) return;
    this.elemModo = m;
    if (this.elemQuery.trim()) this.buscarElementos();
  }
  async buscarElementos(): Promise<void> {
    const q = this.elemQuery.trim();
    if (!q) return;
    this.elemBuscando = true;
    this.elemErro = '';
    this.elemResultados = [];
    try {
      // modo "cor": vários acervos coloridos/3D (emojis + ícones coloridos)
      const pref = this.elemModo === 'cor'
        ? '&prefixes=noto,fluent-emoji,twemoji,openmoji,emojione,fxemoji,streamline-emojis,flat-color-icons'
        : '';
      const resp = await fetch('https://api.iconify.design/search?query=' + encodeURIComponent(q) + '&limit=48' + pref);
      if (!resp.ok) { this.elemErro = 'Falha na busca (erro ' + resp.status + ').'; return; }
      const data = await resp.json() as { icons?: string[] };
      const cor = this.elemModo === 'icones' ? this.accent : undefined;
      this.elemResultados = (data.icons ?? []).map(nome => ({ nome, url: this.iconUrl(nome, 90, cor) }));
      if (!this.elemResultados.length) this.elemErro = 'Nada encontrado para "' + q + '".';
    } catch (e) {
      console.error('[ArteJogo] busca Iconify erro', e);
      this.elemErro = 'Erro de rede ao buscar elementos.';
    } finally {
      this.elemBuscando = false;
    }
  }
  /** Insere o elemento como imagem (SVG → dataURL). Flat = cor do tema;
   *  coloridos/3D mantêm as cores originais. */
  async usarElemento(nome: string): Promise<void> {
    try {
      const cor = this.elemModo === 'icones' ? this.accent : undefined;
      const resp = await fetch(this.iconUrl(nome, 320, cor));
      const svg = await resp.text();
      const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      const id = 'el-' + Date.now().toString(36) + this.elementos.length;
      this.elementos.push(this.img(id, dataUrl, 50, 50, 18, false));
      this.selecionar(id);
      this.commit();
    } catch (e) {
      console.error('[ArteJogo] inserir elemento erro', e);
    }
  }
  private blobParaDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ─── adicionar elementos ───────────────────────────────────────────
  addTexto(): void {
    const id = 'txt-' + Date.now().toString(36) + this.elementos.length;
    const el = this.T({ id, texto: 'Novo texto', xPct: 50, yPct: 50, tamanho: 4, fonte: 'Montserrat' });
    this.elementos.push(el);
    this.selecionar(id);
    this.commit();
  }
  addTextoPreset(tipo: 'titulo' | 'subtitulo' | 'corpo'): void {
    const presets = {
      titulo: { texto: 'TÍTULO', tamanho: 9, fonte: 'Anton', negrito: true },
      subtitulo: { texto: 'Subtítulo', tamanho: 4.6, fonte: 'Oswald', negrito: true },
      corpo: { texto: 'Toque para editar', tamanho: 3, fonte: 'Montserrat', negrito: false },
    };
    const p = presets[tipo];
    const id = 'txt-' + Date.now().toString(36) + this.elementos.length;
    this.elementos.push(this.T({ id, texto: p.texto, xPct: 50, yPct: 50, tamanho: p.tamanho, fonte: p.fonte, negrito: p.negrito }));
    this.selecionar(id);
    this.commit();
  }
  /** Insere um elemento rápido (colorido). */
  async inserirRapido(nome: string): Promise<void> {
    try {
      const resp = await fetch(this.iconUrl(nome, 320));
      const svg = await resp.text();
      const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      const id = 'el-' + Date.now().toString(36) + this.elementos.length;
      this.elementos.push(this.img(id, dataUrl, 50, 50, 16, false));
      this.selecionar(id);
      this.commit();
    } catch (e) { console.error('[ArteJogo] rápido erro', e); }
  }
  addForma(kind: FormaKind): void {
    const id = 'fm-' + Date.now().toString(36) + this.elementos.length;
    const alt = kind === 'faixa' ? 2 : kind === 'pontos' ? 22 : 20;
    const larg = kind === 'faixa' ? 60 : kind === 'pontos' ? 30 : 26;
    this.elementos.push(this.F(id, kind, 50, 50, larg, alt, this.accent, kind === 'pontos' ? 0.9 : 1));
    this.selecionar(id);
    this.commit();
  }
  onUploadImagem(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = 'img-' + Date.now().toString(36) + this.elementos.length;
      this.elementos.push(this.img(id, String(reader.result), 50, 50, 30, false));
      this.selecionar(id);
      this.commit();
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  remover(id: string): void {
    this.elementos = this.elementos.filter(e => e.id !== id);
    if (this.selecionadoId === id) this.selecionar(null);
    this.commit();
  }
  duplicar(el: ArteEl): void {
    const novo: ArteEl = { ...el, id: el.id + '-c' + this.elementos.length, xPct: el.xPct + 4, yPct: el.yPct + 4 };
    this.elementos.push(novo);
    this.selecionar(novo.id);
    this.commit();
  }
  frente(el: ArteEl): void {
    this.elementos = [...this.elementos.filter(e => e !== el), el];
    this.commit();
  }
  tras(el: ArteEl): void {
    this.elementos = [el, ...this.elementos.filter(e => e !== el)];
    this.commit();
  }
  /** Commit de propriedade (chamado pelos controles do painel). */
  commitProp(): void {
    this.commit();
  }

  rotuloCamada(el: ArteEl): string {
    if (el.tipo === 'texto') return el.texto || 'Texto';
    if (el.tipo === 'imagem') return 'Imagem';
    return 'Forma';
  }
  iconeCamada(el: ArteEl): string {
    if (el.tipo === 'texto') return 'text-outline';
    if (el.tipo === 'imagem') return 'image-outline';
    return 'shapes-outline';
  }

  // ─── arraste e redimensionamento (pointer) ─────────────────────────
  onDown(ev: PointerEvent, el: ArteEl, modo: 'drag' | 'resize', dir: 'c' | 'x' | 'y' = 'c'): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (el.bloqueado) { this.selecionar(el.id); return; }
    this.resizeDir = dir;
    this.modo = modo;
    this.elAtivo = el;
    this.moved = false;
    this.rect = this.canvasEl?.nativeElement.getBoundingClientRect();
    this.startX = ev.clientX;
    this.startY = ev.clientY;

    // ── seleção (Shift ou modo "Vários" = múltipla) ──
    const multi = this.multiSel || ev.shiftKey;
    this.downMulti = multi;
    this.downId = el.id;
    this.downWasSel = this.selecao.has(el.id);
    if (!this.selecao.has(el.id)) {
      if (!multi) this.selecao.clear();
      this.selecao.add(el.id);
    }
    this.selecionadoId = el.id;
    if (!this.capturando) this.painelAtivo = 'editar';

    // snapshot das posições de todos os selecionados (arraste em grupo)
    this.grpStart.clear();
    for (const e of this.elementos) {
      if (this.selecao.has(e.id)) this.grpStart.set(e.id, { x: e.xPct, y: e.yPct });
    }

    const size = el.tipo === 'texto' ? (el.tamanho ?? 4)
      : el.tipo === 'imagem' ? (el.imgLargura ?? 20)
      : (el.formaLargura ?? 20);
    this.startVal = { x: el.xPct, y: el.yPct, size };
    this.startRatio = el.tipo === 'forma' ? (el.formaAltura ?? 1) / (el.formaLargura ?? 1) : 1;
    this.startW = el.formaLargura ?? 20;
    this.startH = el.formaAltura ?? 20;
    if (this.rect) {
      this.startCx = this.rect.left + (el.xPct / 100) * this.rect.width;
      this.startCy = this.rect.top + (el.yPct / 100) * this.rect.height;
      this.startDist = Math.hypot(ev.clientX - this.startCx, ev.clientY - this.startCy) || 1;
      this.startDistX = Math.max(Math.abs(ev.clientX - this.startCx), 1);
      this.startDistY = Math.max(Math.abs(ev.clientY - this.startCy), 1);
    }
  }

  @HostListener('document:pointermove', ['$event'])
  onMove(ev: PointerEvent): void {
    if (this.modo === 'grupo' && this.rect) {
      this.moved = true;
      const dist = Math.hypot(ev.clientX - this.startGrupo.cx, ev.clientY - this.startGrupo.cy);
      const r = this.clamp(dist / this.startGrupo.dist, 0.2, 6);
      for (const e of this.elementos) {
        const s = this.grupoStartSizes.get(e.id);
        if (!s) continue;
        e.xPct = this.clamp(this.grupoCx + (s.x - this.grupoCx) * r, 1, 99);
        e.yPct = this.clamp(this.grupoCy + (s.y - this.grupoCy) * r, 1, 99);
        if (e.tipo === 'texto') e.tamanho = this.clamp(s.size * r, 1.2, 40);
        else if (e.tipo === 'imagem') e.imgLargura = this.clamp(s.size * r, 4, 100);
        else { e.formaLargura = this.clamp(s.size * r, 2, 130); e.formaAltura = this.clamp(s.h * r, 0.5, 150); }
      }
      return;
    }
    if (this.modo === 'idle' || !this.elAtivo || !this.rect) return;
    this.moved = true;
    const dxPct = ((ev.clientX - this.startX) / this.rect.width) * 100;
    const dyPct = ((ev.clientY - this.startY) / this.rect.height) * 100;
    if (this.modo === 'drag') {
      if (this.selecao.size > 1) {
        // arraste em grupo — move todos pela mesma distância (sem snap)
        this.guiaV = null; this.guiaH = null;
        for (const e of this.elementos) {
          const s = this.grpStart.get(e.id);
          if (!s) continue;
          e.xPct = this.clamp(s.x + dxPct, 1, 99);
          e.yPct = this.clamp(s.y + dyPct, 1, 99);
        }
        return;
      }
      let nx = this.clamp(this.startVal.x + dxPct, 1, 99);
      let ny = this.clamp(this.startVal.y + dyPct, 1, 99);
      // snap em centro do canvas (50) e centros dos outros elementos
      const outros = this.elementos.filter(e => e !== this.elAtivo);
      const alvosX = [50, ...outros.map(e => e.xPct)];
      const alvosY = [50, ...outros.map(e => e.yPct)];
      const sx = this.snapPara(nx, alvosX);
      const sy = this.snapPara(ny, alvosY);
      this.guiaV = sx; this.guiaH = sy;
      if (sx != null) nx = sx;
      if (sy != null) ny = sy;
      this.elAtivo.xPct = nx;
      this.elAtivo.yPct = ny;
      return;
    }
    // redimensiona proporcional à distância do centro até o ponteiro
    const dist = Math.hypot(ev.clientX - this.startCx, ev.clientY - this.startCy);
    const ratio = dist / this.startDist;
    if (this.elAtivo.tipo === 'texto') {
      this.elAtivo.tamanho = this.clamp(this.startVal.size * ratio, 1.2, 40);
    } else if (this.elAtivo.tipo === 'imagem') {
      this.elAtivo.imgLargura = this.clamp(this.startVal.size * ratio, 4, 100);
    } else if (this.resizeDir === 'x') {
      const rx = Math.abs(ev.clientX - this.startCx) / this.startDistX;
      this.elAtivo.formaLargura = this.clamp(this.startW * rx, 2, 130);
    } else if (this.resizeDir === 'y') {
      const ry = Math.abs(ev.clientY - this.startCy) / this.startDistY;
      this.elAtivo.formaAltura = this.clamp(this.startH * ry, 0.5, 150);
    } else {
      const nova = this.clamp(this.startW * ratio, 2, 130);
      this.elAtivo.formaLargura = nova;
      this.elAtivo.formaAltura = this.clamp(nova * this.startRatio, 0.5, 150);
    }
  }

  @HostListener('document:pointerup')
  onUp(): void {
    // toque (sem arrastar) num item já selecionado, no modo Vários → remove
    if (this.modo === 'drag' && this.downMulti && !this.moved && this.downWasSel && this.downId) {
      this.selecao.delete(this.downId);
      const restantes = [...this.selecao];
      this.selecionadoId = restantes.length ? restantes[restantes.length - 1] : null;
    }
    const houveMov = this.moved && this.modo !== 'idle';
    this.modo = 'idle';
    this.elAtivo = undefined;
    this.guiaV = null;
    this.guiaH = null;
    if (houveMov) this.commit();
    this.agendarRecalcGrupo();
  }

  // ─── atalhos de teclado ────────────────────────────────────────────
  @HostListener('document:keydown', ['$event'])
  onKey(ev: KeyboardEvent): void {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const meta = ev.ctrlKey || ev.metaKey;
    const k = ev.key.toLowerCase();
    if (meta && k === 'z') { ev.preventDefault(); ev.shiftKey ? this.refazer() : this.desfazer(); return; }
    if (meta && k === 'y') { ev.preventDefault(); this.refazer(); return; }
    if (meta && k === 'd') { ev.preventDefault(); if (this.sel) this.duplicar(this.sel); return; }
    if (meta && k === 'c') { if (this.selecao.size) { ev.preventDefault(); this.copiar(); } return; }
    if (meta && k === 'v') { if (this.clipboard.length) { ev.preventDefault(); this.colar(); } return; }
    if (meta && k === 'a') { ev.preventDefault(); this.selecionarTudo(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      if (this.selecao.size) { ev.preventDefault(); this.removerSelecionados(); }
      return;
    }
    if (ev.key === 'Escape') { this.selecionar(null); return; }
    const passo = ev.shiftKey ? 5 : 1;
    const mover = (dx: number, dy: number) => {
      if (!this.selecao.size) return;
      ev.preventDefault();
      for (const e of this.elementos) {
        if (this.selecao.has(e.id) && !e.bloqueado) {
          e.xPct = this.clamp(e.xPct + dx, 1, 99);
          e.yPct = this.clamp(e.yPct + dy, 1, 99);
        }
      }
      this.commit();
    };
    if (ev.key === 'ArrowLeft') mover(-passo, 0);
    else if (ev.key === 'ArrowRight') mover(passo, 0);
    else if (ev.key === 'ArrowUp') mover(0, -passo);
    else if (ev.key === 'ArrowDown') mover(0, passo);
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }
  round(n: number): number { return Math.round(n); }

  /** Retorna o alvo mais próximo dentro do limiar de snap, ou null. */
  private snapPara(v: number, alvos: number[]): number | null {
    const limiar = 1.5; // % do canvas
    let melhor: number | null = null;
    let dist = limiar;
    for (const a of alvos) {
      const d = Math.abs(v - a);
      if (d <= dist) { dist = d; melhor = a; }
    }
    return melhor;
  }

  // ─── export ────────────────────────────────────────────────────────
  async exportar(): Promise<void> {
    if (!this.canvasEl) return;
    this.gerando = true;
    this.capturando = true;
    this.selecionar(null);
    await new Promise(r => setTimeout(r, 60));
    try {
      const node = this.canvasEl.nativeElement;
      const w = node.offsetWidth || 1080;
      const scale = 1080 / w;
      const canvas = await html2canvas(node, {
        backgroundColor: null, scale, useCORS: true, allowTaint: false,
      });
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject('blob null')), 'image/png');
      });
      // Download direto (não usa navigator.share — exige gesto e o
      // html2canvas assíncrono quebra o contexto do gesto → NotAllowedError).
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'arte-jogo.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      console.error('[ArteJogo] export erro', err);
      const t = await this.toastCtrl.create({
        message: 'Erro ao gerar a arte. Se houver logo de time, pode ser bloqueio de CORS.',
        duration: 3000, color: 'danger', position: 'top',
      });
      await t.present();
    } finally {
      this.capturando = false;
      this.gerando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private formatarData(iso: string): string {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
    if (!m) return iso;
    const dia = `${m[3]}/${m[2]}/${m[1]}`;
    return m[4] ? `${dia} • ${m[4]}:${m[5]}` : dia;
  }
}
