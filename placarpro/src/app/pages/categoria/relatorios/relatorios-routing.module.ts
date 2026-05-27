import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RelatoriosPage } from './relatorios.page';

const routes: Routes = [
  { path: '', component: RelatoriosPage },
  {
    path: 'termo-menor',
    loadChildren: () =>
      import('./termo-menor/termo-menor.module').then(m => m.TermoMenorPageModule),
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RelatoriosPageRoutingModule {}
