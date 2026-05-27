import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { JogosPage } from './jogos.page';
import { ImprimirJogosPage } from './imprimir/imprimir-jogos.page';

const routes: Routes = [
  { path: '', component: JogosPage },
  { path: 'imprimir', component: ImprimirJogosPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class JogosPageRoutingModule {}
