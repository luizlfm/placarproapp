import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CampeonatoPage } from './campeonato.page';
import {
  permissaoEditarCampeonatoGuard,
  permissaoGerenciarEquipesGuard,
  permissaoEditarResultadosGuard,
  permissaoEnviarMidiasGuard,
  permissaoGerenciarEnquetesGuard,
} from '../../shared/moderador-permissoes.guard';
import { inicioRedirectGuard } from './inicio/inicio-redirect.guard';

/**
 * Routing do shell do Campeonato.
 *
 * `CampeonatoPage` é o componente WRAPPER que desenha:
 *  - Sidebar lateral em desktop (.camp-aside)
 *  - Header navy + segments em mobile (.camp-mobile-header)
 *  - `<ion-router-outlet>` que renderiza os children
 *
 * TODAS as rotas dentro de `/app/campeonato/:id/**` precisam passar por
 * este wrapper pra herdar o shell. Antes a configuração ficava no
 * shell-routing.module.ts em estrutura flat (sem componente pai) e o
 * CampeonatoPage ficava órfão — sidebar/mobile-header não apareciam.
 */
const routes: Routes = [
  {
    path: '',
    component: CampeonatoPage,
    children: [
      { path: '', redirectTo: 'inicio', pathMatch: 'full' },

      // ============ Páginas diretas do campeonato ============
      {
        path: 'inicio',
        canActivate: [inicioRedirectGuard],
        loadChildren: () =>
          import('./inicio/inicio.module').then(m => m.InicioPageModule),
      },
      {
        path: 'midia',
        canActivate: [permissaoEnviarMidiasGuard],
        loadChildren: () =>
          import('./midia/midia.module').then(m => m.MidiaPageModule),
      },
      {
        path: 'config',
        canActivate: [permissaoEditarCampeonatoGuard],
        loadChildren: () =>
          import('./config/config.module').then(m => m.ConfigPageModule),
      },

      // ============ Categoria — sub-rotas do campeonato ============
      // Mantidas dentro do shell pra herdar a sidebar/mobile-header
      // contextual do campeonato. O usuário continua "dentro" do
      // campeonato visualmente ao navegar pelas categorias.
      {
        path: 'categoria/:catId',
        pathMatch: 'full',
        redirectTo: 'categoria/:catId/inicio',
      },
      {
        path: 'categoria/:catId/inicio',
        loadChildren: () =>
          import('../categoria/inicio/inicio.module').then(m => m.InicioPageModule),
      },
      {
        path: 'categoria/:catId/equipes',
        canActivate: [permissaoGerenciarEquipesGuard],
        loadChildren: () =>
          import('../categoria/equipes/equipes.module').then(m => m.EquipesPageModule),
      },
      {
        path: 'categoria/:catId/jogos',
        canActivate: [permissaoEditarResultadosGuard],
        loadChildren: () =>
          import('../categoria/jogos/jogos.module').then(m => m.JogosPageModule),
      },
      {
        // Jogo-detalhe é acessível em LEITURA pra quem entra em qualquer
        // permissão (inclusive moderador sem editarResultados). Os botões
        // de edição (Encerrar/Iniciar partida, Adicionar lance, Editar
        // escalação, etc) são filtrados internamente por permissão. Assim
        // o "Ver partida" do popover sempre funciona.
        path: 'categoria/:catId/jogo/:jogoId',
        loadChildren: () =>
          import('../categoria/jogo-detalhe/jogo-detalhe.module').then(
            m => m.JogoDetalhePageModule,
          ),
      },
      {
        path: 'categoria/:catId/classificacao',
        loadChildren: () =>
          import('../categoria/classificacao/classificacao.module').then(
            m => m.ClassificacaoPageModule,
          ),
      },
      {
        path: 'categoria/:catId/rankings',
        loadChildren: () =>
          import('../categoria/rankings/rankings.module').then(m => m.RankingsPageModule),
      },
      {
        path: 'categoria/:catId/midia',
        canActivate: [permissaoEnviarMidiasGuard],
        loadChildren: () =>
          import('../categoria/midia/midia.module').then(m => m.MidiaPageModule),
      },
      {
        path: 'categoria/:catId/config',
        canActivate: [permissaoEditarCampeonatoGuard],
        loadChildren: () =>
          import('../categoria/config/config.module').then(m => m.ConfigPageModule),
      },
      {
        path: 'categoria/:catId/relatorios',
        loadChildren: () =>
          import('../categoria/relatorios/relatorios.module').then(
            m => m.RelatoriosPageModule,
          ),
      },
      {
        path: 'categoria/:catId/print/:tipo',
        loadChildren: () =>
          import('../categoria/print/print.module').then(m => m.PrintPageModule),
      },
      {
        // Editor full-page do cabeçalho da Pré-Súmula (WYSIWYG).
        path: 'categoria/:catId/pre-sumula-config',
        loadChildren: () =>
          import('../categoria/pre-sumula-edit/pre-sumula-edit.module').then(
            m => m.PreSumulaEditPageModule,
          ),
      },
      {
        path: 'categoria/:catId/carteirinhas',
        loadChildren: () =>
          import('../categoria/carteirinhas-preview/carteirinhas-preview.module').then(
            m => m.CarteirinhasPreviewPageModule,
          ),
      },
      {
        path: 'categoria/:catId/sumulas',
        loadChildren: () =>
          import('../categoria/sumulas-preview/sumulas-preview.module').then(
            m => m.SumulasPreviewPageModule,
          ),
      },
      {
        // Enquetes/votações — só quem pode gerenciar enquetes pode entrar
        // no editor. Visualização pública continua na tela `/rankings`.
        path: 'categoria/:catId/enquetes',
        canActivate: [permissaoGerenciarEnquetesGuard],
        loadChildren: () =>
          import('../categoria/enquetes/enquetes.module').then(m => m.EnquetesPageModule),
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CampeonatoPageRoutingModule {}
