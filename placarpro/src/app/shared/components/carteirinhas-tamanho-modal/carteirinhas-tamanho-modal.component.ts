import { Component, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import {
  TAMANHOS_CARTEIRINHA,
  TamanhoCarteirinha,
} from '../../../campeonatos/carteirinhas-pdf.service';

/**
 * Modal 1 do fluxo de impressão de carteirinhas: lista as 5 opções
 * de tamanho. Ao escolher, fecha retornando o tamanho selecionado.
 */
@Component({
  selector: 'app-carteirinhas-tamanho-modal',
  templateUrl: './carteirinhas-tamanho-modal.component.html',
  styleUrls: ['./carteirinhas-tamanho-modal.component.scss'],
  standalone: false,
})
export class CarteirinhasTamanhoModalComponent {
  private readonly modalCtrl = inject(ModalController);
  readonly tamanhos = TAMANHOS_CARTEIRINHA;

  escolher(t: TamanhoCarteirinha): Promise<boolean> {
    return this.modalCtrl.dismiss(t);
  }

  cancelar(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
