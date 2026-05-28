import { Component, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { salvarRedirectPosInstall } from '../../utils/pwa.utils';

/**
 * Modal-tutorial que ensina o user a "Adicionar à Tela de Início"
 * (instalar o app como PWA) no iOS Safari.
 *
 * Não é possível disparar o prompt nativo (Apple bloqueia), então
 * mostramos ilustrações + texto explicando os 3 passos. Antes de
 * exibir, salvamos a URL atual no localStorage pra que quando o
 * user abrir o PWA pela home screen, navegue direto pra essa tela
 * já logado.
 */
@Component({
  selector: 'app-ios-pwa-tutorial-modal',
  templateUrl: './ios-pwa-tutorial-modal.component.html',
  styleUrls: ['./ios-pwa-tutorial-modal.component.scss'],
  standalone: false,
})
export class IosPwaTutorialModalComponent {
  /** URL pra redirecionar depois do install. Default: rota atual. */
  @Input() redirectUrl?: string;
  /** Contexto exibido no modal (ex: "tela cheia da transmissão"). */
  @Input() contextoLabel = 'tela cheia da transmissão';

  constructor(private readonly modalCtrl: ModalController) {
    // Salva a URL pendente assim que o modal abre — se o user
    // instalar e abrir pelo ícone PWA, é redirecionado pra cá.
    salvarRedirectPosInstall(this.redirectUrl);
  }

  fechar(): void {
    this.modalCtrl.dismiss();
  }
}
