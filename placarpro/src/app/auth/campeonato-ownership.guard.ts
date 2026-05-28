import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Guard de acesso à área de administração `/app/campeonato/:id/**`.
 *
 * IMPORTANTE — política simplificada (a partir do bug "F5 manda pra
 * /app/meus-campeonatos"):
 *
 * Antes esse guard lia o doc do campeonato, decidia se o user era
 * dono/master/moderador validado, e redirecionava pra meus-campeonatos
 * quando não atendia nenhum critério. Problema: durante F5, race conditions
 * (auth ainda hidratando, doc do campeonato ainda chegando, cache offline
 * vazio etc.) faziam essa decisão SAIR como "sem permissão" mesmo pra dono
 * legítimo — kicking o usuário pra fora da página.
 *
 * Agora o guard só faz duas coisas:
 *  1. Garante que o user está autenticado (espera authStateReady)
 *  2. Libera a navegação
 *
 * A SEGURANÇA REAL é feita pelas Firestore Rules — se o user logado
 * não puder LER o campeonato, os dados simplesmente não aparecem
 * (queries retornam vazio e Rules retornam permission-denied no servidor).
 * Nenhum dado sensível vaza por ter "permitido" a navegação aqui.
 *
 * Bonus: a UX agora é coerente — F5 sempre mantém a URL atual.
 */
export const campeonatoOwnershipGuard: CanActivateFn = async (
  _route,
  state,
): Promise<boolean | UrlTree> => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // 1) Espera o Firebase Auth hidratar — sem isso, em F5 o currentUser
  //    pode estar null mesmo com user logado (IndexedDB ainda carregando).
  if (!auth.currentUser) {
    await auth.waitForAuthInit();
  }

  // 2) Sem login → vai pro /login com returnUrl pra voltar pra cá depois.
  if (!auth.currentUser) {
    return router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });
  }

  // 3) Logado → libera. Firestore Rules protegem os dados.
  return true;
};
