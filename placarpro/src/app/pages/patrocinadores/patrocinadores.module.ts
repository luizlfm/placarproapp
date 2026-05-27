import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { PatrocinadoresPageRoutingModule } from './patrocinadores-routing.module';
import { PatrocinadoresPage } from './patrocinadores.page';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    PatrocinadoresPageRoutingModule,
    SharedModule,
  ],
  declarations: [PatrocinadoresPage],
})
export class PatrocinadoresPageModule {}
