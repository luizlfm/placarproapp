import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CategoriaPage } from './categoria.page';

const routes: Routes = [
  {
    path: '',
    component: CategoriaPage,
    children: [
      { path: '', redirectTo: 'inicio', pathMatch: 'full' },
      {
        path: 'inicio',
        loadChildren: () => import('./inicio/inicio.module').then(m => m.InicioPageModule),
      },
      {
        path: 'equipes',
        loadChildren: () => import('./equipes/equipes.module').then(m => m.EquipesPageModule),
      },
      {
        path: 'jogos',
        loadChildren: () => import('./jogos/jogos.module').then(m => m.JogosPageModule),
      },
      {
        path: 'jogo/:jogoId',
        loadChildren: () =>
          import('./jogo-detalhe/jogo-detalhe.module').then(m => m.JogoDetalhePageModule),
      },
      {
        path: 'classificacao',
        loadChildren: () =>
          import('./classificacao/classificacao.module').then(m => m.ClassificacaoPageModule),
      },
      {
        path: 'rankings',
        loadChildren: () =>
          import('./rankings/rankings.module').then(m => m.RankingsPageModule),
      },
      {
        path: 'midia',
        loadChildren: () => import('./midia/midia.module').then(m => m.MidiaPageModule),
      },
      {
        path: 'config',
        loadChildren: () => import('./config/config.module').then(m => m.ConfigPageModule),
      },
      {
        path: 'relatorios',
        loadChildren: () =>
          import('./relatorios/relatorios.module').then(m => m.RelatoriosPageModule),
      },
      {
        path: 'inscricoes',
        loadChildren: () =>
          import('./inscricoes/inscricoes.module').then(m => m.InscricoesPageModule),
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CategoriaPageRoutingModule {}
