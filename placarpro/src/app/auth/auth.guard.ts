import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

/** Tipos de conta possíveis (mirror de `TipoConta` do user-profile.model). */
type TipoLogin = 'organizador' | 'cliente' | 'moderador' | 'racha';

/** Lê o tipo de login do localStorage com fallback pra organizador. */
function getTipoLogin(): TipoLogin {
  try {
    const v = localStorage.getItem('placarpro_tipo_login');
    if (v === 'cliente' || v === 'moderador' || v === 'racha' || v === 'organizador') {
      return v;
    }
    return 'organizador';
  } catch {
    return 'organizador';
  }
}

/** Destino padrão por tipo:
 *   - Espectador  → /espectador (painel próprio)
 *   - Racha       → /racha      (área dedicada de peladas)
 *   - Organizador → /app (sem rota — `masterRedirectGuard` decide entre
 *                  /app/admin ou /app/meus-campeonatos)
 *   - Moderador   → /app        (acessa a área admin com permissões limitadas)
 */
function destinoPorTipo(): string {
  const tipo = getTipoLogin();
  if (tipo === 'cliente')   return '/espectador';
  if (tipo === 'racha')     return '/racha';
  return '/app';
}

/**
 * Guard padrão de rotas autenticadas. Bloqueia também ESPECTADORES
 * tentando acessar área admin `/app/*` — eles são redirecionados pra
 * home pública (`/`), que é a "área" deles.
 *
 * Estratégia em camadas para evitar redirect indevido após login OAuth:
 *  1) `auth.currentUser` síncrono — se o Firebase já tem o user na memória,
 *     libera na hora (caminho mais rápido + funciona após signInWithPopup).
 *  2) `waitForAuthInit()` async — aguarda primeira emissão do authState
 *     (necessário pro F5 enquanto o SDK ainda hidrata).
 *  3) Re-checa `currentUser` depois do wait — cobre race condition onde o
 *     login terminou DEPOIS do guard ter sido invocado mas ANTES do
 *     authState emitir o novo user.
 *  4) Se autenticado E for espectador → redireciona pra home pública.
 */
export const authGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Helper: se está logado, decide entre liberar ou bloquear conta não-admin.
  // Espectador → /espectador, Racha → /racha. Organizador e moderador podem
  // entrar normalmente em /app/*.
  const decidirAposLogin = (): boolean | UrlTree => {
    const tipo = getTipoLogin();
    if (tipo === 'cliente') {
      console.warn('[authGuard] espectador tentou acessar área admin', { url: state.url });
      return router.parseUrl('/espectador');
    }
    if (tipo === 'racha') {
      console.warn('[authGuard] racha tentou acessar área admin', { url: state.url });
      return router.parseUrl('/racha');
    }
    return true;
  };

  // 1) Atalho síncrono — usuário já está autenticado em memória.
  if (auth.currentUser) {
    return decidirAposLogin();
  }

  // 2) Espera o Firebase Auth terminar de hidratar (caso F5).
  const user = await auth.waitForAuthInit();
  if (user) {
    return decidirAposLogin();
  }

  // 3) Re-checa síncrono — popup pode ter resolvido depois do waitForAuthInit
  //    mas antes do authState emitir.
  if (auth.currentUser) {
    return decidirAposLogin();
  }

  // ─── Caso especial: rota de TRANSMISSÃO ─────────────────────────────
  // URL admin do tipo `/app/campeonato/:id/categoria/:catId/jogo/:jogoId/transmissao`
  // contém a transmissão ao vivo, que é PÚBLICA por design (qualquer
  // pessoa com o link assiste sem login). Em vez de exigir login (e
  // afastar o espectador), redirecionamos pra versão pública equivalente
  // `/transmissao/:campId/:catId/:jogoId`. Quem fez login (admin)
  // continua na URL admin original; só anônimos caem aqui e são
  // redirecionados pro acesso público.
  const transmissaoMatch = state.url.match(
    /^\/app\/campeonato\/([^/]+)\/categoria\/([^/]+)\/jogo\/([^/]+)\/transmissao(?:\?|$)/,
  );
  if (transmissaoMatch) {
    const [, campId, catId, jogoId] = transmissaoMatch;
    console.info('[authGuard] anônimo na rota admin de transmissão — redirecionando pra versão pública', {
      campId, catId, jogoId,
    });
    return router.createUrlTree(['/transmissao', campId, catId, jogoId]);
  }

  console.warn('[authGuard] sem usuário — redirecionando para login', {
    returnUrl: state.url,
  });
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};

/**
 * Guard específico da área `/racha/*`. Exige login E que o tipo de conta
 * seja `racha`. Outros tipos são redirecionados pro seu destino padrão:
 *   - cliente     → /espectador
 *   - organizador → /app
 *   - moderador   → /app
 *
 * Justificativa: a área `/racha` tem UX e dados próprios (peladas pickup),
 * não faz sentido um organizador profissional acessar. Quem quiser as duas
 * coisas precisa criar duas contas (decisão consciente).
 */
export const rachaGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Não logado → manda pro login com returnUrl pra voltar pra cá
  if (!auth.currentUser) {
    const user = await auth.waitForAuthInit();
    if (!user && !auth.currentUser) {
      return router.createUrlTree(['/login'], {
        queryParams: { returnUrl: state.url },
      });
    }
  }

  const tipo = getTipoLogin();
  if (tipo === 'racha') return true;
  // Logado mas com tipo errado — manda pro destino padrão dele
  console.warn('[rachaGuard] usuário não-racha tentou acessar /racha/*', { tipo });
  return router.parseUrl(destinoPorTipo());
};

/**
 * Inverso do authGuard: bloqueia rotas como /login e /cadastro
 * para usuários já autenticados, mandando direto pro destino padrão
 * do tipo escolhido (organizador → /app, cliente → /espectador, racha → /racha).
 */
export const redirectIfAuthGuard: CanActivateFn = async (route): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  /** Se houver `returnUrl` na query (passado pelo botão "Fazer Login"
   *  de uma página pública), respeita esse destino — assim o usuário já
   *  logado clicando em "Fazer Login" volta pra mesma página em vez de
   *  cair no painel padrão do tipo. */
  const destino = (): string => {
    const returnUrl = route.queryParamMap.get('returnUrl');
    if (returnUrl && returnUrl !== '/login') return returnUrl;
    return destinoPorTipo();
  };

  // Atalho síncrono
  if (auth.currentUser) {
    return router.parseUrl(destino());
  }

  const user = await auth.waitForAuthInit();
  if (!user) {
    return true;
  }

  return router.parseUrl(destino());
};
