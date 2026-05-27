import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { InscricoesPageRoutingModule } from './inscricoes-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { InscricoesPage } from './inscricoes.page';
import { FormularioCamposModalComponent } from './formulario-campos-modal/formulario-campos-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    InscricoesPageRoutingModule,
    SharedModule,
  ],
  declarations: [InscricoesPage, FormularioCamposModalComponent],
})
export class InscricoesPageModule {}
