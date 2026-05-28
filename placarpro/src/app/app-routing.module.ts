import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard, rachaGuard, redirectIfAuthGuard } from './auth/auth.guard';

const routes: Routes = [
  // Landing pública (lista campeonatos públicos + opções de entrar/cadastrar)
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () =>
      import('./pages/home-publica/home-publica.module').then(m => m.HomePublicaPageModule),
  },

  // Rotas públicas (bloqueadas se já estiver logado)
  {
    path: 'login',
    canActivate: [redirectIfAuthGuard],
    loadChildren: () => import('./pages/login/login.module').then(m => m.LoginPageModule),
  },
  {
    path: 'cadastro',
    canActivate: [redirectIfAuthGuard],
    loadChildren: () => import('./pages/signup/signup.module').then(m => m.SignupPageModule),
  },
  {
    path: 'recuperar-senha',
    canActivate: [redirectIfAuthGuard],
    loadChildren: () =>
      import('./pages/reset-password/reset-password.module').then(m => m.ResetPasswordPageModule),
  },

  // Área autenticada — Shell com sidebar + outlet interno
  {
    path: 'app',
    canActivate: [authGuard],
    loadChildren: () => import('./shell/shell.module').then(m => m.ShellPageModule),
  },

  // Página pública do ORGANIZADOR (estilo copafacil.com/{slug}): perfil
  // + grid de campeonatos públicos dele. Não exige login.
  {
    path: 'org/:slug',
    loadChildren: () =>
      import('./pages/publico-organizador/publico-organizador.module').then(
        m => m.PublicoOrganizadorPageModule,
      ),
  },

  // Página pública de um campeonato — link compartilhável: /p/:slug (alias antigo)
  {
    path: 'p/:slug',
    loadChildren: () =>
      import('./pages/publico/publico.module').then(m => m.PublicoPageModule),
  },

  // Link público de inscrição de equipe — admin gera o token e envia
  // para o dono da equipe preencher os jogadores. Login é necessário
  // no momento de confirmar (não aqui).
  {
    path: 'inscricao/:token',
    loadChildren: () =>
      import('./pages/publico/inscricao-equipe/inscricao-equipe.module').then(
        m => m.InscricaoEquipePageModule,
      ),
  },

  // Transmissão PÚBLICA de um jogo — qualquer pessoa pode acompanhar
  // (sem login) o player do YouTube + placar overlay + feed de eventos
  // em tempo real. URL compartilhável.
  // Reusa o mesmo TransmissaoPageModule do shell (a página é read-only).
  {
    path: 'transmissao/:id/:catId/:jogoId',
    loadChildren: () =>
      import('./pages/categoria/jogo-detalhe/transmissao/transmissao.module').then(
        m => m.TransmissaoPageModule,
      ),
  },

  // Link mágico de aceite de moderador (`/m/:token`).
  // Gerado pelo modal "Moderadores" do organizador. Não exige código
  // de convite — o próprio token na URL é o segredo. Quando o user
  // clica, vincula o UID dele ao moderador e abre a área admin do campeonato.
  {
    path: 'm/:token',
    loadChildren: () =>
      import('./pages/aceitar-convite-moderador/aceitar-convite-moderador.module').then(
        m => m.AceitarConviteModeradorPageModule,
      ),
  },

  // Painel do espectador — lista de convites vinculados ao UID logado.
  // Requer autenticação (página redireciona pra /login internamente se não logado).
  {
    path: 'espectador',
    loadChildren: () =>
      import('./pages/espectador/espectador.module').then(
        m => m.EspectadorPageModule,
      ),
  },

  // Tela de pagamento de uma cobrança específica. Aberta após o usuário
  // clicar "Gerar cobrança" no /app/planos. Mostra opções PIX/Boleto/Cartão.
  {
    path: 'pagamento/:cobrancaId',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./pages/pagamento/pagamento.module').then(
        m => m.PagamentoPageModule,
      ),
  },

  // Área Racha (peladas/pickup games) — paralela ao /espectador.
  // Acessível somente por contas tipo `racha`. Outros tipos são
  // redirecionados pro seu destino padrão pelo `rachaGuard`.
  {
    path: 'racha',
    canActivate: [rachaGuard],
    loadChildren: () =>
      import('./racha/racha.module').then(m => m.RachaModule),
  },

  // Compat
  { path: 'home', redirectTo: 'app/meus-campeonatos' },

  // URL pública curta estilo copafacil: placarproapp.com/<slug>
  // IMPORTANTE: precisa ficar ANTES do wildcard '**' e DEPOIS de todas as
  // rotas conhecidas (login, cadastro, app, etc.) — caso contrário esse
  // matcher capturaria todas as URLs.
  {
    path: ':slug',
    loadChildren: () =>
      import('./pages/publico/publico.module').then(m => m.PublicoPageModule),
  },

  // Fallback (segurança)
  { path: '**', redirectTo: 'app/meus-campeonatos' },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: PreloadAllModules,
      // Permite que rotas filhas (lazy modules) leiam params do parent
      // via this.route.snapshot.paramMap, sem precisar de this.route.parent.
      paramsInheritanceStrategy: 'always',
    }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}
