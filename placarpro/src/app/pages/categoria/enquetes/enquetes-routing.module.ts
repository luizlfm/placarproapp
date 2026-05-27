import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { EnquetesPage } from './enquetes.page';

const routes: Routes = [
  { path: '', component: EnquetesPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class EnquetesPageRoutingModule {}
