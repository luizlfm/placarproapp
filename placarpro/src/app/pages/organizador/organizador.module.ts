import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { OrganizadorPageRoutingModule } from './organizador-routing.module';
import { SharedModule } from '../../shared/shared.module';

import { OrganizadorPage } from './organizador.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    OrganizadorPageRoutingModule,
    SharedModule,
  ],
  declarations: [OrganizadorPage],
})
export class OrganizadorPageModule {}
