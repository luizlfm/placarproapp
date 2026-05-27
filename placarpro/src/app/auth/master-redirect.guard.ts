import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

/**
 * Guard de redirecionamento de LANDING (rota raiz).
 *
 * Aplicado APENAS em `path: ''` (rota raiz `/app`) — decide qual é a
 * "home" do usuário recém-logado/recém-aberto.
 *
 * Comportamento:
 *  - Admin master (UID hardcoded) → redireciona pra `/app/admin`.
 *  - Usuário comum logado          → redireciona pra `/app/meus-campeonatos`.
 *  - Não logado                    → manda pra `/app/meus-campeonatos`
 *    (outros guards cuidam de empurrar pro /login se preciso).
 *
 * NOTA: antes esse guard também ficava em `/app/meus-campeonatos`, mas isso
 * impedia admin master de NAVEGAR pra essa página via sidebar — toda vez que
 * clicava em "Meus campeonatos" caía de volta em `/app/admin`. Removido daqui
 * pra que admin master possa transitar livremente pelo app.
 */
export const masterRedirectGuard: CanActivateFn = async (
  _route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const users = inject(UsersService);
  const router = inject(Router);

  // 1) Garante que o Auth hidratou (refresh, etc).
  if (!auth.currentUser) {
    await auth.waitForAuthInit();
  }

  // 2) Sem login → manda pra rota padrão (outro guard fará /login).
  if (!auth.currentUser) {
    return router.parseUrl('/app/meus-campeonatos');
  }

  // 3) Checa se é admin master HARDCODED (mais restrito que isMasterAsync).
  //    Antes usávamos isMasterAsync (que considera o campo no doc), mas isso
  //    mandava organizadores antigos promovidos via `admin-master` pro painel.
  //    Agora só UIDs hardcoded em environment.adminMasterUids são redirecionados.
  let isMaster = false;
  try {
    isMaster = await users.isHardcodedAdminAsync();
  } catch {
    // Falha lendo perfil → assume não-master (fail-closed pra segurança).
  }

  // 4) Master → sempre cai no painel admin.
  if (isMaster) {
    return router.parseUrl('/app/admin');
  }

  // 5) Não-master na rota raiz `/app` → manda pra meus campeonatos (padrão).
  //    Pra meus-campeonatos (`/app/meus-campeonatos`) → libera passagem.
  const url = state.url.split('?')[0]; // ignora query string
  if (url === '/app' || url === '/app/') {
    return router.parseUrl('/app/meus-campeonatos');
  }
  return true;
};
