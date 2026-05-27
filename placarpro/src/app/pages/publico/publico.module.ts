import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { PublicoPageRoutingModule } from './publico-routing.module';
import { PublicoPage } from './publico.page';
import { PublicoCategoriaPage } from './categoria/publico-categoria.page';
import { PublicoEquipePage } from './equipe/publico-equipe.page';
import { VotarModalComponent } from './categoria/votar-modal/votar-modal.component';
import { SharedModule } from '../../shared/shared.module';
import { MidiaSharedModule } from '../../shared/midia/midia-shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    PublicoPageRoutingModule,
    SharedModule,
    // Disponibiliza o ViewerModalComponent para abrir mídias inline.
    MidiaSharedModule,
  ],
  declarations: [PublicoPage, PublicoCategoriaPage, PublicoEquipePage, VotarModalComponent],
})
export class PublicoPageModule {}
