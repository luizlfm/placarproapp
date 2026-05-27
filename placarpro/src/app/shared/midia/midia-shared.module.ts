import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { AdicionarLinkModalComponent } from './adicionar-link/adicionar-link.modal';
import { CriarNoticiaModalComponent } from './criar-noticia/criar-noticia.modal';
import { YoutubeModalComponent } from './youtube/youtube.modal';
import { ViewerModalComponent } from './viewer/viewer.modal';
import { MidiaAcoesModalComponent } from './midia-acoes/midia-acoes.modal';
import { EditarMidiaModalComponent } from './editar-midia/editar-midia.modal';

/**
 * Modais compartilhados pelas páginas de Mídia (campeonato e categoria).
 * Importe este módulo em vez de declarar os componentes individualmente.
 */
@NgModule({
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IonicModule],
  declarations: [
    AdicionarLinkModalComponent,
    CriarNoticiaModalComponent,
    YoutubeModalComponent,
    ViewerModalComponent,
    MidiaAcoesModalComponent,
    EditarMidiaModalComponent,
  ],
  exports: [
    AdicionarLinkModalComponent,
    CriarNoticiaModalComponent,
    YoutubeModalComponent,
    ViewerModalComponent,
    MidiaAcoesModalComponent,
    EditarMidiaModalComponent,
  ],
})
export class MidiaSharedModule {}
