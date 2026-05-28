import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Routes } from '@angular/router';
import { IonicModule } from '@ionic/angular';

import { HomePublicaPage } from './home-publica.page';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [{ path: '', component: HomePublicaPage }];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    SharedModule,
  ],
  declarations: [HomePublicaPage],
})
export class HomePublicaPageModule {}
