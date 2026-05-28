import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ModalController, ToastController } from '@ionic/angular';

/**
 * Modal que exibe um PDF dentro do app + botão "Salvar PDF".
 *
 * Por que existe: no iOS Safari, `pdf.save()` (e até `window.open` quando
 * há awaits antes) sequestra a aba do app pra mostrar o PDF inline, e o
 * usuário tem que adivinhar como salvar via Safari. Pior: a `navigator.share`
 * com files exige "user activation" — se houver awaits assíncronos entre o
 * clique e a chamada, o iOS rejeita.
 *
 * Solução: gerar o PDF, abrir ESTE modal mostrando o PDF num iframe, e
 * deixar o "Salvar" como um botão dentro do modal. Quando o usuário toca,
 * a `navigator.share` é chamada com user activation FRESCA → share sheet
 * nativo abre normalmente com "Salvar em Arquivos".
 */
@Component({
  selector: 'app-pdf-viewer-modal',
  templateUrl: './pdf-viewer-modal.component.html',
  styleUrls: ['./pdf-viewer-modal.component.scss'],
  standalone: false,
})
export class PdfViewerModalComponent implements OnInit, OnDestroy {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly sanitizer = inject(DomSanitizer);

  @Input() blob!: Blob;
  @Input() fileName = 'arquivo.pdf';

  blobUrl?: string;
  safeBlobUrl?: SafeResourceUrl;

  ngOnInit(): void {
    if (!this.blob) {
      console.error('[PdfViewerModal] blob ausente');
      return;
    }
    this.blobUrl = URL.createObjectURL(this.blob);
    this.safeBlobUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.blobUrl);
  }

  ngOnDestroy(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
  }

  async salvar(): Promise<void> {
    const file = new File([this.blob], this.fileName, { type: 'application/pdf' });
    const nav = navigator as Navigator & {
      canShare?: (data: { files?: File[] }) => boolean;
      share?: (data: { files?: File[]; title?: string }) => Promise<void>;
    };

    if (typeof nav.share === 'function' &&
      typeof nav.canShare === 'function' &&
      nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: this.fileName });
        await this.modalCtrl.dismiss();
        return;
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err &&
          (err as { name: string }).name === 'AbortError') {
          return;
        }
        console.warn('[PdfViewerModal] Web Share falhou', err);
      }
    }

    if (this.blobUrl) {
      const a = document.createElement('a');
      a.href = this.blobUrl;
      a.download = this.fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      const t = await this.toastCtrl.create({
        message: 'Download iniciado.',
        duration: 2000,
        color: 'success',
        position: 'bottom',
      });
      await t.present();
    }
  }

  async fechar(): Promise<void> {
    await this.modalCtrl.dismiss();
  }
}
