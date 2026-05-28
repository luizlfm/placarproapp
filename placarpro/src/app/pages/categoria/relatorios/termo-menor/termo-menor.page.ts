import { AfterViewInit, Component, ElementRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { jsPDF } from 'jspdf';
import domtoimage from 'dom-to-image-more';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { NavBackService } from '../../../../shared/nav-back.service';
import { salvarPdf } from '../../../../shared/pdf-download.helper';

/**
 * Slots de logo no cabeçalho do termo (esquerda, centro, direita).
 * Cada slot tem URL e label opcional para acessibilidade.
 */
interface LogoSlot {
  id: 'esquerda' | 'centro' | 'direita';
  url: string;
  label: string;
}

/**
 * Página dedicada para gerar o "Termo de Autorização para Menor de 18 anos"
 * a partir de um modelo editável. O usuário pode:
 *
 *  - Substituir os 3 logos do cabeçalho (esquerda/centro/direita)
 *  - Editar o título do evento ("5ª COPA REGIONAL SPORT+ DE FUTEBOL SOCIETY")
 *  - Editar o ano
 *  - Editar o nome do organizador ("JOGA 10 SPORTS")
 *  - Imprimir/exportar como PDF via window.print()
 *
 * Todos os campos editáveis ficam num painel lateral (`.painel-edit`) — o
 * preview do termo é live e atualiza conforme o usuário digita.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/relatorios/termo-menor`
 */
@Component({
  selector: 'app-termo-menor',
  templateUrl: './termo-menor.page.html',
  styleUrls: ['./termo-menor.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class TermoMenorPage implements OnInit, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly navBack = inject(NavBackService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /**
   * URL data:image/png do termo renderizado como imagem (preview PDF).
   * Quando setada, o template ESCONDE o HTML cru e exibe essa imagem —
   * pixel-perfect IDÊNTICA ao PDF gerado pelo `baixarPdf` / `imprimir`.
   */
  previewImagemUrl: string | null = null;
  /** Loading flag enquanto a captura roda (mostra spinner). */
  gerandoPreviewMobile = false;
  private regenTimer: ReturnType<typeof setTimeout> | null = null;

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  /** Configuração editável do termo (em memória — não persiste por enquanto). */
  config = {
    /** Título principal do evento. Quebra automaticamente em 2-3 linhas. */
    titulo: '5ª COPA REGIONAL SPORT+ DE FUTEBOL SOCIETY',
    /** Ano do evento — aparece no título e nos parágrafos. */
    ano: new Date().getFullYear(),
    /** Nome do organizador (JOGA 10 SPORTS no modelo original). */
    organizador: 'JOGA 10 SPORTS',
    /**
     * Texto livre da declaração de responsabilidade. Permite edição
     * fina pra ajustar caso a federação tenha texto específico.
     */
    declaracao:
      'bem como também declaro que meu filho ( ou quem esteja sob minha guarda) ' +
      'possui plena saúde física e mental, isentando de responsabilidade civil e penal ' +
      'os administradores e {{organizador}}, no caso de ocorrência de eventos danosos ' +
      'e/ou sinistros adivinhos da disputa dos jogos, bem como por qualquer ocultação ' +
      'de informações sobre eventuais problemas de saúde.',
  };

  /** 3 slots de logo. Padrão: vazio (placeholder cinza). */
  logos: LogoSlot[] = [
    { id: 'esquerda', url: '', label: 'Logo Esquerda' },
    { id: 'centro',   url: '', label: 'Logo Centro' },
    { id: 'direita',  url: '', label: 'Logo Direita' },
  ];

  /** Stream dos dados do campeonato e categoria — usado pra pré-preencher. */
  contexto$: Observable<{ campeonato?: Campeonato; categoria?: Categoria }> = of({});

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) return;
    this.contexto$ = this.montarContexto();
    // Tenta pré-preencher logo central com a logo do campeonato
    void this.preencherDoCampeonato();
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

  ngAfterViewInit(): void {
    // Gera a preview-imagem do termo após a primeira renderização —
    // o template então mostra a img em vez do HTML cru (pixel-perfect ao PDF).
    setTimeout(() => this.agendarGeracaoPreview(), 500);
  }

  /**
   * Debounce — regenera preview quando logos/título/ano/declaração mudam.
   *
   * Liga IMEDIATAMENTE o flag `gerandoPreviewMobile = true` pra que o
   * template mostre o spinner "Renderizando..." na hora, em vez de esperar
   * o debounce (800ms). UX: o usuário vê feedback visual instantâneo após
   * cada keystroke. A captura real só dispara após o debounce, evitando
   * travar a UI com renders intermediárias a cada letra digitada.
   */
  agendarGeracaoPreview(): void {
    this.gerandoPreviewMobile = true; // feedback visual imediato
    if (this.regenTimer) clearTimeout(this.regenTimer);
    this.regenTimer = setTimeout(() => {
      void this.gerarPreviewImagem();
    }, 800);
  }

  /**
   * Captura `.termo-folha` como PNG e atribui em `previewImagemUrl`.
   *
   * CRÍTICO: Clona a folha pra container off-screen ANTES da captura.
   * Sem isso, quando já existe uma `previewImagemUrl`, a regra
   * `.tm-preview-wrap.tem-preview .termo-folha { display: none !important }`
   * deixa a folha com `display: none` — então `getBoundingClientRect`
   * retorna 0×0 e `dom-to-image-more` captura um PNG VAZIO, sobrescrevendo
   * a img boa por uma branca. O clone off-screen é forçado a ficar
   * visível com dimensões corretas, garantindo captura válida em todas
   * as regenerações.
   */
  private async gerarPreviewImagem(): Promise<void> {
    const root = this.host.nativeElement as HTMLElement;
    const folhaOriginal = root.querySelector<HTMLElement>('.termo-folha');
    if (!folhaOriginal) return;

    this.gerandoPreviewMobile = true;

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
      await this.aguardarImagens(folhaOriginal, 3000);
      await this.inlineImagens(folhaOriginal);

      const clone = folhaOriginal.cloneNode(true) as HTMLElement;
      // Sobrescreve `display: none` (e qualquer outra regra escondendo)
      // com `!important` inline pra que o clone renderize VISÍVEL com
      // dimensões corretas — senão a captura sai BRANCA.
      clone.style.setProperty('display', 'block', 'important');
      clone.style.setProperty('visibility', 'visible', 'important');
      clone.style.setProperty('position', 'static', 'important');
      clone.style.setProperty('width', '210mm', 'important');
      clone.style.setProperty('max-width', '210mm', 'important');
      clone.style.setProperty('zoom', '1', 'important');
      clone.style.setProperty('margin', '0', 'important');

      offscreen.appendChild(clone);
      document.body.appendChild(offscreen);

      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      // Aguarda imagens do CLONE decodificarem (cloneNode preserva src
      // mas o browser precisa baixar/decodificar nos novos <img>).
      const imgsClone = Array.from(clone.querySelectorAll('img')) as HTMLImageElement[];
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

      const rect = clone.getBoundingClientRect();
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
      this.previewImagemUrl = dataUrl;
    } catch (err) {
      console.warn('[termo-menor] preview falhou', err);
    } finally {
      this.gerandoPreviewMobile = false;
      try {
        if (offscreen.parentNode) offscreen.parentNode.removeChild(offscreen);
      } catch { /* ignore */ }
    }
  }

  /** Imprime — gera PDF via dom-to-image-more + jsPDF e abre em nova aba
   *  com autoPrint (igual padrão do sistema). */
  async imprimir(): Promise<void> {
    return this.gerarPdf('print');
  }

  /** Baixa o PDF direto. */
  async baixarPdf(): Promise<void> {
    return this.gerarPdf('download');
  }

  private async gerarPdf(destino: 'print' | 'download'): Promise<void> {
    const root = this.host.nativeElement as HTMLElement;
    const folha = root.querySelector<HTMLElement>('.termo-folha');
    if (!folha) return;

    const loading = await this.loadingCtrl.create({
      message: destino === 'print' ? 'Preparando impressão...' : 'Gerando PDF...',
      spinner: 'crescent',
    });
    await loading.present();

    try {
      await this.aguardarImagens(folha, 3000);
      await this.inlineImagens(folha);

      const rect = folha.getBoundingClientRect();
      const dataUrl = await domtoimage.toPng(folha, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scale: 3,
        cacheBust: false,
      });

      const tmpImg = new Image();
      await new Promise<void>((resolve, reject) => {
        tmpImg.onload = () => resolve();
        tmpImg.onerror = () => reject(new Error('png'));
        tmpImg.src = dataUrl;
      });

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (tmpImg.naturalHeight * imgW) / tmpImg.naturalWidth;

      if (imgH <= pageH) {
        pdf.addImage(dataUrl, 'PNG', 0, 0, imgW, imgH);
      } else {
        let restante = imgH;
        let offsetY = 0;
        while (restante > 0) {
          pdf.addImage(dataUrl, 'PNG', 0, -offsetY, imgW, imgH);
          restante -= pageH;
          if (restante > 0) {
            pdf.addPage();
            offsetY += pageH;
          }
        }
      }

      if (destino === 'print') {
        pdf.autoPrint();
        const blobUrl = pdf.output('bloburl');
        window.open(blobUrl, '_blank');
      } else {
        // iOS Safari abre PDF inline — salvarPdf usa Web Share API no iOS
        // pra dar a opção "Salvar em Arquivos" e voltar pra tela do app.
        await salvarPdf(pdf, `termo-autorizacao-${this.categoriaId}.pdf`);
      }
    } catch (err) {
      console.error('[termo-menor] PDF erro', err);
      const t = await this.toastCtrl.create({
        message: 'Erro ao gerar PDF.',
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      await loading.dismiss();
    }
  }

  /** Aguarda imagens do container terminarem de carregar (ou timeout). */
  private aguardarImagens(container: HTMLElement, timeoutMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
      const pendentes = imgs.filter(i => !i.complete || i.naturalWidth === 0);
      if (pendentes.length === 0) return resolve();
      let restantes = pendentes.length;
      const fin = (): void => { restantes--; if (restantes <= 0) resolve(); };
      pendentes.forEach(img => {
        img.addEventListener('load', fin, { once: true });
        img.addEventListener('error', fin, { once: true });
      });
      setTimeout(resolve, timeoutMs);
    });
  }

  /** Converte src remoto → data URL base64 (resolve CORS pro html2canvas). */
  private async inlineImagens(container: HTMLElement): Promise<void> {
    const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(
      imgs.map(async img => {
        const src = img.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        try {
          const res = await fetch(src, { mode: 'cors', cache: 'no-store' });
          if (!res.ok) return;
          const blob = await res.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
          });
          img.src = dataUrl;
          if (img.decode) await img.decode().catch(() => undefined);
        } catch { /* segue */ }
      }),
    );
  }

  /** Handler do input file por slot — converte a imagem em data URL. */
  onArquivoSelecionado(slot: LogoSlot, ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      slot.url = reader.result as string;
      this.agendarGeracaoPreview();
    };
    reader.readAsDataURL(file);
    // Reset do input pra permitir re-selecionar o mesmo arquivo
    input.value = '';
  }

  /** Remove o logo de um slot. */
  limparLogo(slot: LogoSlot): void {
    slot.url = '';
    this.agendarGeracaoPreview();
  }

  /**
   * Restaura os valores padrão da configuração — útil quando o usuário
   * "perdeu" a edição e quer começar do zero.
   */
  restaurarPadrao(): void {
    this.agendarGeracaoPreview();
    this.config = {
      titulo: '5ª COPA REGIONAL SPORT+ DE FUTEBOL SOCIETY',
      ano: new Date().getFullYear(),
      organizador: 'JOGA 10 SPORTS',
      declaracao:
        'bem como também declaro que meu filho ( ou quem esteja sob minha guarda) ' +
        'possui plena saúde física e mental, isentando de responsabilidade civil e penal ' +
        'os administradores e {{organizador}}, no caso de ocorrência de eventos danosos ' +
        'e/ou sinistros adivinhos da disputa dos jogos, bem como por qualquer ocultação ' +
        'de informações sobre eventuais problemas de saúde.',
    };
    this.logos.forEach(l => (l.url = ''));
    void this.preencherDoCampeonato();
  }

  /**
   * Renderiza a declaração substituindo `{{organizador}}` pelo nome configurado.
   * Mantido como pipe inline aqui (não vale a pena criar um pipe Angular).
   */
  declaracaoRenderizada(): string {
    return this.config.declaracao.replaceAll(
      '{{organizador}}',
      this.config.organizador || '___________',
    );
  }

  /**
   * Stream dos dados de contexto (campeonato + categoria). Usado só pra
   * exibir o título da página e pra pré-preencher o título quando o
   * campeonato já tem nome cadastrado.
   */
  private montarContexto(): Observable<{
    campeonato?: Campeonato;
    categoria?: Categoria;
  }> {
    const camp$ = this.campsSrv
      .get$(this.campeonatoId)
      .pipe(catchError(() => of(undefined)));
    const cat$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));

    return combineLatest([camp$, cat$]).pipe(
      map(([campeonato, categoria]) => ({ campeonato, categoria })),
    );
  }

  /**
   * Tenta carregar o nome do campeonato e a logo dele pra inicializar o
   * formulário. Só dispara uma vez (no ngOnInit). Se já houver edição, NÃO
   * sobrescreve — só preenche slots vazios.
   */
  private async preencherDoCampeonato(): Promise<void> {
    try {
      const camp = await firstValueFrom(this.campsSrv.get$(this.campeonatoId));
      if (!camp) return;
      // Se o título ainda é o default, substitui pelo nome do campeonato
      if (camp.titulo && this.config.titulo.startsWith('5ª COPA REGIONAL')) {
        this.config.titulo = camp.titulo.toUpperCase();
      }
      // Se o logo central está vazio, preenche com a logo do campeonato
      const centro = this.logos.find(l => l.id === 'centro');
      if (centro && !centro.url && camp.logoUrl) {
        centro.url = camp.logoUrl;
      }
    } catch {
      /* silencioso — usa defaults */
    }
  }
}
