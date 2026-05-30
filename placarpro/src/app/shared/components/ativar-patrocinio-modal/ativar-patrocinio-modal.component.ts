import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { UsersService } from '../../../users/users.service';
import { PatrociniosService } from '../../../campeonatos/patrocinios.service';
import { PlanosService } from '../../../users/planos.service';
import { CREDITO_PATROCINIO, PREMIUM_PATROCINIO } from '../../../campeonatos/models/patrocinio-jogo.model';
import { StorageService } from '../../storage.service';
import { ImageCropperModalComponent } from '../image-cropper-modal/image-cropper-modal.component';

/** Dimensões finais da imagem após crop + resize, por tipo de patrocínio. */
const NORMAL_OUTPUT_W = 1080;
const NORMAL_OUTPUT_H = 608;   // 16:9
const PREMIUM_OUTPUT_W = PREMIUM_PATROCINIO.imagemLargura;     // 1080
const PREMIUM_OUTPUT_H = PREMIUM_PATROCINIO.imagemAltura;      // 1920 (9:16)

/** Item da lista local — cada anúncio do patrocínio que será criado. */
interface AnuncioItem {
  nome: string;
  logoUrl: string;
  tipoMidia?: 'imagem' | 'video';
}

/**
 * Modal pra ATIVAR um patrocínio numa partida específica.
 *
 * Modelo v1 simples:
 *  - 1 crédito = até 2 patrocinadores diferentes na esteira por 1h
 *
 * Fluxo INDEPENDENTE de catálogo:
 *  - O organizador cadastra o(s) anunciante(s) DENTRO da própria modal
 *    (nome + upload de logo). Os dados ficam SÓ no doc do patrocínio,
 *    não vão pro catálogo global `/patrocinadores` — cada ativação é
 *    independente, sem reuso futuro.
 *
 * UI:
 *  1. Mostra saldo
 *  2. Lista os anunciantes já adicionados (1-2 itens)
 *  3. Form inline pra adicionar mais (some quando chega no max)
 *  4. Confirmar → debita 1 crédito + cria PatrocinioJogo
 */
@Component({
  selector: 'app-ativar-patrocinio-modal',
  templateUrl: './ativar-patrocinio-modal.component.html',
  styleUrls: ['./ativar-patrocinio-modal.component.scss'],
  standalone: false,
})
export class AtivarPatrocinioModalComponent implements OnInit, OnDestroy {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly usersSrv = inject(UsersService);
  private readonly patrSrv = inject(PatrociniosService);
  private readonly storageSrv = inject(StorageService);
  private readonly planosSrv = inject(PlanosService);

  /** IDs do contexto. Owner é descoberto via auth pelos services. */
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  @Input() ownerId = '';

  /** Tipo do patrocínio selecionado. Controla preço, formato e regras. */
  tipo: 'normal' | 'premium' = 'normal';

  /** Constantes acessíveis no template. */
  readonly NORMAL = CREDITO_PATROCINIO;
  readonly PREMIUM = PREMIUM_PATROCINIO;

  /** Quantos logos por crédito (varia por tipo). Premium é sempre 1 (exclusivo);
   *  Normal vem da config comercial (editável pelo admin). */
  get logosPorCredito(): number {
    return this.tipo === 'premium' ? 1 : this.planosSrv.patrocinadoresCreditoNormal;
  }
  /** Preços unitários (R$) — editáveis pelo admin via config comercial. */
  get precoNormal(): number { return this.planosSrv.precoCreditoNormal; }
  get precoPremium(): number { return this.planosSrv.precoCreditoPremium; }

  /** Preço unitário em R$ por crédito do tipo selecionado. */
  get precoUnit(): number {
    return this.tipo === 'premium' ? this.precoPremium : this.precoNormal;
  }
  /** Texto explicativo do modelo selecionado. */
  get explicacao(): string {
    return this.tipo === 'premium'
      ? `1 crédito = banner vertical 9:16 exclusivo. Aparece por ${this.planosSrv.premiumJanelaSeg}s a cada ${this.planosSrv.premiumIntervaloMin}min de transmissão.`
      : `1 crédito = até ${this.planosSrv.patrocinadoresCreditoNormal} patrocinadores na esteira por ${this.planosSrv.duracaoCreditoNormalMin / 60}h.`;
  }
  /** Duração display (texto humano) — só pra resumo. */
  get duracaoTexto(): string {
    return this.tipo === 'premium'
      ? `${this.planosSrv.premiumJanelaSeg}s a cada ${this.planosSrv.premiumIntervaloMin}min de transmissão`
      : `${this.planosSrv.duracaoCreditoNormalMin / 60}h após início da transmissão`;
  }

