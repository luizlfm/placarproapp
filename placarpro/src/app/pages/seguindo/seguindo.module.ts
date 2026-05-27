import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { SeguindoPageRoutingModule } from './seguindo-routing.module';

import { SeguindoPage } from './seguindo.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SeguindoPageRoutingModule
  ],
  declarations: [SeguindoPage]
})
export class SeguindoPageModule {}
