import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { MidiaPageRoutingModule } from './midia-routing.module';

import { MidiaPage } from './midia.page';
import { MidiaSharedModule } from '../../../shared/midia/midia-shared.module';
import { SharedModule } from '../../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    MidiaPageRoutingModule,
    MidiaSharedModule,
    // SharedModule traz o `<app-campeonato-mobile-header>` usado no topo
    // do template pra renderizar a barra navy + segments em mobile.
    SharedModule,
  ],
  declarations: [MidiaPage],
})
export class MidiaPageModule {}
