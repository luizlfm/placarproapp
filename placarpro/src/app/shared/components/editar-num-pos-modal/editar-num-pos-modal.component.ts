import { Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

/**
 * Modal enxuto pra editar o NÚMERO da camisa e a POSIÇÃO de um jogador
 * direto da tela de escalação (ao clicar na camisa no campo). Devolve
 * `{ numeroCamisa, posicao }` no dismiss (ou nada se cancelar).
 */
@Component({
  selector: 'app-editar-num-pos-modal',
  templateUrl: './editar-num-pos-modal.component.html',
  styleUrls: ['./editar-num-pos-modal.component.scss'],
  standalone: false,
})
export class EditarNumPosModalComponent {
  @Input() nome = '';
  @Input() numero = '';
  @Input() posicao = '';

  private readonly modalCtrl = inject(ModalController);

  /** Posições padrão (texto casado com o classificador do campo). */
  readonly posicoes: string[] = [
    'Goleiro',
    'Lateral Direito',
    'Zagueiro',
    'Lateral Esquerdo',
    'Volante',
    'Meia Direita',
    'Meia Central',
    'Meia Esquerda',
    'Ponta Direita',
    'Centroavante',
    'Ponta Esquerda',
    'Atacante',
  ];

  cancelar(): void {
    void this.modalCtrl.dismiss(null);
  }

  salvar(): void {
    void this.modalCtrl.dismiss({
      numeroCamisa: (this.numero ?? '').toString().trim(),
      posicao: (this.posicao ?? '').trim(),
    });
  }
}