  /** Quantos créditos o organizador quer gastar nesta ativação.
   *  - Normal: 1 a N (stepper limitado pelo saldo).
   *  - Premium: sempre 1 (stepper escondido). */
  creditosSelecionados = 1;

  /** Saldo atual em memória do tipo SELECIONADO — usado pra cap do stepper
   *  e validação de "insuficiente". Atualizado por subscribe + setTipo. */
  saldoAtual = 0;

  /** Snapshots dos 2 saldos (normal/premium) lidos do profile. */
  private saldoNormal = 0;
  private saldoPremium = 0;

  /** Limite dinâmico de patrocinadores.
   *  - Normal: creditosSelecionados × logosPorCredito (2)
   *  - Premium: sempre 1 (1 anunciante exclusivo) */
  get maxLogos(): number {
    return this.tipo === 'premium' ? 1 : this.creditosSelecionados * this.logosPorCredito;
  }

  /** Lista local dos anunciantes a serem incluídos no patrocínio. */
  anuncios: AnuncioItem[] = [];

  /** Índice do anunciante atual no preview rotativo (1 por vez). */
  previewIdx = 0;
  private previewTimer?: ReturnType<typeof setInterval>;

  /** Estado do form inline de "adicionar". */
  formAberto = false;
  novoNome = '';
  novoLogoUrl = '';   // preview/URL após upload
  novoTipoMidia: 'imagem' | 'video' = 'imagem';
  enviandoLogo = false;

  saldo$: Observable<number> = of(0);
  salvando = false;

  ngOnInit(): void {
    // Mantém os dois saldos em memória. O `saldo$` exposto no template
    // sempre reflete o saldo do TIPO selecionado no momento.
    this.usersSrv.profile$().subscribe(p => {
      this.saldoNormal = p?.creditosPatrocinio ?? 0;
      this.saldoPremium = p?.creditosPatrocinioPremium ?? 0;
      this.aplicarSaldoDoTipo();
    });
    this.saldo$ = this.usersSrv.profile$().pipe(
      map(p => this.tipo === 'premium'
        ? (p?.creditosPatrocinioPremium ?? 0)
        : (p?.creditosPatrocinio ?? 0)),
    );

    // Rotação do preview a cada 3s (mais rápido que produção pra dar
    // sensação de movimento na demo da modal).
    this.previewTimer = setInterval(() => {
      if (this.anuncios.length > 1) {
        this.previewIdx = (this.previewIdx + 1) % this.anuncios.length;
      } else {
        this.previewIdx = 0;
      }
    }, 3000);
  }

  /** Atualiza `saldoAtual` (que controla cap + disable do confirmar) com
   *  base no tipo selecionado. Recua stepper se ficar > saldo. */
  private aplicarSaldoDoTipo(): void {
    this.saldoAtual = this.tipo === 'premium' ? this.saldoPremium : this.saldoNormal;
    if (this.creditosSelecionados > this.saldoAtual) {
      this.creditosSelecionados = Math.max(1, this.saldoAtual);
    }
  }

  ngOnDestroy(): void {
    if (this.previewTimer) clearInterval(this.previewTimer);
  }

  // ════════════════════════════════════════════════════════
  // Stepper de créditos
  // ════════════════════════════════════════════════════════

  ajustarCreditos(delta: number): void {
    const proximo = this.creditosSelecionados + delta;
    // Mínimo 1 (a ativação debita pelo menos 1 crédito).
    if (proximo < 1) return;
    // Máximo = saldo (não pode debitar mais do que tem).
    if (proximo > this.saldoAtual) {
      this.toast(`Saldo é ${this.saldoAtual} crédito${this.saldoAtual === 1 ? '' : 's'}.`, 'warning');
      return;
    }
    this.creditosSelecionados = proximo;
    // Se o organizador já tinha adicionado mais logos do que o novo limite
    // (ex: reduziu créditos), corta o excedente do final.
    if (this.anuncios.length > this.maxLogos) {
      this.anuncios.splice(this.maxLogos);
      this.toast(
        `Limite reduzido pra ${this.maxLogos} anunciantes. Removi os últimos.`,
        'warning',
      );
    }
  }

