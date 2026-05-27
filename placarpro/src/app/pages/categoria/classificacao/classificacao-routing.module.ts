import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { ClassificacaoPage } from './classificacao.page';
import { ImprimirClassificacaoPage } from './imprimir/imprimir-classificacao.page';

const routes: Routes = [
  { path: '', component: ClassificacaoPage },
  { path: 'imprimir', component: ImprimirClassificacaoPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ClassificacaoPageRoutingModule {}
