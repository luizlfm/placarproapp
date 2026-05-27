import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { RankingsPageRoutingModule } from './rankings-routing.module';

import { RankingsPage } from './rankings.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RankingsPageRoutingModule
  ],
  declarations: [RankingsPage]
})
export class RankingsPageModule {}
