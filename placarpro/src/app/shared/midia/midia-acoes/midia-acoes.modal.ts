import { Component, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

/** IDs das ações que o modal pode retornar. */
export type MidiaAcao =
  | 'galeria'
  | 'video'
  | 'link'
  | 'noticia'
  | 'youtube'
  | 'baixar-todas'
  | 'exportar';

interface OpcaoMenu {
  acao: MidiaAcao;
  label: string;
  icon: string;
}

/**
 * Modal substituto do ActionSheet de "Adicionar mídia".
 * Retorna `{ acao }` via dismiss; o chamador roteia para o fluxo correto.
 */
@Component({
  selector: 'app-midia-acoes-modal',
  templateUrl: './midia-acoes.modal.html',
  styleUrls: ['./midia-acoes.modal.scss'],
  standalone: false,
})
export class MidiaAcoesModalComponent {
  private readonly modalCtrl = inject(ModalController);

  readonly opcoes: OpcaoMenu[] = [
    { acao: 'galeria',      label: 'Galeria',          icon: 'images-outline' },
    { acao: 'link',         label: 'Adicionar link',   icon: 'globe-outline' },
    { acao: 'noticia',      label: 'Criar notícia',    icon: 'newspaper-outline' },
    { acao: 'youtube',      label: 'Youtube',          icon: 'logo-youtube' },
    { acao: 'video',        label: 'Vídeo da galeria', icon: 'film-outline' },
    { acao: 'baixar-todas', label: 'Baixar todas',     icon: 'cloud-download-outline' },
    { acao: 'exportar',     label: 'Exportar (JSON)',  icon: 'document-text-outline' },
  ];

  selecionar(acao: MidiaAcao): Promise<boolean> {
    return this.modalCtrl.dismiss({ acao });
  }

  fechar(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackByAcao(_i: number, o: OpcaoMenu): string {
    return o.acao;
  }
}
