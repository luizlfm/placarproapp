import { Component, Input, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ModalController } from '@ionic/angular';

/**
 * Modal genérico que carrega uma rota do próprio app dentro de um iframe.
 *
 * Útil quando queremos "abrir uma página dentro de outra" sem refatorar
 * a página alvo. Exemplos:
 *  - Editar ficha de inscrição dentro da página pública do campeonato
 *  - Visualizar um termo de autorização sem sair do dashboard
 *
 * Uso:
 * ```ts
 * const modal = await this.modalCtrl.create({
 *   component: IframeRotaModalComponent,
 *   componentProps: { url: '/inscricao/abc123', titulo: 'Editar ficha' },
 * });
 * await modal.present();
 * ```
 *
 * O componente sanitiza a URL via DomSanitizer (resource trust) pra evitar
 * o warning do Angular sobre URLs não confiáveis em [src]. Como a URL é
 * sempre construída internamente (não vem de input do usuário), o trust
 * é seguro nesse contexto.
 */
@Component({
  selector: 'app-iframe-rota-modal',
  templateUrl: './iframe-rota-modal.component.html',
  styleUrls: ['./iframe-rota-modal.component.scss'],
  standalone: false,
})
export class IframeRotaModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly sanitizer = inject(DomSanitizer);

  /** URL relativa (com query params se quiser) — ex: `/inscricao/ABC?embedded=1`. */
  @Input() url = '';
  /** Título exibido no header do modal. */
  @Input() titulo = '';

  /** URL sanitizada — Angular exige isso pra usar em [src] de iframe. */
  get urlSegura(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.url);
  }

  async fechar(): Promise<void> {
    await this.modalCtrl.dismiss();
  }
}
