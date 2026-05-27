import { Component, Input, inject } from '@angular/core';
import { PopoverController } from '@ionic/angular';

export type JogoAcao =
  | 'ver'
  | 'equipes'
  | 'resultado'
  | 'informacoes'
  | 'restaurar'
  | 'remover';

@Component({
  selector: 'app-jogo-acoes-popover',
  templateUrl: './jogo-acoes-popover.component.html',
  styleUrls: ['./jogo-acoes-popover.component.scss'],
  standalone: false,
})
export class JogoAcoesPopoverComponent {
  private readonly popoverCtrl = inject(PopoverController);

  /**
   * Quando `false`, esconde todas as ações de edição (Selecionar equipes,
   * Editar resultado, Editar informações, Restaurar, Remover) — fica só
   * "Ver partida". Usado pra moderadores sem `editarResultados`.
   * Default `true` mantém comportamento legacy pra callers que ainda não
   * passam essa flag.
   */
  @Input() podeEditar = true;

  pick(acao: JogoAcao): void {
    void this.popoverCtrl.dismiss({ acao });
  }
}
