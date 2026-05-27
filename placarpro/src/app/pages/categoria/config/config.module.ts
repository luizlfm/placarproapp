import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ConfigPageRoutingModule } from './config-routing.module';
import { SharedModule } from '../../../shared/shared.module';
import { ConfigModalsModule } from '../../../shared/config-modals/config-modals.module';

import { ConfigPage } from './config.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    ConfigPageRoutingModule,
    SharedModule,
    ConfigModalsModule,
  ],
  declarations: [ConfigPage],
})
export class ConfigPageModule {}
