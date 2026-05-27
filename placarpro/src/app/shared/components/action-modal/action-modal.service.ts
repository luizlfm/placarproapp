import { Injectable, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import {
  ActionModalButton,
  ActionModalComponent,
} from './action-modal.component';

export interface ActionModalCreateOptions {
  header?: string;
  subHeader?: string;
  buttons: ActionModalButton[];
}

/**
 * Substitui o `ActionSheetController` global por modal centralizado
 * (visual mais alinhado ao PlacarPro). API praticamente idêntica:
 *
 *   const sheet = await actionModalSrv.create({ header, buttons });
 *   await sheet.present();
 */
@Injectable({ providedIn: 'root' })
export class ActionModalService {
  private readonly modalCtrl = inject(ModalController);

  async create(opts: ActionModalCreateOptions): Promise<HTMLIonModalElement> {
    return this.modalCtrl.create({
      component: ActionModalComponent,
      componentProps: {
        header: opts.header ?? '',
        subHeader: opts.subHeader ?? '',
        buttons: opts.buttons ?? [],
      },
      cssClass: 'action-modal-overlay',
      backdropDismiss: true,
      showBackdrop: false, // o componente desenha o próprio backdrop
    });
  }
}
