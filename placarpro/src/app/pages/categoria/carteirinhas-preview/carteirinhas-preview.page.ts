import { AfterViewInit, Component, ElementRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { jsPDF } from 'jspdf';
import domtoimage from 'dom-to-image-more';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { NavBackService } from '../../../shared/nav-back.service';
import { salvarPdf } from '../../../shared/pdf-download.helper';
import {
  TAMANHOS_CARTEIRINHA,
  TamanhoCarteirinha,
  TamanhoCarteirinhaId,
} from '../../../campeonatos/carteirinhas-pdf.service';

interface CartaoView {
  jogador: Jogador;
  equipe?: Equipe;
}

/**
 * Página única de carteirinhas — toolbar com Imprimir + painel de configurações
 * inline (tamanho, nome, subtítulo, organização, escudo, verso, equipes) + preview
 * ao vivo. Imitando o padrão da súmula, mas com todos os controles dentro
 * da tela (sem modal). Imprime via `window.print()` com @media print.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/carteirinhas`
 */
@Component({
  selector: 'app-carteirinhas-preview',
  templateUrl: './carteirinhas-preview.page.html',
  styleUrls: ['./carteirinhas-preview.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class CarteirinhasPreviewPage implements OnInit, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly navBack = inject(NavBackService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';

  // ─── Dados carregados ───
  campeonato?: Campeonato;
  categoria?: Categoria;
  equipes: Equipe[] = [];
  jogadores: Jogador[] = [];
  loading = true;

  // ─── Configurações editáveis pelo usuário ───
  readonly tamanhos = TAMANHOS_CARTEIRINHA;
  tamanhoId: TamanhoCarteirinhaId = 'p1-86x59';
  nomeCampeonato = '';
  subtitulo = '';
  organizacao = '';
  incluirEscudo = true;
  incluirVerso = false;
  endereco = '';
  cidade = '';
  telefone = '';

  /** Mapa equipeId → marcada para impressão. */
  marcadas = new Map<string, boolean>();

  /** Painel lateral aberto/fechado (mobile). */
  painelAberto = true;

  /**
   * URL data:image/png do `.cp-main` renderizado como imagem (mobile only).
   * Quando setada, o template ESCONDE o HTML cru e exibe essa imagem —
   * pixel-perfect IDÊNTICA ao PDF gerado pelo `baixarPdf`/`imprimir`.
   * Idéia: usar a MESMA pipeline (dom-to-image-more + inline imagens) do
   * PDF pra que o user veja na tela EXATAMENTE o que vai sair impresso.
   */
  previewImagemUrl: string | null = null;
  /** Loading flag enquanto a captura roda (mostra spinner). */
  gerandoPreviewMobile = false;
  /** Mensagem de erro quando a captura falhou (mostra retry no template). */
  previewErro: string | null = null;
  /** Timer pra debounce de regeneração quando configs mudam. */
  private regenTimer: number | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const [camp, cat, equipes, jogadores] = await Promise.all([
        firstValueFrom(this.campsSrv.get$(this.campeonatoId)),
        firstValueFrom(this.catsSrv.get$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId)),
      ]);
      this.campeonato = camp;
      this.categoria  = cat;
      this.equipes    = [...equipes].sort((a, b) =>
        (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
      );
      this.jogadores = jogadores;

      // Defaults vindos do campeonato/categoria
      this.nomeCampeonato = camp?.titulo ?? '';
      this.subtitulo = cat?.titulo ?? '';
      this.organizacao = camp?.subtitulo ?? '';

      // Por padrão, todas as equipes começam marcadas
      for (const eq of this.equipes) {
        if (eq.id) this.marcadas.set(eq.id, true);
      }
    } catch (err) {
      console.error('[Carteirinhas] erro carregando dados', err);
    } finally {
      this.loading = false;
    }
  }

  ngAfterViewInit(): void {
    // Gera preview como imagem PNG (idêntica ao PDF) — TANTO mobile QUANTO
    // web. A visualização sempre vem da pipeline de captura, garantindo
    // pixel-perfect ao PDF final.
    this.scheduleGerarPreview(800);
  }

  /**
   * Agenda regeneração da preview com debounce — chamado quando o usuário
   * altera configs no painel (tamanho, nome, escudo, equipes marcadas, etc).
   * Roda tanto em mobile quanto em desktop.
   */
  scheduleGerarPreview(delayMs: number = 500): void {
    if (this.regenTimer !== null) {
      window.clearTimeout(this.regenTimer);
    }
    this.regenTimer = window.setTimeout(() => {
      this.regenTimer = null;
      this.gerarPreviewMobile();
    }, delayMs);
  }

  /**
   * Captura `.cp-main` como PNG via dom-to-image-more (reaproveita a
   * pipeline do `gerarPdf` mas sem gerar PDF — só seta a data URL pra
   * exibir como `<img>` no template).
   *
   * Pública pra que o template possa chamar via botão "Tentar de novo"
   * quando a captura falha.
   */
  async gerarPreviewMobile(): Promise<void> {
    if (this.loading) {
      console.warn('[gerarPreviewMobile] dados ainda carregando');
      return;
    }
    if (this.cartoes.length === 0) {
      console.warn('[gerarPreviewMobile] nenhuma carteirinha selecionada');
      this.previewImagemUrl = null;
      this.previewErro = null;
      return;
    }

    const root = this.host.nativeElement as HTMLElement;
    const grid = root.querySelector<HTMLElement>('.cp-main');
    if (!grid) {
      console.error('[gerarPreviewMobile] .cp-main não encontrado no DOM');
      this.previewErro = '.cp-main não encontrado';
      return;
    }

    console.log('[gerarPreviewMobile] iniciando captura', {
      cartoes: this.cartoes.length,
      gridWidth: grid.offsetWidth,
      gridHeight: grid.offsetHeight,
    });

    this.gerandoPreviewMobile = true;
    this.previewErro = null;

    const offscreen = document.createElement('div');
    offscreen.style.cssText = `
      position: fixed;
      top: -10000px;
      left: 0;
      width: 210mm;
      background: #ffffff;
      pointer-events: none;
      z-index: -1;
    `;

    try {
      await this.inlineImagens(grid);

      const clone = grid.cloneNode(true) as HTMLElement;
      // IMPORTANTE: o CSS mobile faz `.cp-main { visibility: hidden !important;
      // position: absolute !important; left: -10000px !important }` pra
      // esconder o HTML cru. Como o clone tem a mesma classe `.cp-main`,
      // ELE TAMBÉM HERDA essas regras (mesmo offscreen). Sobrescrevemos com
      // `!important` inline pra garantir que o clone renderize VISÍVEL com
      // dimensões corretas — senão a captura sai BRANCA.
      clone.style.setProperty('visibility', 'visible', 'important');
      clone.style.setProperty('position', 'static', 'important');
      clone.style.setProperty('top', 'auto', 'important');
      clone.style.setProperty('left', 'auto', 'important');
      clone.style.setProperty('pointer-events', 'auto', 'important');
      clone.style.setProperty('transform', 'none', 'important');
      clone.style.setProperty('margin', '0', 'important');
      clone.style.setProperty('padding', '0', 'important');
      clone.style.setProperty('background', '#ffffff', 'important');
      clone.style.setProperty('width', '210mm', 'important');
      clone.style.setProperty('max-width', '210mm', 'important');
      // Garante visibilidade em descendentes também (em caso de outras
      // regras `.cp-main *` que esconderiam conteúdo interno).
      clone.querySelectorAll<HTMLElement>('*').forEach(el => {
        el.style.setProperty('visibility', 'visible', 'important');
      });

      // Remove `.no-print` (painel, avisos), MAS mantém `.cp-sheet-title`
      // pra que os títulos "FRENTE DAS CARTEIRINHAS (N)" e "VERSO DAS
      // CARTEIRINHAS (N)" apareçam — IGUAL ao layout web.
      clone.querySelectorAll<HTMLElement>('.no-print').forEach(el => {
        if (el.classList.contains('cp-sheet-title')) return;
        el.remove();
      });

      // Garante que os `.cp-sheet-title` fiquem VISÍVEIS no clone (a regra
      // mobile pode tê-los escondido via `.no-print { display: none }`).
      clone.querySelectorAll<HTMLElement>('.cp-sheet-title').forEach(el => {
        el.style.setProperty('display', 'flex', 'important');
        el.style.setProperty('visibility', 'visible', 'important');
      });

      // NÃO zera o styling do `.cp-sheet` (cards brancos com sombra) — o
      // user pediu pra que o preview mobile fique IDÊNTICO ao web. Os
      // cards são parte da identidade visual do layout web.

      clone.querySelectorAll<HTMLElement>('.cart, .cart *').forEach(el => {
        el.style.setProperty('border-width', '0.5px', 'important');
      });

      // Força 2 carteirinhas por linha no clone — a regra `.cp-grid` em
      // mobile (≤640px) cai pra 1 coluna; sobrescrevemos com `!important`
      // inline pra que preview e PDF sempre saiam com 2 colunas.
      clone.querySelectorAll<HTMLElement>('.cp-grid').forEach(el => {
        el.style.setProperty('grid-template-columns', '1fr 1fr', 'important');
        el.style.setProperty('gap', '4mm', 'important');
      });

      offscreen.appendChild(clone);
      document.body.appendChild(offscreen);

      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const imgs = Array.from(clone.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgs.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const fin = (): void => resolve();
            img.addEventListener('load', fin, { once: true });
            img.addEventListener('error', fin, { once: true });
            setTimeout(fin, 2000);
          });
        }),
      );

      const rect = clone.getBoundingClientRect();
      console.log('[gerarPreviewMobile] clone dims', {
        width: rect.width,
        height: rect.height,
      });
      if (rect.width === 0 || rect.height === 0) {
        throw new Error(`Clone com dimensões inválidas: ${rect.width}x${rect.height}`);
      }
      const dataUrl = await domtoimage.toPng(clone, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scale: 2,
        cacheBust: false,
      });
      console.log('[gerarPreviewMobile] PNG gerado', { len: dataUrl.length });
      this.previewImagemUrl = dataUrl;
      this.previewErro = null;
    } catch (err) {
      console.error('[gerarPreviewMobile] erro', err);
      this.previewErro = (err as Error)?.message || 'Erro ao renderizar';
    } finally {
      this.gerandoPreviewMobile = false;
      try {
        if (offscreen.parentNode) offscreen.parentNode.removeChild(offscreen);
      } catch { /* ignore */ }
    }
  }

  /** Toggle de uma equipe na lista. */
  toggleEquipe(eq: Equipe): void {
    if (!eq.id) return;
    this.marcadas.set(eq.id, !this.marcadas.get(eq.id));
    this.scheduleGerarPreview();
  }
  isMarcada(eq: Equipe): boolean {
    return !!(eq.id && this.marcadas.get(eq.id));
  }
  marcarTodas(): void {
    const todasJa = this.equipes.every(e => this.isMarcada(e));
    for (const eq of this.equipes) {
      if (eq.id) this.marcadas.set(eq.id, !todasJa);
    }
    this.scheduleGerarPreview();
  }
  qtdMarcadas(): number {
    return Array.from(this.marcadas.values()).filter(v => v).length;
  }

  /** Tamanho selecionado (objeto completo). */
  get tamanho(): TamanhoCarteirinha {
    return this.tamanhos.find(t => t.id === this.tamanhoId) ?? this.tamanhos[0];
  }
  larguraMm(): number { return this.tamanho.larguraMm; }
  alturaMm(): number  { return this.tamanho.alturaMm; }

  /** Jogadores das equipes marcadas, ordenados (equipe → nome). */
  get cartoes(): CartaoView[] {
    if (this.loading) return [];
    const ids = new Set<string>();
    for (const [k, v] of this.marcadas) if (v) ids.add(k);
    return this.jogadores
      .filter(j => ids.has(j.equipeId))
      .sort((a, b) => {
        const e = a.equipeId.localeCompare(b.equipeId);
        if (e !== 0) return e;
        return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
      })
      .map(j => ({
        jogador: j,
        equipe: this.equipes.find(e => e.id === j.equipeId),
      }));
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'relatorios',
    ]);
  }

  /** Imprime — gera PDF via dom-to-image-more + jsPDF e abre em nova aba
   *  com `autoPrint()` (diálogo de impressão aparece automático). */
  async imprimir(): Promise<void> {
    return this.gerarPdf('print');
  }

  /** Baixa o PDF direto, sem diálogo. */
  async baixarPdf(): Promise<void> {
    return this.gerarPdf('download');
  }

  /**
   * Núcleo: captura o container `.cp-cartoes-grid` (frente + verso de
   * todas as carteirinhas marcadas) via dom-to-image-more, embute no
   * jsPDF como uma única imagem PNG, e ou abre print ou baixa.
   *
   * Por que NÃO `window.print()`:
   *  - O @media print é frágil em mobile (regras de viewport persistem).
   *  - Algumas regras `display: none` escondem partes durante o print.
   *  - Logos por CORS saem em branco sem o inline base64.
   *
   * Vantagens da pipeline dom-to-image-more:
   *  - Bordas hairline preservadas (renderização SVG-based)
   *  - Logos resolvidos via base64 (CORS sem problema)
   *  - Saída idêntica entre "Imprimir" e "Baixar PDF"
   */
  private async gerarPdf(destino: 'print' | 'download'): Promise<void> {
    const root = this.host.nativeElement as HTMLElement;
    // Captura o `<main class="cp-main">` que contém TODAS as sheets
    // (frente + verso) com suas grids de carteirinhas e os títulos.
    const grid = root.querySelector<HTMLElement>('.cp-main');
    if (!grid) {
      const t = await this.toastCtrl.create({
        message: 'Conteúdo ainda não está pronto.',
        duration: 1800,
        color: 'warning',
        position: 'top',
      });
      await t.present();
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: destino === 'print' ? 'Preparando impressão...' : 'Gerando PDF...',
      spinner: 'crescent',
    });
    await loading.present();

    // Clone off-screen pra capturar fora do contexto do modal/shell.
    // Força largura de 210mm (A4) pra que as carteirinhas dentro do
    // `.cp-grid` (2 colunas 1fr) ocupem o espaço inteiro da folha.
    // Antes usávamos `grid.offsetWidth` que pegava a largura ATUAL no
    // shell (pode ser muito menor que A4), resultando em PDF com
    // carteirinhas pequenas e muito branco em volta.
    const offscreen = document.createElement('div');
    offscreen.style.cssText = `
      position: fixed;
      top: -10000px;
      left: 0;
      width: 210mm;
      background: #ffffff;
      pointer-events: none;
      z-index: -1;
    `;

    try {
      // Inline imagens (logos + fotos de jogadores) pra contornar CORS.
      await this.inlineImagens(grid);

      const clone = grid.cloneNode(true) as HTMLElement;
      clone.style.transform = 'none';
      clone.style.position = 'static';
      clone.style.margin = '0';
      clone.style.padding = '0';
      clone.style.background = '#ffffff';
      // Força .cp-main no clone a largura cheia (sem max-width do flex pai)
      clone.style.width = '210mm';
      clone.style.maxWidth = '210mm';

      // Remove `.no-print` (avisos, controles que não fazem parte do conteúdo).
      clone.querySelectorAll<HTMLElement>('.no-print').forEach(el => el.remove());

      // Remove fundo/sombra/border do `.cp-sheet` (que era um card wrapper
      // visual) — mantém o título de seção ("Frente das carteirinhas (N)")
      // como cabeçalho do PDF, mas sem a moldura branca em volta.
      clone.querySelectorAll<HTMLElement>('.cp-sheet').forEach(el => {
        el.style.background = 'transparent';
        el.style.boxShadow = 'none';
        el.style.border = 'none';
        el.style.padding = '0';
        el.style.margin = '0 0 6mm 0';
        el.style.maxWidth = 'none';
        el.style.width = '100%';
      });

      // Bordas finas só nas carteirinhas (não no `.cp-sheet` que já zerou).
      clone.querySelectorAll<HTMLElement>('.cart, .cart *').forEach(el => {
        el.style.setProperty('border-width', '0.5px', 'important');
      });

      // Força 2 carteirinhas por linha no clone — a regra `.cp-grid` em
      // mobile (≤640px) cai pra 1 coluna; sobrescrevemos com `!important`
      // inline pra que preview e PDF sempre saiam com 2 colunas.
      clone.querySelectorAll<HTMLElement>('.cp-grid').forEach(el => {
        el.style.setProperty('grid-template-columns', '1fr 1fr', 'important');
        el.style.setProperty('gap', '4mm', 'important');
      });

      offscreen.appendChild(clone);
      document.body.appendChild(offscreen);

      // Aguarda layout + imgs decodificarem no clone.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      const imgs = Array.from(clone.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgs.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const fin = (): void => resolve();
            img.addEventListener('load', fin, { once: true });
            img.addEventListener('error', fin, { once: true });
            setTimeout(fin, 2000);
          });
        }),
      );

      const rect = clone.getBoundingClientRect();

      const dataUrl = await domtoimage.toPng(clone, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scale: 3,
        cacheBust: false,
      });

      const tmpImg = new Image();
      await new Promise<void>((resolve, reject) => {
        tmpImg.onload = () => resolve();
        tmpImg.onerror = () => reject(new Error('falha png'));
        tmpImg.src = dataUrl;
      });

      // PDF A4 retrato — ESTICA o conteúdo capturado pra preencher a
       // largura inteira da folha (com pequena margem 5mm cada lado).
       // Antes mostrávamos no tamanho "natural mm", mas o usuário queria
       // as carteirinhas ocupando o máximo da página.
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      const margin = 5; // mm
      const imgW = pageW - margin * 2;
      const imgH = (tmpImg.naturalHeight * imgW) / tmpImg.naturalWidth;

      // Paginação: se altura ultrapassa página, divide em N páginas.
      if (imgH + margin * 2 <= pageH) {
        pdf.addImage(dataUrl, 'PNG', margin, margin, imgW, imgH);
      } else {
        let restante = imgH;
        let offsetY = 0;
        while (restante > 0) {
          pdf.addImage(dataUrl, 'PNG', margin, margin - offsetY, imgW, imgH);
          restante -= (pageH - margin * 2);
          if (restante > 0) {
            pdf.addPage();
            offsetY += (pageH - margin * 2);
          }
        }
      }

      if (destino === 'print') {
        pdf.autoPrint();
        const blobUrl = pdf.output('bloburl');
        window.open(blobUrl, '_blank');
      } else {
        // iOS Safari abre PDF inline em vez de baixar — salvarPdf usa
        // Web Share API pra dar a opção "Salvar em Arquivos" no iOS.
        await salvarPdf(pdf, `carteirinhas-${this.categoriaId}.pdf`, this.toastCtrl, this.modalCtrl);
      }
    } catch (err) {
      console.error(`[carteirinhas/${destino}] erro`, err);
      const t = await this.toastCtrl.create({
        message: 'Erro ao gerar PDF.',
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      try {
        if (offscreen.parentNode) offscreen.parentNode.removeChild(offscreen);
      } catch { /* ignore */ }
      await loading.dismiss();
    }
  }

  /**
   * Converte todas as `<img>` do container em data URLs base64 ANTES da
   * captura. Sem isso os logos/fotos saem em branco no PDF por causa de
   * CORS no Firebase Storage. Mesma estratégia das outras telas.
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

  private async urlParaDataUrl(src: string): Promise<string | null> {
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
    } catch {
      /* fallback abaixo */
    }
    return await new Promise<string | null>(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  togglePainel(): void {
    this.painelAberto = !this.painelAberto;
  }

  /** Formata YYYY-MM-DD → DD/MM/YYYY. */
  formatarData(iso?: string | null): string {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  /** Label compacta da equipe pra checkbox. */
  labelEquipe(eq: Equipe): string {
    const cidade = (eq as { cidade?: string }).cidade ?? '';
    return cidade ? `${eq.nome} — ${cidade}` : eq.nome;
  }

  trackByCartao(_i: number, c: CartaoView): string { return c.jogador.id ?? `${_i}`; }
  trackByEquipe(_i: number, e: Equipe): string { return e.id ?? `${_i}`; }
}
