import { Component, inject } from '@angular/core';
import { PopoverController } from '@ionic/angular';

export type JogosAcao =
  | 'add-rodada'
  | 'add-partida'
  | 'editar-rodada'
  | 'reordenar-rodadas'
  | 'gerar-partidas'
  | 'exportar';

@Component({
  selector: 'app-jogos-acoes-popover',
  templateUrl: './jogos-acoes-popover.component.html',
  styleUrls: ['./jogos-acoes-popover.component.scss'],
  standalone: false,
})
export class JogosAcoesPopoverComponent {
  private readonly popoverCtrl = inject(PopoverController);

  pick(acao: JogosAcao): void {
    void this.popoverCtrl.dismiss({ acao });
  }
}
