import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';

import { TransmissaoPage } from './transmissao.page';
// SharedModule traz o `app-transmissao-player` + `TransmissaoModalComponent`
// que são usados pela transmissao.page quando há LiveKit ativo.
import { SharedModule } from '../../../../shared/shared.module';

const routes: Routes = [{ path: '', component: TransmissaoPage }];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    SharedModule,
  ],
  declarations: [TransmissaoPage],
})
export class TransmissaoPageModule {}
