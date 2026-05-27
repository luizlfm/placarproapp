import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ToastController } from '@ionic/angular';
import { ModeradorPermissoesService } from './moderador-permissoes.service';

/**
 * Guards que bloqueiam acesso a rotas administrativas baseado nas
 * permissões do moderador (`editarCampeonato`, `editarResultados`,
 * `enviarMidias`). Donos do campeonato e admins-master sempre passam.
 *
 * Quando o user é redirecionado, mostramos um toast explicando o motivo.
 *
 * Uso no routes:
 * ```ts
 * { path: 'config', canActivate: [permissaoEditarCampeonatoGuard], ... }
 * ```
 */

/**
 * Pega o `id` (campeonatoId) buscando pelos parâmetros de rota — sobe da
 * folha até a raiz porque rotas filhas (`/categoria/.../config`) herdam
 * o `id` do pai (`/campeonato/:id/...`). Sem isso, `paramMap.get('id')`
 * direto da folha não acha o param do pai.
 */
function buscarCampeonatoId(route: import('@angular/router').ActivatedRouteSnapshot): string {
  let r: import('@angular/router').ActivatedRouteSnapshot | null = route;
  while (r) {
    const id = r.paramMap.get('id');
    if (id) return id;
    r = r.parent;
  }
  return '';
}

type PermKey =
  | 'editarCampeonato'
  | 'gerenciarEquipes'
  | 'editarResultados'
  | 'enviarMidias'
  | 'gerenciarEnquetes';

function criarGuard(
  perm: PermKey,
  msgErro: string,
): CanActivateFn {
  return async (route) => {
    const perms = inject(ModeradorPermissoesService);
    const router = inject(Router);
    const toastCtrl = inject(ToastController);

    const campeonatoId = buscarCampeonatoId(route);
    if (!campeonatoId) return router.parseUrl('/app/meus-campeonatos');

    const efetivas = await firstValueFrom(perms.efetivas$(campeonatoId));
    if (efetivas[perm]) return true;

    // Sem permissão → toast + redireciona pra Início do campeonato (que
    // sempre é acessível) ou meus-campeonatos se nem aquilo pode ler.
    try {
      const t = await toastCtrl.create({
        message: msgErro,
        duration: 3000,
        position: 'top',
        color: 'warning',
      });
      await t.present();
    } catch { /* silent */ }

    return router.parseUrl(`/app/campeonato/${campeonatoId}/inicio`);
  };
}

export const permissaoEditarCampeonatoGuard = criarGuard(
  'editarCampeonato',
  'Você não tem permissão pra editar dados do campeonato.',
);

export const permissaoGerenciarEquipesGuard = criarGuard(
  'gerenciarEquipes',
  'Você não tem permissão pra gerenciar equipes/jogadores.',
);

export const permissaoEditarResultadosGuard = criarGuard(
  'editarResultados',
  'Você não tem permissão pra editar resultados.',
);

export const permissaoEnviarMidiasGuard = criarGuard(
  'enviarMidias',
  'Você não tem permissão pra enviar fotos/vídeos/notícias.',
);

export const permissaoGerenciarEnquetesGuard = criarGuard(
  'gerenciarEnquetes',
  'Você não tem permissão pra gerenciar enquetes.',
);
