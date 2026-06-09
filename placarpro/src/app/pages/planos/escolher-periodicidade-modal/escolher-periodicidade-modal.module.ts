import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { EscolherPeriodicidadeModalComponent } from './escolher-periodicidade-modal.component';

/**
 * Módulo que declara e exporta o modal de escolha de periodicidade.
 * Compartilhado entre a tela de Planos (campeonatos) e a tela de Upgrade
 * do Racha — ambos abrem o modal via `ModalController`.
 */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule],
  declarations: [EscolherPeriodicidadeModalComponent],
  exports: [EscolherPeriodicidadeModalComponent],
})
export class EscolherPeriodicidadeModalModule {}
