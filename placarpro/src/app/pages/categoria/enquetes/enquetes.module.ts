import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { EnquetesPageRoutingModule } from './enquetes-routing.module';
import { EnquetesPage } from './enquetes.page';
import { EditarEnqueteModalComponent } from './editar-enquete-modal/editar-enquete-modal.component';
import { AlternativasModalComponent } from './alternativas-modal/alternativas-modal.component';
import { VotacaoModalComponent } from './votacao-modal/votacao-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    EnquetesPageRoutingModule,
  ],
  declarations: [
    EnquetesPage,
    EditarEnqueteModalComponent,
    AlternativasModalComponent,
    VotacaoModalComponent,
  ],
})
export class EnquetesPageModule {}
