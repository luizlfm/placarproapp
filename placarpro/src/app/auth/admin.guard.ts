import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

/**
 * Guard do painel Admin Master (`/app/admin`).
 *
 * Estratégia:
 *  1) Espera o Firebase Auth hidratar (refresh, etc).
 *  2) Se não há usuário → redireciona para /login com returnUrl.
 *  3) Checa SE o UID está hardcoded em `environment.adminMasterUids`.
 *  4) Se NÃO está → redireciona para /app/meus-campeonatos
 *     (não revela existência da rota admin).
 *
 * IMPORTANTE: agora só UIDs hardcoded passam. O campo `isMaster: true` no
 * doc Firestore NÃO basta mais — isso era um vetor que organizadores antigos
 * tinham adquirido via o código de convite `admin-master` (já fechado no
 * signup, mas os docs persistiam). Pra reativar admins promovidos no futuro,
 * adicionar o UID em `environment.adminMasterUids` + redeploy.
 */
export const adminGuard: CanActivateFn = async (_route, state): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const users = inject(UsersService);
  const router = inject(Router);

  // 1) Garante que o Auth hidratou (refresh, etc)
  if (!auth.currentUser) {
    await auth.waitForAuthInit();
  }
  if (!auth.currentUser) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  // 2) Verifica SE é admin master HARDCODED (mais restrito que isMasterAsync)
  try {
    const ok = await users.isHardcodedAdminAsync();
    if (!ok) {
      console.warn('[adminGuard] usuário não é admin master hardcoded', {
        uid: auth.currentUser.uid,
        url: state.url,
      });
      return router.parseUrl('/app/meus-campeonatos');
    }
    return true;
  } catch (err) {
    console.error('[adminGuard] erro verificando admin', err);
    return router.parseUrl('/app/meus-campeonatos');
  }
};
