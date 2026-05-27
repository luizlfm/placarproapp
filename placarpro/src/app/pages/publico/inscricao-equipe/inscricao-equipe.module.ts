import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { InscricaoEquipePageRoutingModule } from './inscricao-equipe-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { InscricaoEquipePage } from './inscricao-equipe.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    InscricaoEquipePageRoutingModule,
    SharedModule,
  ],
  declarations: [InscricaoEquipePage],
})
export class InscricaoEquipePageModule {}
