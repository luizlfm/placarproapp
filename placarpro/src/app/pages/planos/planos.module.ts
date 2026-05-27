import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PlanosPageRoutingModule } from './planos-routing.module';

import { PlanosPage } from './planos.page';
import { EscolherPeriodicidadeModalComponent } from './escolher-periodicidade-modal/escolher-periodicidade-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PlanosPageRoutingModule,
  ],
  declarations: [
    PlanosPage,
    EscolherPeriodicidadeModalComponent,
  ],
})
export class PlanosPageModule {}
