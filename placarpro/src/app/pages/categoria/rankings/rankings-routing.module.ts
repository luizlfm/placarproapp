import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { RankingsPage } from './rankings.page';

const routes: Routes = [
  {
    path: '',
    component: RankingsPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RankingsPageRoutingModule {}
