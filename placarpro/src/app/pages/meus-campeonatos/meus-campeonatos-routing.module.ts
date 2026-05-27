import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { MeusCampeonatosPage } from './meus-campeonatos.page';

const routes: Routes = [
  {
    path: '',
    component: MeusCampeonatosPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class MeusCampeonatosPageRoutingModule {}
