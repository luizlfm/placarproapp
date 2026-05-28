import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { SumulasPreviewPage } from './sumulas-preview.page';
import { SumulasPreviewPageRoutingModule } from './sumulas-preview-routing.module';
import { SumulaPageModule } from '../jogo-detalhe/sumula/sumula.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SumulasPreviewPageRoutingModule,
    /* Necessário pra abrir a SumulaPage como modal a partir do botão
       "Visualizar" — reaproveita a mesma UX da súmula do jogo-detalhe
       (rotação no mobile, pinch-zoom, baixar PDF, imprimir). */
    SumulaPageModule,
  ],
  declarations: [SumulasPreviewPage],
})
export class SumulasPreviewPageModule {}
