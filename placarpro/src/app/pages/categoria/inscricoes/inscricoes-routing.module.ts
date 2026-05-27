import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InscricoesPage } from './inscricoes.page';

const routes: Routes = [{ path: '', component: InscricoesPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class InscricoesPageRoutingModule {}
