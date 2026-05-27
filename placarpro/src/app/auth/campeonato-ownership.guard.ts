import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { CampeonatoPermissoesService } from '../campeonatos/campeonato-permissoes.service';

/**
 * Guard de acesso à área de administração `/app/campeonato/:id/**`.
 *
 * Libera acesso pra:
 *   1. Dono do campeonato (`ownerId === uid`)
 *   2. Admin master (flag `isMaster` no user doc)
 *   3. Moderador VALIDADO convidado neste campeonato (UID está em
 *      `campeonato.moderadores[]` ou `categoria.moderadores[]` de
 *      alguma categoria do campeonato, E `moderadorValidado: true`)
 *
 * Quem não atende a nenhum critério é redirecionado pra
 * `/app/meus-campeonatos`. A política é centralizada em
 * `CampeonatoPermissoesService.podeEditar(...)` pra que a mesma regra
 * seja reutilizada em pages que escondem botões de edição.
 *
 * Antes esse guard só aceitava owner+master e bloqueava moderadores
 * convidados. Agora eles também passam — desde que validados.
 */
export const campeonatoOwnershipGuard: CanActivateFn = async (
  route,
  _state,
): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const permsSrv = inject(CampeonatoPermissoesService);
  const router = inject(Router);

  const id = route.paramMap.get('id');
  if (!id) return true;

  // Garante que auth hidratou (authGuard já espera, mas é cheap re-check)
  if (!auth.currentUser) {
    await auth.waitForAuthInit();
  }
  const user = auth.currentUser;
  if (!user) {
    return router.parseUrl('/login');
  }

  try {
    const podeEditar = await permsSrv.podeEditar(id);
    if (podeEditar) return true;

    console.warn('[campeonatoOwnershipGuard] sem permissão', {
      uid: user.uid,
      campeonatoId: id,
    });
    return router.parseUrl('/app/meus-campeonatos');
  } catch (err) {
    console.error('[campeonatoOwnershipGuard] erro lendo permissão', err);
    return router.parseUrl('/app/meus-campeonatos');
  }
};
