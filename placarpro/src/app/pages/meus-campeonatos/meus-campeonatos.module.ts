import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { MeusCampeonatosPageRoutingModule } from './meus-campeonatos-routing.module';

import { MeusCampeonatosPage } from './meus-campeonatos.page';
import { NovoCampeonatoModalComponent } from './novo-campeonato-modal/novo-campeonato-modal.component';
import { DuplicarCampeonatoModalComponent } from './duplicar-campeonato-modal/duplicar-campeonato-modal.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    MeusCampeonatosPageRoutingModule,
    SharedModule,
  ],
  declarations: [
    MeusCampeonatosPage,
    NovoCampeonatoModalComponent,
    DuplicarCampeonatoModalComponent,
  ],
})
export class MeusCampeonatosPageModule {}
