import { Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { MODALIDADES, Modalidade, ModalidadeId } from '../../../campeonatos/modalidades';

/**
 * Bottom sheet com a lista de modalidades disponíveis (Futsal, Futebol, etc).
 * Pode ser aberto via ModalController de qualquer tela que importe SharedModule.
 */
@Component({
  selector: 'app-modalidade-picker',
  templateUrl: './modalidade-picker.component.html',
  styleUrls: ['./modalidade-picker.component.scss'],
  standalone: false,
})
export class ModalidadePickerComponent {
  @Input() atual: ModalidadeId | null = null;

  private readonly modalCtrl = inject(ModalController);

  readonly modalidades = MODALIDADES;

  selecionar(m: Modalidade): Promise<boolean> {
    return this.modalCtrl.dismiss({ modalidade: m.id });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