  // ════════════════════════════════════════════════════════
  // Toggle Normal/Premium
  // ════════════════════════════════════════════════════════

  setTipo(t: 'normal' | 'premium'): void {
    if (this.tipo === t) return;
    // Trocar tipo significa que as imagens já uploaded podem estar com
    // proporção errada. Limpa lista pra forçar re-upload no formato certo.
    if (this.anuncios.length > 0) {
      this.anuncios = [];
      this.toast('Imagens removidas — proporção diferente entre Normal (16:9) e Premium (9:16).', 'warning');
    }
    this.cancelarForm();
    this.tipo = t;
    // Em premium, créditos é sempre 1 (banner exclusivo, 1 patrocinador).
    if (t === 'premium') this.creditosSelecionados = 1;
    // Recalcula `saldoAtual` e o observable `saldo$` (template binding)
    // pra refletir o saldo do TIPO atual.
    this.aplicarSaldoDoTipo();
    this.saldo$ = this.usersSrv.profile$().pipe(
      map(p => this.tipo === 'premium'
        ? (p?.creditosPatrocinioPremium ?? 0)
        : (p?.creditosPatrocinio ?? 0)),
    );
  }

  // ════════════════════════════════════════════════════════
  // Form inline: adicionar / cancelar / upload
  // ════════════════════════════════════════════════════════

  abrirForm(): void {
    if (this.anuncios.length >= this.maxLogos) {
      this.toast(`Máximo ${this.maxLogos} anunciantes por crédito.`, 'warning');
      return;
    }
    this.formAberto = true;
    this.novoNome = '';
    this.novoLogoUrl = '';
  }

  cancelarForm(): void {
    this.formAberto = false;
    this.novoNome = '';
    this.novoLogoUrl = '';
    this.novoTipoMidia = 'imagem';
  }

