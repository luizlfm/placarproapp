import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { ImageCroppedEvent } from 'ngx-image-cropper';
import { PatrocinadorJogo } from '../../../../campeonatos/models/jogo.model';
import { StorageService } from '../../../../shared/storage.service';
import { JogosService } from '../../../../campeonatos/jogos.service';

@Component({
  selector: 'app-patrocinador-jogo-modal',
  templateUrl: './patrocinador-jogo-modal.component.html',
  styleUrls: ['./patrocinador-jogo-modal.component.scss'],
  standalone: false,
})
export class PatrocinadorJogoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  @Input() patrocinadores: PatrocinadorJogo[] = [];
  /** Índice do patrocinador sendo editado; -1 = novo */
  @Input() idx = -1;

  private readonly modalCtrl  = inject(ModalController);
  private readonly toastCtrl  = inject(ToastController);
  private readonly storageSrv = inject(StorageService);
  private readonly jogosSrv   = inject(JogosService);

  // ── Form ──────────────────────────────────────────────────────────
  nome        = '';
  previewUrl  = '';       // URL final (pós-crop ou URL remota salva)
  arquivoLogo: File | null = null;
  salvando    = false;

  // ── Crop ──────────────────────────────────────────────────────────
  modoCrop      = false;
  fileParaCrop: File | null = null;
  cropEvento: ImageCroppedEvent | null = null;
  cropCarregando = true;   // enquanto a lib carrega a imagem

  ngOnInit(): void {
    if (this.idx >= 0) {
      const pat = this.patrocinadores[this.idx];
      this.nome      = pat?.nome ?? '';
      this.previewUrl = pat?.logoUrl ?? '';
    }
  }

  fechar(): void {
    if (this.modoCrop) {
      // Cancela o crop, volta ao form sem alterar nada
      this.cancelarCorte();
    } else {
      void this.modalCtrl.dismiss(null, 'cancel');
    }
  }

  // ── Selecionar arquivo → abre cropper ─────────────────────────────
  escolherFoto(): void {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      if (!file) return;
      this.fileParaCrop  = file;
      this.cropEvento    = null;
      this.cropCarregando = true;
      this.modoCrop      = true;
    };
    input.click();
  }

  removerFoto(): void {
    this.previewUrl  = '';
    this.arquivoLogo = null;
  }

  // ── Eventos do cropper ────────────────────────────────────────────
  onCropperCarregado(): void {
    this.cropCarregando = false;
  }

  onImageCropped(event: ImageCroppedEvent): void {
    this.cropEvento = event;
  }

  confirmarCorte(): void {
    const ev = this.cropEvento;
    if (!ev) return;

    // Exibe preview imediato (base64 do crop)
    if (ev.base64) {
      this.previewUrl = ev.base64;
    } else if (ev.blob) {
      this.previewUrl = URL.createObjectURL(ev.blob);
    }

    // Guarda o blob como File pra upload posterior
    if (ev.blob) {
      const mime = ev.blob.type || 'image/jpeg';
      const ext  = mime.includes('png') ? 'png' : 'jpg';
      this.arquivoLogo = new File([ev.blob], `logo.${ext}`, { type: mime });
    }

    this.modoCrop     = false;
    this.fileParaCrop = null;
    this.cropEvento   = null;
  }

  cancelarCorte(): void {
    this.modoCrop     = false;
    this.fileParaCrop = null;
    this.cropEvento   = null;
    this.cropCarregando = true;
  }

  // ── Salvar ────────────────────────────────────────────────────────
  get nomeTrimado(): string { return this.nome.trim(); }
  get podeSalvar(): boolean { return !!this.nomeTrimado && !this.salvando && !this.modoCrop; }

  async salvar(): Promise<void> {
    if (!this.podeSalvar) return;
    this.salvando = true;

    const lista   = [...this.patrocinadores];
    const posicao = this.idx >= 0 ? this.idx : lista.length;

    let logoUrl: string | undefined  = this.idx >= 0 ? (lista[posicao]?.logoUrl ?? undefined) : undefined;
    let logoPath: string | undefined = this.idx >= 0 ? (lista[posicao]?.logoPath ?? undefined) : undefined;

    if (this.arquivoLogo) {
      const toast = await this.toastCtrl.create({
        message: 'Enviando logo…',
        duration: 30_000,
        position: 'top',
      });
      await toast.present();
      try {
        const r = await this.storageSrv.uploadPatrocinadorJogoLogo(
          this.campeonatoId, this.categoriaId, this.jogoId, posicao, this.arquivoLogo,
        );
        logoUrl  = r.url;
        logoPath = r.path;
      } catch {
        await toast.dismiss();
        await this.toast('Erro ao enviar logo.', 'danger');
        this.salvando = false;
        return;
      }
      await toast.dismiss();
    } else if (!this.previewUrl) {
      logoUrl  = undefined;
      logoPath = undefined;
    }

    const pat: PatrocinadorJogo = {
      nome: this.nomeTrimado,
      ...(logoUrl  ? { logoUrl  } : {}),
      ...(logoPath ? { logoPath } : {}),
    };

    if (this.idx >= 0) {
      lista[posicao] = pat;
    } else {
      lista.push(pat);
    }

    try {
      await this.jogosSrv.atualizar(
        this.campeonatoId, this.categoriaId, this.jogoId,
        { patrocinadores: lista },
      );
      await this.modalCtrl.dismiss(lista, 'saved');
    } catch {
      await this.toast('Erro ao salvar patrocinador.', 'danger');
      this.salvando = false;
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color });
    await t.present();
  }
}
