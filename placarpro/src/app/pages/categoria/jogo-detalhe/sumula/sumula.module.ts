import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SharedModule } from '../../../../shared/shared.module';
import { SumulaPage } from './sumula.page';

/**
 * Wrapper module pra permitir que o SumulaPage seja usado tanto como
 * rota (em JogoDetalhePageModule) quanto como MODAL aberto a partir
 * do EditarInformacoesModalComponent (que é usado em jogos, classificação
 * e jogo-detalhe). Em Angular legacy um componente só pode estar em um
 * único NgModule — esse módulo isolado evita duplicação e garante que
 * SumulaPage esteja disponível em qualquer contexto que precise abri-lo
 * como modal.
 */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, SharedModule],
  declarations: [SumulaPage],
  exports: [SumulaPage],
})
export class SumulaPageModule {}