  async onLogoSelecionado(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const resetInput = () => { input.value = ''; };

    if (!file) { resetInput(); return; }

    // ──────────── PREMIUM + VÍDEO ────────────
    // Premium aceita vídeo de até 6s (intersticial). Pula cropper e
    // resize — só valida duração + faz upload direto.
    if (this.tipo === 'premium' && file.type.startsWith('video/')) {
      await this.tratarVideoPremium(file, resetInput);
      return;
    }

    if (!file.type.startsWith('image/')) {
      const accept = this.tipo === 'premium'
        ? 'Arquivo precisa ser imagem (PNG/JPG/WebP) ou vídeo (MP4/WebM até 6s).'
        : 'Arquivo precisa ser uma imagem (PNG, JPG, WebP).';
      this.toast(accept, 'warning');
      resetInput();
      return;
    }
    // Limite "duro" de 30MB — só pra evitar carregar arquivos absurdos em
    // memória. Imagens entre 5-30MB são automaticamente reescaladas antes
    // de irem pro cropper (preview de 2000px) — usuário não precisa abrir
    // editor externo pra reduzir.
    if (file.size > 30 * 1024 * 1024) {
      this.toast('Imagem muito grande (máx 30MB). Tire uma foto mais leve.', 'warning');
      resetInput();
      return;
    }

    // ──────────── 0) Pré-processa imagens grandes ────────────
    // Cropper renderiza no <canvas> e segura a imagem em memória RAW —
    // com imagens muito grandes (smartphone modernos = 4-12MB / 4000px+),
    // alguns browsers travam ou recusam carregar. Pré-reescalando pra
    // 2000px na maior dimensão dá um arquivo ~500KB-1MB, o cropper roda
    // suave e o usuário ainda tem detalhe suficiente pra escolher
    // o recorte com precisão.
    this.enviandoLogo = true;
    let arquivoCropper: File;
    try {
      const PRE_RESIZE_MAX = 2000;
      const precisa = file.size > 2 * 1024 * 1024;
      const ext = (file.type.includes('png') ? 'png' : 'jpg');
      const nomeBase = (file.name || 'logo').replace(/\.[^.]+$/, '');
      arquivoCropper = precisa
        ? await this.reduzirImagemParaCropper(file, PRE_RESIZE_MAX, nomeBase, ext)
        : file;
    } catch (err) {
      console.error('[AtivarPatrocinio] pré-resize falhou', err);
      this.toast('Não consegui processar essa imagem. Tente outra.', 'danger');
      this.enviandoLogo = false;
      resetInput();
      return;
    }
    this.enviandoLogo = false;

    // ──────────── 1) Abre o cropper (proporção depende do TIPO) ────────────
    // Normal: 16:9 (1080×608). Premium: 9:16 (1080×1920, retrato).
    const outW = this.tipo === 'premium' ? PREMIUM_OUTPUT_W : NORMAL_OUTPUT_W;
    const outH = this.tipo === 'premium' ? PREMIUM_OUTPUT_H : NORMAL_OUTPUT_H;
    const aspect = outW / outH;
    const aspectLabel = this.tipo === 'premium' ? '9:16' : '16:9';

    const cropModal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      backdropDismiss: false,
      componentProps: {
        file: arquivoCropper,
        aspectRatio: aspect,
        title: `Recortar (${aspectLabel} — ${outW}×${outH})`,
      },
    });
    await cropModal.present();
    const { data } = await cropModal.onDidDismiss<{ blob?: Blob }>();
    resetInput();

    if (!data?.blob) return; // usuário cancelou

    // ──────────── 2) Reescala pra dimensões finais (varia por tipo) ────────────
    this.enviandoLogo = true;
    try {
      const resized = await this.resizeImagem(data.blob, outW, outH);

      // ──────────── 3) Upload do PNG final ────────────
      const idx = this.anuncios.length;
      const { url } = await this.storageSrv.uploadPatrocinadorJogoLogo(
        this.campeonatoId, this.categoriaId, this.jogoId, idx, resized,
      );
      this.novoLogoUrl = url;
    } catch (err) {
      console.error('[AtivarPatrocinio] upload falhou', err);
      this.toast('Falha no upload da imagem. Tente outra.', 'danger');
    } finally {
      this.enviandoLogo = false;
    }
  }

  /**
   * Pipeline pra vídeos PREMIUM:
   *  1. Valida tamanho (max 20MB) e tipo (mp4/webm)
   *  2. Lê duração via HTMLVideoElement — exige ≤ 6s
   *  3. Upload direto pro Storage (sem cropper/resize)
   *  4. Marca `novoTipoMidia = 'video'`
   */
  private async tratarVideoPremium(file: File, resetInput: () => void): Promise<void> {
    if (file.size > 20 * 1024 * 1024) {
      this.toast('Vídeo muito grande (máx 20MB).', 'warning');
      resetInput();
      return;
    }
    const tipoOk = file.type === 'video/mp4' || file.type === 'video/webm' || file.type === 'video/quicktime';
    if (!tipoOk) {
      this.toast('Vídeo precisa ser MP4 ou WebM.', 'warning');
      resetInput();
      return;
    }

    this.enviandoLogo = true;
    try {
      // Valida duração ≤ 6s.
      const duracao = await this.lerDuracaoVideo(file);
      if (duracao > 6.5) {
        this.toast(`Vídeo deve ter no máximo 6 segundos. (atual: ${duracao.toFixed(1)}s)`, 'warning');
        return;
      }

      // Upload direto (sem processamento).
      const idx = this.anuncios.length;
      const { url } = await this.storageSrv.uploadPatrocinadorJogoLogo(
        this.campeonatoId, this.categoriaId, this.jogoId, idx, file,
      );
      this.novoLogoUrl = url;
      this.novoTipoMidia = 'video';
    } catch (err) {
      console.error('[AtivarPatrocinio] upload vídeo falhou', err);
      this.toast('Falha no upload do vídeo.', 'danger');
    } finally {
      this.enviandoLogo = false;
      resetInput();
    }
  }

  /** Lê a duração de um arquivo de vídeo via tag oculta. */
  private lerDuracaoVideo(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const url = URL.createObjectURL(file);
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = e => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      video.src = url;
    });
  }

  /**
   * Pré-resize do arquivo bruto ANTES do cropper. Garante que a maior
   * dimensão fique <= `maxLado`, preservando proporção original.
   *
   * Usado pra imagens grandes (foto de smartphone, screenshot 4K) onde o
   * cropper tem dificuldade — após esse passo o arquivo cai pra ~500KB-1MB,
   * fica rápido e responsivo no editor. Resolução final (1080×1080)
   * é gerada depois pelo cropper + resizeQuadrado.
   *
   * Preserva o tipo original (PNG se for PNG → mantém transparência;
   * JPG/qualquer outro vira JPG 92% qualidade pra economizar peso).
   */
  private async reduzirImagemParaCropper(
    file: File, maxLado: number, nomeBase: string, ext: string,
  ): Promise<File> {
    const bitmap = await this.blobParaBitmap(file);
    // Tipos do bitmap nas duas vias (ImageBitmap | HTMLImageElement) têm
    // width/height próprios — narrow seguro via `unknown`.
    const srcW = (bitmap as { width: number }).width;
    const srcH = (bitmap as { height: number }).height;
    if (!srcW || !srcH) return file; // não consegui ler dimensões → joga pro cropper original

    // Se já é menor que maxLado, devolve original (não tem o que reduzir).
    if (Math.max(srcW, srcH) <= maxLado) return file;

    const escala = maxLado / Math.max(srcW, srcH);
    const w = Math.round(srcW * escala);
    const h = Math.round(srcH * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);

    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => {
        if (!b) reject(new Error('Falha ao gerar imagem reduzida.'));
        else resolve(b);
      }, mime, 0.92);
    });
    return new File([blob], `${nomeBase}.${ext}`, { type: mime });
  }

  /**
   * Redimensiona um Blob de imagem pra `width × height` exatos, preservando
   * transparência (PNG). Usa <canvas> 2D — funciona em todo browser moderno.
   * O blob de entrada vem do cropper já com proporção correta (16:9),
   * então só estamos escalando pra resolução final fixa.
   *
   * Pra logos vetoriais subidos em alta resolução, faz downscale com
   * imageSmoothingQuality='high' (resultado nítido). Pra logos pequenos,
   * faz upscale — a esteira da transmissão renderiza em altura ~32-44px,
   * então 1080×608 é mais do que suficiente.
   */
  private async resizeImagem(blob: Blob, width: number, height: number): Promise<Blob> {
    const bitmap = await this.blobParaBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height); // mantém alpha
    ctx.drawImage(bitmap, 0, 0, width, height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(out => {
        if (!out) reject(new Error('Falha ao gerar PNG.'));
        else resolve(out);
      }, 'image/png');
    });
  }

  /** Converte Blob em ImageBitmap (ou HTMLImageElement como fallback). */
  private async blobParaBitmap(blob: Blob): Promise<CanvasImageSource> {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch { /* fallback */ }
    }
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  confirmarAdd(): void {
    const nome = this.novoNome.trim();
    if (!nome) {
      this.toast('Informe o nome do anunciante.', 'warning');
      return;
    }
    if (!this.novoLogoUrl) {
      this.toast('Faça upload do logo do anunciante.', 'warning');
      return;
    }
    this.anuncios.push({
      nome,
      logoUrl: this.novoLogoUrl,
      tipoMidia: this.novoTipoMidia,
    });
    this.cancelarForm();
  }

  removerAnuncio(idx: number): void {
    this.anuncios.splice(idx, 1);
  }

  // ════════════════════════════════════════════════════════
  // Confirmar e debitar
  // ════════════════════════════════════════════════════════

  async confirmar(): Promise<void> {
    if (this.anuncios.length === 0) {
      this.toast('Adicione pelo menos 1 anunciante.', 'warning');
      return;
    }

    this.salvando = true;
    try {
      const custoFinal = this.tipo === 'premium' ? 1 : this.creditosSelecionados;
      const id = await this.patrSrv.ativarPatrocinio({
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogoId: this.jogoId,
        ownerId: this.ownerId,
        patrocinadores: this.anuncios.map(a => ({
          nome: a.nome,
          logoUrl: a.logoUrl,
          ...(a.tipoMidia ? { tipoMidia: a.tipoMidia } : {}),
        })),
        creditos: custoFinal,
        tipo: this.tipo,
      });
      const tipoLabel = this.tipo === 'premium' ? ' PREMIUM' : '';
      this.toast(
        `Patrocínio${tipoLabel} ativado! ${custoFinal} crédito${custoFinal > 1 ? 's' : ''} debitado${custoFinal > 1 ? 's' : ''}.`,
        'success',
      );
      await this.modalCtrl.dismiss({ id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.toast(msg, 'danger');
    } finally {
      this.salvando = false;
    }
  }

  async fechar(): Promise<void> {
    await this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'warning' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: color === 'success' ? 2500 : 3500, color, position: 'top',
    });
    await t.present();
  }
}
