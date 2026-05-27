import { Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

/** Botão de ação no modal — formato compatível com ActionSheetButton do Ionic. */
export interface ActionModalButton {
  text: string;
  icon?: string;
  /** 'destructive' = vermelho; 'cancel' = botão de cancelar no rodapé. */
  role?: 'destructive' | 'cancel' | 'default';
  /** Handler opcional. Retorne `false` pra cancelar o dismiss. */
  handler?: () => boolean | void | Promise<boolean | void>;
  /** Cor explícita do Ionic (sobrescreve o role). */
  color?: string;
  /** Desabilita o botão. */
  disabled?: boolean;
}

/**
 * Modal de ações — substitui o ion-action-sheet global do app por um
 * modal centralizado com a mesma API. Visual mais alinhado ao resto
 * do PlacarPro.
 *
 * Use via `ActionModalService.create({ header, buttons })` em vez de
 * `ActionSheetController.create`.
 */
@Component({
  selector: 'app-action-modal',
  templateUrl: './action-modal.component.html',
  styleUrls: ['./action-modal.component.scss'],
  standalone: false,
})
export class ActionModalComponent {
  @Input() header = '';
  @Input() subHeader = '';
  @Input() buttons: ActionModalButton[] = [];

  private readonly modalCtrl = inject(ModalController);

  /** Lista de botões "comuns" (não-cancel) — renderizada no corpo. */
  get botoesAcao(): ActionModalButton[] {
    return this.buttons.filter(b => b.role !== 'cancel');
  }

  /** Botão de cancelar (se existir) — renderizado no rodapé. */
  get botaoCancelar(): ActionModalButton | undefined {
    return this.buttons.find(b => b.role === 'cancel');
  }

  async onClick(btn: ActionModalButton): Promise<void> {
    if (btn.disabled) return;
    // Captura ref do PRÓPRIO modal ANTES de executar o handler — o handler
    // pode abrir outros modais que viram o "topo" da stack do Ionic. Fechar
    // pelo controller global fecharia o errado.
    const meuModal = await this.modalCtrl.getTop();
    let abortDismiss = false;
    if (btn.handler) {
      try {
        const result = await btn.handler();
        if (result === false) abortDismiss = true;
      } catch (err) {
        console.error('[ActionModal] handler erro', err);
      }
    }
    if (!abortDismiss) {
      await meuModal?.dismiss({ role: btn.role ?? 'default', text: btn.text });
    }
  }

  async fechar(): Promise<void> {
    const meuModal = await this.modalCtrl.getTop();
    await meuModal?.dismiss({ role: 'cancel' });
  }
}
