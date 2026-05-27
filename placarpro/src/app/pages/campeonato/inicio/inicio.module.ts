import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { InicioPageRoutingModule } from './inicio-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { InicioPage } from './inicio.page';
import { NovaCategoriaModalComponent } from './nova-categoria-modal/nova-categoria-modal.component';
import { DuplicarCategoriaModalComponent } from './duplicar-categoria-modal/duplicar-categoria-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    InicioPageRoutingModule,
    SharedModule,
  ],
  declarations: [InicioPage, NovaCategoriaModalComponent, DuplicarCategoriaModalComponent],
})
export class InicioPageModule {}
