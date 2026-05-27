import { Component, Input, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ModalController } from '@ionic/angular';
import { Midia } from '../../../campeonatos/models/midia.model';

@Component({
  selector: 'app-midia-viewer-modal',
  templateUrl: './viewer.modal.html',
  styleUrls: ['./viewer.modal.scss'],
  standalone: false,
})
export class ViewerModalComponent {
  @Input() midia!: Midia;

  private readonly modalCtrl = inject(ModalController);
  private readonly sanitizer = inject(DomSanitizer);

  get youtubeEmbed(): SafeResourceUrl | null {
    if (this.midia?.tipo !== 'youtube' || !this.midia.youtubeId) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${this.midia.youtubeId}?autoplay=1`,
    );
  }

  /** Abre a URL externa do tipo `link` em nova aba. */
  abrirLinkExterno(): void {
    if (this.midia?.tipo === 'link' && this.midia.url) {
      window.open(this.midia.url, '_blank', 'noopener');
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
