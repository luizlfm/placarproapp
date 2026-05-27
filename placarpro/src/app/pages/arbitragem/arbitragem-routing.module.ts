import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ArbitragemPage } from './arbitragem.page';

const routes: Routes = [
  {
    path: '',
    component: ArbitragemPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ArbitragemPageRoutingModule {}
