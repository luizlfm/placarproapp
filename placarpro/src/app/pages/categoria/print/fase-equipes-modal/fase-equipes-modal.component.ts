import { Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Fase } from '../../../../campeonatos/models/fase.model';

/**
 * Modal de seleção de fase para o relatório de equipes.
 * "Todas as fases" → retorna null. Senão retorna a fase escolhida.
 */
@Component({
  selector: 'app-fase-equipes-modal',
  templateUrl: './fase-equipes-modal.component.html',
  styleUrls: ['./fase-equipes-modal.component.scss'],
  standalone: false,
})
export class FaseEquipesModalComponent {
  private readonly modalCtrl = inject(ModalController);

  @Input() fases: Fase[] = [];
  @Input() faseAtualId: string | null = null;

  selecionar(faseId: string | null): void {
    void this.modalCtrl.dismiss({ faseId }, 'save');
  }

  fechar(): void {
    void this.modalCtrl.dismiss(undefined, 'cancel');
  }

  trackByFase(_i: number, f: Fase): string {
    return f.id ?? '';
  }
}
