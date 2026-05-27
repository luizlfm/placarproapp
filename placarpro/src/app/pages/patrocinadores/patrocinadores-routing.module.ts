import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PatrocinadoresPage } from './patrocinadores.page';

const routes: Routes = [
  {
    path: '',
    component: PatrocinadoresPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PatrocinadoresPageRoutingModule {}
