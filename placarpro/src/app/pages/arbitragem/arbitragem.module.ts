import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ArbitragemPageRoutingModule } from './arbitragem-routing.module';
import { ArbitragemPage } from './arbitragem.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    ArbitragemPageRoutingModule,
    SharedModule,
  ],
  declarations: [ArbitragemPage],
})
export class ArbitragemPageModule {}
