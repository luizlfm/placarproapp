import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { PatrociniosService } from '../../../campeonatos/patrocinios.service';
import { PlanosService } from '../../../users/planos.service';
import { PatrocinioJogo, CREDITO_PATROCINIO } from '../../../campeonatos/models/patrocinio-jogo.model';
import { StorageService } from '../../storage.service';
import { ImageCropperModalComponent } from '../image-cropper-modal/image-cropper-modal.component';

/** Dimensões finais do logo — espelha as constantes do modal de ativação. */
const LOGO_OUTPUT_W = 1080;
const LOGO_OUTPUT_H = 608;
const LOGO_ASPECT = LOGO_OUTPUT_W / LOGO_OUTPUT_H;

interface AnuncioEdit {
  nome: string;
  logoUrl: string;
  /** Marca pra salvar — se `false`, não muda no save (otimização visual). */
  alterado: boolean;
}

/**
 * Modal pra EDITAR um patrocínio que ainda está como 'agendado'.
 *
 * Permite ao organizador, antes da transmissão começar:
 *  - Trocar o logo (re-recortado em 16:9 + reescalado pra 1080×608)
 *  - Editar o nome de cada anunciante
 *  - Remover anunciantes da lista
 *  - Adicionar mais (até o limite do crédito original)
 *
 * NÃO permite alterar a quantidade de créditos — pra isso, o organizador
 * cancela (com estorno) e ativa novamente.
 */
