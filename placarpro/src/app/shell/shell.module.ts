import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ShellPageRoutingModule } from './shell-routing.module';

import { ShellPage } from './shell.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ShellPageRoutingModule
  ],
  declarations: [ShellPage]
})
export class ShellPageModule {}
