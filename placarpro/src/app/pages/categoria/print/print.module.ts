import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { PrintPageRoutingModule } from './print-routing.module';
import { PrintPage } from './print.page';
import { ExportarEquipesPopoverComponent } from './exportar-equipes-popover/exportar-equipes-popover.component';
import { ColunasEquipesModalComponent } from './colunas-equipes-modal/colunas-equipes-modal.component';
import { FaseEquipesModalComponent } from './fase-equipes-modal/fase-equipes-modal.component';
import { ColunasJogadoresModalComponent } from './colunas-jogadores-modal/colunas-jogadores-modal.component';
import { EquipesJogadoresModalComponent } from './equipes-jogadores-modal/equipes-jogadores-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PrintPageRoutingModule,
  ],
  declarations: [
    PrintPage,
    ExportarEquipesPopoverComponent,
    ColunasEquipesModalComponent,
    FaseEquipesModalComponent,
    ColunasJogadoresModalComponent,
    EquipesJogadoresModalComponent,
  ],
})
export class PrintPageModule {}
