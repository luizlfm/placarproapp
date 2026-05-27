import { Component, Input, inject } from '@angular/core';
import { PopoverController } from '@ionic/angular';

export type AcaoExportarEquipes =
  | 'colunas'
  | 'fase'
  | 'excel'
  | 'imprimir';

/**
 * Popover "Exportar" da tela de impressão de equipes.
 * Lista 4 ações: selecionar colunas, selecionar fase, exportar Excel e imprimir.
 * Replica o popover do copafacil mostrado no screenshot do usuário.
 */
@Component({
  selector: 'app-exportar-equipes-popover',
  templateUrl: './exportar-equipes-popover.component.html',
  styleUrls: ['./exportar-equipes-popover.component.scss'],
  standalone: false,
})
export class ExportarEquipesPopoverComponent {
  private readonly popCtrl = inject(PopoverController);

  /** Se não tem fases cadastradas, esconde a opção. */
  @Input() temFases = true;

  acao(acao: AcaoExportarEquipes): void {
    void this.popCtrl.dismiss({ acao });
  }
}
