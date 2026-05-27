import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { EquipesPageRoutingModule } from './equipes-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { EquipesPage } from './equipes.page';
import { EquipeModalComponent } from './equipe-modal/equipe-modal.component';
import { JogadorModalComponent } from './jogador-modal/jogador-modal.component';
import { ImportarJogadoresModalComponent } from './importar-jogadores-modal/importar-jogadores-modal.component';
import { EquipeTecnicaModalComponent } from './equipe-tecnica-modal/equipe-tecnica-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    EquipesPageRoutingModule,
    SharedModule,
  ],
  declarations: [
    EquipesPage,
    EquipeModalComponent,
    JogadorModalComponent,
    ImportarJogadoresModalComponent,
    EquipeTecnicaModalComponent,
  ],
})
export class EquipesPageModule {}
