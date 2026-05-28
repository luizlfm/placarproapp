import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { EspectadorPageRoutingModule } from './espectador-routing.module';
import { EspectadorPage } from './espectador.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    EspectadorPageRoutingModule,
    SharedModule,
  ],
  declarations: [EspectadorPage],
})
export class EspectadorPageModule {}
