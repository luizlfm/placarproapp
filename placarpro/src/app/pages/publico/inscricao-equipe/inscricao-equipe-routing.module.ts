import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { InscricaoEquipePage } from './inscricao-equipe.page';

const routes: Routes = [{ path: '', component: InscricaoEquipePage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class InscricaoEquipePageRoutingModule {}
