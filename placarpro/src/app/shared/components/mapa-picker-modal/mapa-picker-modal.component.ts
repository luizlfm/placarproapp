import { Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

/**
 * Wrapper "modal" do MapaPickerComponent. Usa o componente embeddable
 * `<app-mapa-picker>` dentro de um ion-header + ion-content padrão.
 *
 * Antes esse componente continha toda a lógica do Leaflet — agora
 * delega pro MapaPickerComponent, que pode ser embedded inline em
 * qualquer outro modal/página (ex: LocaisCadastrados).
 */
@Component({
  selector: 'app-mapa-picker-modal',
  templateUrl: './mapa-picker-modal.component.html',
  styleUrls: ['./mapa-picker-modal.component.scss'],
  standalone: false,
})
export class MapaPickerModalComponent {
  @Input() lat: number | null = null;
  @Input() lng: number | null = null;
  @Input() endereco = '';

  private readonly modalCtrl = inject(ModalController);

  /** Recebe os dados confirmados do `<app-mapa-picker>` e fecha o modal
   *  retornando eles pro caller (mesmo contrato anterior). */
  async aoConfirmar(data: { lat: number; lng: number; endereco?: string }): Promise<void> {
    await this.modalCtrl.dismiss(data);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
