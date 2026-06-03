import { Component, ElementRef, HostListener, Input, OnInit, ViewChild, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import html2canvas from 'html2canvas';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';

type ElTipo = 'texto' | 'imagem';

/** Um elemento livre na arte (texto ou imagem). Posição = centro em % do
 *  canvas; tamanhos em cqw (texto) / % de largura (imagem) — escalam com o
 *  canvas e exportam certo no html2canvas. */
interface ArteEl {
  id: string;
  tipo: ElTipo;
  xPct: number;
  yPct: number;
  // texto
  texto?: string;
  fonte?: string;
  tamanho?: number;     // cqw
  cor?: string;
  negrito?: boolean;
  italico?: boolean;
  align?: 'left' | 'center' | 'right';
  sombra?: boolean;
  // imagem
  src?: string;
  imgLargura?: number;  // % da largura do canvas
  circular?: boolean;
}

/**
 * Editor LIVRE da arte do jogo (canvas estilo Canva):
 *  - cada texto/imagem é arrastável e redimensionável;
 *  - painel de propriedades por elemento (fonte, tamanho, cor, etc.);
 *  - fundos prontos + upload de imagem;
 *  - exporta o canvas em PNG via html2canvas (Web Share / download).
 */
@Component({
  selector: 'app-arte-do-jogo-modal',
  templateUrl: './arte-do-jogo-modal.component.html',
  styleUrls: ['./arte-do-jogo-modal.component.scss'],
  standalone: false,
})
export class ArteDoJogoModalComponent implements OnInit {
  @Input() jogo!: Jogo;
  @Input() mandante?: Equipe;
  @Input() visitante?: Equipe;
  @Input() campeonato?: Campeonato;
  @Input() categoria?: Categoria;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  @ViewChild('canvas', { read: ElementRef }) canvasEl?: ElementRef<HTMLElement>;

  gerando = false;
  capturando = false;
  selecionadoId: string | null = null;

  fundo = 'gramado';
  /** URL/dataURL da imagem de fundo (foto própria ou banco). Quando
   *  preenchido, sobrepõe o preset CSS de cor. */
  fundoImgUrl: string | null = null;
  /** Aba ativa do seletor de fundo. */
  fundoAba: 'cores' | 'foto' | 'banco' = 'cores';

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

  // ─── banco de imagens online (Pexels) ──────────────────────────────
  private static readonly PEXELS_KEY_LS = 'placar:pexelsKey';
  pexelsKey = '';
  buscaQuery = 'estádio futebol';
  buscando = false;
  buscaErro = '';
  resultados: { thumb: string; full: string; autor: string }[] = [];

  readonly fontes: string[] = [
    'Anton', 'Bebas Neue', 'Oswald', 'Archivo Black',
    'Montserrat', 'Poppins', 'Inter', 'Georgia',
  ];

  elementos: ArteEl[] = [];

  // ─── estado de arraste/resize ──────────────────────────────────────
  private modo: 'idle' | 'drag' | 'resize' = 'idle';
  private elAtivo?: ArteEl;
  private startX = 0;
  private startY = 0;
  private startVal = { x: 0, y: 0, size: 0 };
  private rect?: DOMRect;

  ngOnInit(): void {
    try {
      this.pexelsKey = localStorage.getItem(ArteDoJogoModalComponent.PEXELS_KEY_LS) ?? '';
    } catch { /* localStorage indisponível */ }

    const placarVis = this.jogo?.status === 'encerrado' || this.jogo?.status === 'em-andamento';
    const placar = placarVis
      ? `${this.jogo?.golsMandante ?? 0}  ×  ${this.jogo?.golsVisitante ?? 0}`
      : 'VS';
    const dataHora = this.jogo?.dataHora ?? '';
    const dataFmt = this.formatarData(dataHora);

    const els: ArteEl[] = [
      this.txt('titulo', (this.campeonato?.titulo ?? 'CAMPEONATO').toUpperCase(), 50, 11, 5.4, true),
      this.txt('subtitulo', this.categoria?.titulo ?? '', 50, 18, 3, false),
      this.txt('placar', placar, 50, 45, 8, true),
      this.txt('nomeM', this.mandante?.nome ?? 'Mandante', 27, 64, 3.2, true),
      this.txt('nomeV', this.visitante?.nome ?? 'Visitante', 73, 64, 3.2, true),
      this.txt('data', dataFmt, 50, 83, 3.2, true),
      this.txt('local', this.jogo?.local ?? '', 50, 89, 2.4, false),
    ];
    if (this.mandante?.logoUrl) els.push(this.img('escM', this.mandante.logoUrl, 27, 44, 26, true));
    if (this.visitante?.logoUrl) els.push(this.img('escV', this.visitante.logoUrl, 73, 44, 26, true));

    this.elementos = els.filter(e => e.tipo === 'imagem' || (e.texto ?? '').trim().length > 0);
  }

  // ─── fábrica de elementos ──────────────────────────────────────────
  private txt(id: string, texto: string, x: number, y: number, tam: number, sombra: boolean): ArteEl {
    return {
      id, tipo: 'texto', texto, xPct: x, yPct: y, tamanho: tam,
      fonte: 'Anton', cor: '#ffffff', negrito: true, italico: false,
      align: 'center', sombra,
    };
  }
  private img(id: string, src: string, x: number, y: number, larg: number, circular: boolean): ArteEl {
    return { id, tipo: 'imagem', src, xPct: x, yPct: y, imgLargura: larg, circular };
  }

  // ─── seleção / propriedades ────────────────────────────────────────
  get sel(): ArteEl | undefined {
    return this.elementos.find(e => e.id === this.selecionadoId);
  }
  selecionar(id: string | null): void {
    this.selecionadoId = id;
  }
  fundoClass(): string {
    return this.fundoImgUrl ? 'fundo-img' : `fundo-${this.fundo}`;
  }

  // ─── fundos: presets / foto / banco ────────────────────────────────
  /** Escolhe um preset CSS de cor (limpa eventual imagem de fundo). */
  setFundoPreset(id: string): void {
    this.fundo = id;
    this.fundoImgUrl = null;
  }

  /** Upload de foto do dispositivo como fundo da arte. */
  onUploadFundo(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.fundoImgUrl = String(reader.result); };
    reader.readAsDataURL(file);
    input.value = '';
  }

  /** Remove a imagem de fundo, voltando pro preset de cor selecionado. */
  limparFundoImg(): void {
    this.fundoImgUrl = null;
  }

  // ── banco de imagens (Pexels) ──
  salvarPexelsKey(valor: string): void {
    this.pexelsKey = (valor ?? '').trim();
    try {
      if (this.pexelsKey) localStorage.setItem(ArteDoJogoModalComponent.PEXELS_KEY_LS, this.pexelsKey);
      else localStorage.removeItem(ArteDoJogoModalComponent.PEXELS_KEY_LS);
    } catch { /* ignore */ }
  }

  async buscarBanco(): Promise<void> {
    const q = this.buscaQuery.trim();
    if (!q || !this.pexelsKey) return;
    this.buscando = true;
    this.buscaErro = '';
    this.resultados = [];
    try {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24&orientation=portrait`;
      const resp = await fetch(url, { headers: { Authorization: this.pexelsKey } });
      if (resp.status === 401) {
        this.buscaErro = 'Chave inválida. Verifique sua chave Pexels.';
        return;
      }
      if (!resp.ok) {
        this.buscaErro = 'Falha na busca (erro ' + resp.status + ').';
        return;
      }
      const data = await resp.json() as {
        photos?: { src?: { medium?: string; portrait?: string; large2x?: string }; photographer?: string }[];
      };
      this.resultados = (data.photos ?? []).map(p => ({
        thumb: p.src?.medium ?? p.src?.portrait ?? '',
        full: p.src?.portrait ?? p.src?.large2x ?? p.src?.medium ?? '',
        autor: p.photographer ?? '',
      })).filter(r => r.full);
      if (!this.resultados.length) this.buscaErro = 'Nada encontrado para "' + q + '".';
    } catch (e) {
      console.error('[ArteJogo] busca banco erro', e);
      this.buscaErro = 'Erro de rede ao buscar imagens.';
    } finally {
      this.buscando = false;
    }
  }

  /** Usa uma imagem do banco como fundo. Converte pra dataURL antes
   *  (garante export via html2canvas sem problema de CORS). */
  async usarImagemBanco(full: string): Promise<void> {
    this.buscando = true;
    try {
      const resp = await fetch(full);
      const blob = await resp.blob();
      this.fundoImgUrl = await this.blobParaDataUrl(blob);
    } catch (e) {
      console.error('[ArteJogo] baixar imagem banco erro', e);
      // fallback: usa a URL direta (export pode exigir CORS)
      this.fundoImgUrl = full;
    } finally {
      this.buscando = false;
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

  addTexto(): void {
    const id = 'txt-' + this.elementos.length + '-' + (this.elementos.length * 7 + 3);
    const el = this.txt(id, 'Novo texto', 50, 50, 4, true);
    el.fonte = 'Montserrat';
    this.elementos.push(el);
    this.selecionar(id);
  }

  onUploadImagem(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const id = 'img-' + this.elementos.length + '-' + (this.elementos.length * 5 + 1);
      this.elementos.push(this.img(id, String(reader.result), 50, 50, 30, false));
      this.selecionar(id);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  remover(id: string): void {
    this.elementos = this.elementos.filter(e => e.id !== id);
    if (this.selecionadoId === id) this.selecionar(null);
  }
  duplicar(el: ArteEl): void {
    const novo: ArteEl = { ...el, id: el.id + '-c' + this.elementos.length, xPct: el.xPct + 4, yPct: el.yPct + 4 };
    this.elementos.push(novo);
    this.selecionar(novo.id);
  }
  frente(el: ArteEl): void {
    this.elementos = [...this.elementos.filter(e => e !== el), el];
  }
  tras(el: ArteEl): void {
    this.elementos = [el, ...this.elementos.filter(e => e !== el)];
  }

  // ─── arraste e redimensionamento (pointer) ─────────────────────────
  onDown(ev: PointerEvent, el: ArteEl, modo: 'drag' | 'resize'): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.selecionar(el.id);
    this.modo = modo;
    this.elAtivo = el;
    this.rect = this.canvasEl?.nativeElement.getBoundingClientRect();
    this.startX = ev.clientX;
    this.startY = ev.clientY;
    this.startVal = {
      x: el.xPct,
      y: el.yPct,
      size: el.tipo === 'texto' ? (el.tamanho ?? 4) : (el.imgLargura ?? 20),
    };
  }

  @HostListener('document:pointermove', ['$event'])
  onMove(ev: PointerEvent): void {
    if (this.modo === 'idle' || !this.elAtivo || !this.rect) return;
    const dxPct = ((ev.clientX - this.startX) / this.rect.width) * 100;
    const dyPct = ((ev.clientY - this.startY) / this.rect.height) * 100;
    if (this.modo === 'drag') {
      this.elAtivo.xPct = this.clamp(this.startVal.x + dxPct, 2, 98);
      this.elAtivo.yPct = this.clamp(this.startVal.y + dyPct, 2, 98);
    } else {
      const d = (dxPct + dyPct) / 2;
      if (this.elAtivo.tipo === 'texto') {
        this.elAtivo.tamanho = this.clamp(this.startVal.size + d * 0.6, 1.5, 28);
      } else {
        this.elAtivo.imgLargura = this.clamp(this.startVal.size + d, 5, 95);
      }
    }
  }

  @HostListener('document:pointerup')
  onUp(): void {
    this.modo = 'idle';
    this.elAtivo = undefined;
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
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
        backgroundColor: null,
        scale,
        useCORS: true,
        allowTaint: false,
      });
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject('blob null')), 'image/png');
      });
      const arquivo = new File([blob], 'arte-jogo.png', { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (navigator.share && nav.canShare?.({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], title: 'Arte do jogo' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'arte-jogo.png';
        a.click();
        URL.revokeObjectURL(url);
      }
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
