import { Component, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { FaseTipo } from '../../../../campeonatos/models/fase.model';

@Component({
  selector: 'app-nova-fase-modal',
  templateUrl: './nova-fase-modal.component.html',
  styleUrls: ['./nova-fase-modal.component.scss'],
  standalone: false,
})
export class NovaFaseModalComponent {
  private readonly modalCtrl = inject(ModalController);

  escolher(tipo: FaseTipo): Promise<boolean> {
    return this.modalCtrl.dismiss({ tipo });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
