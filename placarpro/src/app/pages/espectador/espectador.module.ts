import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { EspectadorPageRoutingModule } from './espectador-routing.module';
import { EspectadorPage } from './espectador.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    EspectadorPageRoutingModule,
  ],
  declarations: [EspectadorPage],
})
export class EspectadorPageModule {}
