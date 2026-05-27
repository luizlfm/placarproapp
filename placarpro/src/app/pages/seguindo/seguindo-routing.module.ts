import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { SeguindoPage } from './seguindo.page';

const routes: Routes = [
  {
    path: '',
    component: SeguindoPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SeguindoPageRoutingModule {}
