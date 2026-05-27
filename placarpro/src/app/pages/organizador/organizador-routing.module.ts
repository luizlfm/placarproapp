import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { OrganizadorPage } from './organizador.page';

const routes: Routes = [
  {
    path: '',
    component: OrganizadorPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OrganizadorPageRoutingModule {}
