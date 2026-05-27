import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MeusRachasPage } from './pages/meus-rachas/meus-rachas.page';
import { CriarRachaPage } from './pages/criar-racha/criar-racha.page';
import { AtivarRachaPage } from './pages/ativar-racha/ativar-racha.page';

const routes: Routes = [
  // /racha → lista dos rachas do usuário
  { path: '', component: MeusRachasPage },
  // /racha/novo → form rápido pra criar
  { path: 'novo', component: CriarRachaPage },
  // /racha/:id/ativar → wizard de 3 passos (legacy — pra rachas em rascunho)
  { path: ':id/ativar', component: AtivarRachaPage },
  // /racha/:id/* → shell completo (sidebar + páginas internas)
  //   Resolve o `:id` no parent e expõe via paramMap pras filhas via
  //   `paramsInheritanceStrategy: 'always'` (definido em app-routing).
  {
    path: ':id',
    loadChildren: () =>
      import('./racha-shell/racha-shell.module').then(m => m.RachaShellModule),
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RachaRoutingModule {}
