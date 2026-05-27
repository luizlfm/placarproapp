import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { RelatoriosPageRoutingModule } from './relatorios-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { RelatoriosPage } from './relatorios.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RelatoriosPageRoutingModule,
    SharedModule,
  ],
  declarations: [RelatoriosPage],
})
export class RelatoriosPageModule {}
