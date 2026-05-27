import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { MidiaPageRoutingModule } from './midia-routing.module';
import { MidiaPage } from './midia.page';
import { MidiaSharedModule } from '../../../shared/midia/midia-shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    MidiaPageRoutingModule,
    MidiaSharedModule,
  ],
  declarations: [MidiaPage],
})
export class MidiaPageModule {}
