import { Component, Input, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { ImageCroppedEvent } from 'ngx-image-cropper';

/**
 * Modal de crop de imagem.
 * Recebe o arquivo via input (File) e o aspect ratio desejado.
 * Retorna o Blob cortado quando o usuário confirma.
 *
 * Uso:
 *   const modal = await modalCtrl.create({
 *     component: ImageCropperModalComponent,
 *     componentProps: {
 *       file: file,
 *       aspectRatio: 1,           // 1:1 logo
 *       outputType: 'blob',
 *     },
 *   });
 *   const { data } = await modal.onDidDismiss<{ blob?: Blob; dataUrl?: string }>();
 *   if (data?.blob) {
 *     await storageSrv.upload(path, data.blob);
 *   }
 */
@Component({
  selector: 'app-image-cropper-modal',
  templateUrl: './image-cropper-modal.component.html',
  styleUrls: ['./image-cropper-modal.component.scss'],
  standalone: false,
})
export class ImageCropperModalComponent {
  @Input() file?: File;
  @Input() aspectRatio = 1;
  @Input() title = 'Ajustar imagem';
  /** Output em base64 (dataUrl) e/ou blob. */
  @Input() roundCropper = false;
  @Input() maintainAspectRatio = true;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  croppedBlob?: Blob;
  croppedDataUrl?: string;
  loading = false;

  imageCropped(event: ImageCroppedEvent): void {
    this.croppedBlob = event.blob ?? undefined;
    this.croppedDataUrl = event.objectUrl ?? undefined;
  }

  imageLoaded(): void {
    this.loading = false;
  }

  loadImageFailed(): void {
    this.loading = false;
    this.toast('Não foi possível carregar a imagem.');
    this.cancel();
  }

  async confirm(): Promise<void> {
    if (!this.croppedBlob) {
      await this.toast('Aguarde a imagem carregar.');
      return;
    }
    await this.modalCtrl.dismiss({ blob: this.croppedBlob, dataUrl: this.croppedDataUrl });
  }

  cancel(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
      color: 'warning',
    });
    await t.present();
  }
}
