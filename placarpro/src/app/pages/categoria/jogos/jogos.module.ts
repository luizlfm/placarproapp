import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { JogosPageRoutingModule } from './jogos-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { JogosPage } from './jogos.page';
import { ImprimirJogosPage } from './imprimir/imprimir-jogos.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    JogosPageRoutingModule,
    SharedModule,
  ],
  declarations: [JogosPage, ImprimirJogosPage],
})
export class JogosPageModule {}