@Component({
  selector: 'app-editar-patrocinio-modal',
  templateUrl: './editar-patrocinio-modal.component.html',
  styleUrls: ['./editar-patrocinio-modal.component.scss'],
  standalone: false,
})
export class EditarPatrocinioModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly patrSrv = inject(PatrociniosService);
  private readonly storageSrv = inject(StorageService);
  private readonly planosSrv = inject(PlanosService);

  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  /** Doc do patrocínio (com `id`) — caller passa a versão atual. */
  @Input() patrocinio?: PatrocinioJogo;

  /** Patrocinadores/crédito e duração — editáveis pelo admin (config comercial). */
  get logosPorCredito(): number { return this.planosSrv.patrocinadoresCreditoNormal; }
  get duracaoMin(): number { return this.planosSrv.duracaoCreditoNormalMin; }

  /** Lista local editável (cópia das `patrocinadores` do doc). */
  anuncios: AnuncioEdit[] = [];

  /** Limite = creditosUsados original × logosPorCredito. */
  maxLogos: number = CREDITO_PATROCINIO.logosPorCredito;

  /** Form inline de "adicionar novo anunciante". */
  formAberto = false;
  novoNome = '';
  novoLogoUrl = '';

  /** Loading flags. */
  enviandoLogo = false;
  salvando = false;
  /** Quando trocando logo de um item existente — índice em curso (-1 = nenhum). */
  trocandoLogoIdx = -1;

  ngOnInit(): void {
    const p = this.patrocinio;
    if (!p) return;
    this.maxLogos = (p.creditosUsados ?? 1) * this.planosSrv.patrocinadoresCreditoNormal;
    this.anuncios = (p.patrocinadores ?? []).map(x => ({
      nome: x.nome ?? '',
      logoUrl: x.logoUrl ?? '',
      alterado: false,
    }));
  }

  // ════════════════════════════════════════════════════════
  // Edição inline dos anunciantes existentes
  // ════════════════════════════════════════════════════════

  onNomeAlterado(i: number, valor: string): void {
    this.anuncios[i].nome = valor;
    this.anuncios[i].alterado = true;
  }

  async trocarFoto(i: number, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const resetInput = () => { input.value = ''; };
    if (!file) { resetInput(); return; }

    this.trocandoLogoIdx = i;
    try {
      const novaUrl = await this.processarUploadLogo(file);
      if (novaUrl) {
        this.anuncios[i].logoUrl = novaUrl;
        this.anuncios[i].alterado = true;
      }
    } finally {
      this.trocandoLogoIdx = -1;
      resetInput();
    }
  }

  removerAnuncio(i: number): void {
    if (this.anuncios.length <= 1) {
      this.toast('Deve haver pelo menos 1 anunciante. Pra zerar, cancele o patrocínio.', 'warning');
      return;
    }
    this.anuncios.splice(i, 1);
  }

  // ════════════════════════════════════════════════════════
  // Form de adicionar novo (idêntico ao da modal de ativação)
  // ════════════════════════════════════════════════════════

  abrirForm(): void {
    if (this.anuncios.length >= this.maxLogos) {
      this.toast(`Máximo ${this.maxLogos} anunciantes (limite do crédito).`, 'warning');
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
  }

  async onLogoSelecionado(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    const resetInput = () => { input.value = ''; };
    if (!file) { resetInput(); return; }

    this.enviandoLogo = true;
    try {
      const url = await this.processarUploadLogo(file);
      if (url) this.novoLogoUrl = url;
    } finally {
      this.enviandoLogo = false;
      resetInput();
    }
  }

  confirmarAdd(): void {
    const nome = this.novoNome.trim();
    if (!nome) { this.toast('Informe o nome do anunciante.', 'warning'); return; }
    if (!this.novoLogoUrl) { this.toast('Faça upload do logo.', 'warning'); return; }
    this.anuncios.push({ nome, logoUrl: this.novoLogoUrl, alterado: true });
    this.cancelarForm();
  }

  // ════════════════════════════════════════════════════════
  // Salvar / Fechar
  // ════════════════════════════════════════════════════════

  async salvar(): Promise<void> {
    if (!this.patrocinio?.id) return;
    if (this.anuncios.length === 0) {
      this.toast('Inclua pelo menos 1 anunciante.', 'warning');
      return;
    }
    if (this.anuncios.some(a => !a.nome.trim() || !a.logoUrl)) {
      this.toast('Todo anunciante precisa de nome e logo.', 'warning');
      return;
    }
    this.salvando = true;
    try {
      await this.patrSrv.editarPatrocinio(
        this.campeonatoId, this.categoriaId, this.jogoId, this.patrocinio.id,
        this.anuncios.map(a => ({ nome: a.nome.trim(), logoUrl: a.logoUrl })),
      );
      this.toast('Patrocínio atualizado.', 'success');
      await this.modalCtrl.dismiss({ atualizado: true });
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

  // ════════════════════════════════════════════════════════
  // Pipeline de upload (crop 16:9 + resize + upload Storage)
  // ════════════════════════════════════════════════════════

  /**
   * Pipeline completo: validação → pré-resize (se >2MB) → cropper 16:9 →
   * resize final 1080×608 → upload Storage. Retorna a URL final ou null
   * se o usuário cancelou.
   */
  private async processarUploadLogo(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
      this.toast('Arquivo precisa ser uma imagem (PNG, JPG, WebP).', 'warning');
      return null;
    }
    if (file.size > 30 * 1024 * 1024) {
      this.toast('Imagem muito grande (máx 30MB).', 'warning');
      return null;
    }

    // Pré-resize pra cropper não travar com fotos enormes.
    let arquivoCropper: File = file;
    try {
      if (file.size > 2 * 1024 * 1024) {
        const ext = file.type.includes('png') ? 'png' : 'jpg';
        const nomeBase = (file.name || 'logo').replace(/\.[^.]+$/, '');
        arquivoCropper = await this.reduzirParaCropper(file, 2000, nomeBase, ext);
      }
    } catch (err) {
      console.error('[EditarPatrocinio] pré-resize falhou', err);
      this.toast('Não consegui processar essa imagem.', 'danger');
      return null;
    }

    // Cropper.
    const cropModal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      backdropDismiss: false,
      componentProps: {
        file: arquivoCropper,
        aspectRatio: LOGO_ASPECT,
        title: `Recortar logo (16:9 — ${LOGO_OUTPUT_W}×${LOGO_OUTPUT_H})`,
      },
    });
    await cropModal.present();
    const { data } = await cropModal.onDidDismiss<{ blob?: Blob }>();
    if (!data?.blob) return null;

    // Resize final + upload.
    try {
      const resized = await this.resizeImagem(data.blob, LOGO_OUTPUT_W, LOGO_OUTPUT_H);
      const idx = this.anuncios.length; // path único por tamanho atual da lista
      const { url } = await this.storageSrv.uploadPatrocinadorJogoLogo(
        this.campeonatoId, this.categoriaId, this.jogoId, idx, resized,
      );
      return url;
    } catch (err) {
      console.error('[EditarPatrocinio] upload falhou', err);
      this.toast('Falha no upload da imagem.', 'danger');
      return null;
    }
  }

  private async reduzirParaCropper(
    file: File, maxLado: number, nomeBase: string, ext: string,
  ): Promise<File> {
    const bitmap = await this.blobParaBitmap(file);
    const srcW = (bitmap as { width: number }).width;
    const srcH = (bitmap as { height: number }).height;
    if (!srcW || !srcH || Math.max(srcW, srcH) <= maxLado) return file;

    const escala = maxLado / Math.max(srcW, srcH);
    const w = Math.round(srcW * escala);
    const h = Math.round(srcH * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha')), mime, 0.92);
    });
    return new File([blob], `${nomeBase}.${ext}`, { type: mime });
  }

  private async resizeImagem(blob: Blob, width: number, height: number): Promise<Blob> {
    const bitmap = await this.blobParaBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Falha PNG.')), 'image/png');
    });
  }

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

  private async toast(message: string, color: 'success' | 'warning' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: color === 'success' ? 2500 : 3500, color, position: 'top',
    });
    await t.present();
  }
}
