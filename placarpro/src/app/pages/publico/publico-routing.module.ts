import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { PublicoPage } from './publico.page';
import { PublicoCategoriaPage } from './categoria/publico-categoria.page';
import { PublicoEquipePage } from './equipe/publico-equipe.page';

const routes: Routes = [
  { path: '', component: PublicoPage },
  { path: 'categoria/:catId', component: PublicoCategoriaPage },
  { path: 'categoria/:catId/equipe/:equipeId', component: PublicoEquipePage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PublicoPageRoutingModule {}
