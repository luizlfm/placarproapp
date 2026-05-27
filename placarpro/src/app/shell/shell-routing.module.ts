import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ShellPage } from './shell.page';
import { adminGuard } from '../auth/admin.guard';
import { campeonatoOwnershipGuard } from '../auth/campeonato-ownership.guard';
import { masterRedirectGuard } from '../auth/master-redirect.guard';
import { inicioRedirectGuard } from '../pages/campeonato/inicio/inicio-redirect.guard';

/**
 * Todas as rotas pós-login são filhas do ShellPage, em ESTRUTURA FLAT
 * (sem outlets aninhados — o Shell tem UM `<ion-router-outlet>` só).
 * As rotas de `campeonato/:id/**` ficam agrupadas sob um pai SEM componente
 * — apenas pra aplicar o `campeonatoOwnershipGuard` em todas de uma vez.
 * Como o pai não tem `component`, o filho herda o outlet do Shell.
 */
const routes: Routes = [
  {
    path: '',
    component: ShellPage,
    children: [
      // Home dinâmica: admin master → /app/admin, comum → /app/meus-campeonatos.
      // Guard retorna sempre UrlTree (redirect), nunca renderiza children.
      {
        path: '',
        pathMatch: 'full',
        canActivate: [masterRedirectGuard],
        children: [],
      },

      // ============== Globais ==============
      {
        path: 'meus-campeonatos',
        // Sem masterRedirectGuard aqui — antes ele bloqueava admin master de
        // acessar essa rota mesmo quando ele clicava no item "Meus campeonatos"
        // do sidebar (forçava sempre voltar pra /app/admin). Agora admin
        // master pode navegar livremente pelo sidebar; o guard fica só na
        // rota raiz /app pra continuar fazendo o landing default correto.
        loadChildren: () =>
          import('../pages/meus-campeonatos/meus-campeonatos.module').then(
            m => m.MeusCampeonatosPageModule,
          ),
      },
      {
        path: 'equipes',
        loadChildren: () =>
          import('../pages/equipes/equipes.module').then(m => m.EquipesPageModule),
      },
      {
        path: 'jogadores',
        loadChildren: () =>
          import('../pages/jogadores/jogadores.module').then(m => m.JogadoresPageModule),
      },
      {
        path: 'organizador',
        loadChildren: () =>
          import('../pages/organizador/organizador.module').then(m => m.OrganizadorPageModule),
      },
      {
        path: 'planos',
        loadChildren: () =>
          import('../pages/planos/planos.module').then(m => m.PlanosPageModule),
      },
      {
        path: 'seguindo',
        loadChildren: () =>
          import('../pages/seguindo/seguindo.module').then(m => m.SeguindoPageModule),
      },
      {
        path: 'arbitragem',
        loadChildren: () =>
          import('../pages/arbitragem/arbitragem.module').then(m => m.ArbitragemPageModule),
      },
      {
        path: 'patrocinadores',
        loadChildren: () =>
          import('../pages/patrocinadores/patrocinadores.module').then(
            m => m.PatrocinadoresPageModule,
          ),
      },
      {
        path: 'locais',
        loadChildren: () =>
          import('../pages/locais/locais.module').then(m => m.LocaisPageModule),
      },
      {
        path: 'formulario',
        loadChildren: () =>
          import('../pages/formulario/formulario.module').then(m => m.FormularioPageModule),
      },
      {
        // Configurações Gerais do Organizador — perfil/conta pessoal
        // (não confundir com `/app/organizador`, que é o perfil público).
        path: 'configuracoes',
        loadChildren: () =>
          import('../pages/configuracoes/configuracoes.module').then(
            m => m.ConfiguracoesPageModule,
          ),
      },

      // ============== Admin Master (protegido por guard) ==============
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadChildren: () =>
          import('../pages/admin/admin.module').then(m => m.AdminPageModule),
      },

      // ============== Campeonato — protegido por ownership guard ==============
      // O guard libera acesso pra:
      //   1. Dono do campeonato
      //   2. Admin master
      // Outros usuários são redirecionados pra /app/meus-campeonatos.
      //
      // ESTRUTURA FLAT (sem componente pai): cada child page carrega seu
      // próprio módulo direto. Tentamos usar CampeonatoPage como wrapper
      // (routing com loadChildren) mas Ionic não lida bem com
      // ion-router-outlet aninhado — as telas travavam. Em vez disso, o
      // layout compartilhado (sidebar desktop + mobile-header) é injetado
      // em cada child page via `<app-campeonato-shell>` (componente shared).
      {
        path: 'campeonato/:id',
        canActivateChild: [campeonatoOwnershipGuard],
        children: [
          { path: '', redirectTo: 'inicio', pathMatch: 'full' },

          {
            path: 'inicio',
            canActivate: [inicioRedirectGuard],
            loadChildren: () =>
              import('../pages/campeonato/inicio/inicio.module').then(m => m.InicioPageModule),
          },
          {
            path: 'midia',
            loadChildren: () =>
              import('../pages/campeonato/midia/midia.module').then(m => m.MidiaPageModule),
          },
          {
            path: 'config',
            loadChildren: () =>
              import('../pages/campeonato/config/config.module').then(m => m.ConfigPageModule),
          },

          // ============== Categoria (sub-rota do campeonato) ==============
          {
            path: 'categoria/:catId',
            pathMatch: 'full',
            redirectTo: 'categoria/:catId/inicio',
          },
          {
            path: 'categoria/:catId/inicio',
            loadChildren: () =>
              import('../pages/categoria/inicio/inicio.module').then(m => m.InicioPageModule),
          },
          {
            path: 'categoria/:catId/equipes',
            loadChildren: () =>
              import('../pages/categoria/equipes/equipes.module').then(m => m.EquipesPageModule),
          },
          {
            path: 'categoria/:catId/jogos',
            loadChildren: () =>
              import('../pages/categoria/jogos/jogos.module').then(m => m.JogosPageModule),
          },
          {
            path: 'categoria/:catId/jogo/:jogoId',
            loadChildren: () =>
              import('../pages/categoria/jogo-detalhe/jogo-detalhe.module').then(
                m => m.JogoDetalhePageModule,
              ),
          },
          {
            path: 'categoria/:catId/jogo/:jogoId/transmissao',
            loadChildren: () =>
              import('../pages/categoria/jogo-detalhe/transmissao/transmissao.module').then(
                m => m.TransmissaoPageModule,
              ),
          },
          {
            path: 'categoria/:catId/classificacao',
            loadChildren: () =>
              import('../pages/categoria/classificacao/classificacao.module').then(
                m => m.ClassificacaoPageModule,
              ),
          },
          {
            path: 'categoria/:catId/rankings',
            loadChildren: () =>
              import('../pages/categoria/rankings/rankings.module').then(m => m.RankingsPageModule),
          },
          {
            path: 'categoria/:catId/midia',
            loadChildren: () =>
              import('../pages/categoria/midia/midia.module').then(m => m.MidiaPageModule),
          },
          {
            path: 'categoria/:catId/config',
            loadChildren: () =>
              import('../pages/categoria/config/config.module').then(m => m.ConfigPageModule),
          },
          {
            path: 'categoria/:catId/relatorios',
            loadChildren: () =>
              import('../pages/categoria/relatorios/relatorios.module').then(
                m => m.RelatoriosPageModule,
              ),
          },
          {
            path: 'categoria/:catId/print/:tipo',
            loadChildren: () =>
              import('../pages/categoria/print/print.module').then(m => m.PrintPageModule),
          },
          {
            // Editor full-page do cabeçalho da Pré-Súmula (WYSIWYG).
            path: 'categoria/:catId/pre-sumula-config',
            loadChildren: () =>
              import('../pages/categoria/pre-sumula-edit/pre-sumula-edit.module').then(
                m => m.PreSumulaEditPageModule,
              ),
          },
          {
            path: 'categoria/:catId/carteirinhas',
            loadChildren: () =>
              import('../pages/categoria/carteirinhas-preview/carteirinhas-preview.module').then(
                m => m.CarteirinhasPreviewPageModule,
              ),
          },
          {
            path: 'categoria/:catId/sumulas',
            loadChildren: () =>
              import('../pages/categoria/sumulas-preview/sumulas-preview.module').then(
                m => m.SumulasPreviewPageModule,
              ),
          },
          {
            path: 'categoria/:catId/enquetes',
            loadChildren: () =>
              import('../pages/categoria/enquetes/enquetes.module').then(m => m.EnquetesPageModule),
          },
        ],
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ShellPageRoutingModule {}
