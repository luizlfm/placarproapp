import { Component, Input, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';

/** Tipo de informação a mostrar — define título, ícone e conteúdo. */
export type InfoTipo = 'embed' | 'api' | 'visualizacoes';

/**
 * Modal de exibição/cópia de informações somente-leitura.
 * Usado por HTML de incorporação, API JSON e Visualizações.
 */
@Component({
  selector: 'app-info-modal',
  templateUrl: './info-modal.component.html',
  styleUrls: ['./info-modal.component.scss'],
  standalone: false,
})
export class InfoModalComponent {
  @Input() tipo: InfoTipo = 'embed';
  @Input() campeonatoId = '';
  @Input() slug = '';
  @Input() shortCode = '';
  /** Quando `tipo === 'visualizacoes'`. */
  @Input() visualizacoes = 0;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  get titulo(): string {
    if (this.tipo === 'embed') return 'HTML de incorporação';
    if (this.tipo === 'api') return 'API JSON';
    return 'Visualizações';
  }

  get descricao(): string {
    if (this.tipo === 'embed') {
      return 'Copie e cole o código abaixo no seu site para incorporar o campeonato em um iframe responsivo.';
    }
    if (this.tipo === 'api') {
      return 'Endpoint JSON com dados do campeonato. Atualiza em tempo real conforme novas partidas e equipes são cadastradas.';
    }
    return 'Total de visualizações da página pública do campeonato.';
  }

  /** URL pública canônica usada nos códigos de embed/API. */
  get urlPublica(): string {
    const base = typeof location !== 'undefined' ? location.origin : 'https://placarproapp.com';
    const slug = this.slug || this.shortCode || this.campeonatoId;
    return `${base}/${slug}`;
  }

  get codigoEmbed(): string {
    return `<iframe\n  src="${this.urlPublica}"\n  width="100%"\n  height="800"\n  frameborder="0"\n  allow="fullscreen"\n  title="Acompanhe o campeonato">\n</iframe>`;
  }

  get urlApi(): string {
    return `${this.urlPublica}?format=json`;
  }

  /** Texto principal que será copiado pelo botão. */
  get textoCopiavel(): string {
    if (this.tipo === 'embed') return this.codigoEmbed;
    if (this.tipo === 'api') return this.urlApi;
    return '';
  }

  async copiar(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.textoCopiavel);
      const t = await this.toastCtrl.create({
        message: 'Copiado para a área de transferência!',
        duration: 2000, position: 'top', color: 'success',
      });
      await t.present();
    } catch (err) {
      console.error('[Info] copiar erro', err);
      const t = await this.toastCtrl.create({
        message: 'Não foi possível copiar.', duration: 2200, position: 'top', color: 'danger',
      });
      await t.present();
    }
  }

  abrirNovaAba(): void {
    if (this.tipo === 'api') window.open(this.urlApi, '_blank', 'noopener');
    if (this.tipo === 'visualizacoes') window.open(this.urlPublica, '_blank', 'noopener');
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
