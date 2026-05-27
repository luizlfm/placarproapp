import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';

/**
 * Guard de redirecionamento para campeonatos do tipo "único".
 *
 * O app usa estrutura de rotas FLAT no shell-routing.module.ts:
 *   campeonato/:id  (sem componente)
 *     └── inicio    ← este guard protege esta rota
 *
 * O :id está no paramMap do PARENT direto do snapshot `inicio`,
 * ou seja: route.parent?.paramMap.get('id').
 *
 * Para tipo === 'unico':
 *   - Fast-path: usa campeonato.categoriaPrincipalId (sem query extra)
 *   - Fallback : busca a lista de categorias (campeonatos antigos sem o campo)
 *                e grava categoriaPrincipalId pra próxima vez ser instantâneo
 *
 * Para tipo !== 'unico': libera InicioPage normalmente.
 */
export const inicioRedirectGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const campeonatosSrv = inject(CampeonatosService);
  const categoriasSrv = inject(CategoriasService);
  const router = inject(Router);

  // O :id fica no route pai direto (campeonato/:id sem componente).
  // Tentamos parent primeiro, depois o próprio route como fallback.
  const campeonatoId =
    route.parent?.paramMap.get('id') ??
    route.paramMap.get('id') ??
    '';

  if (!campeonatoId) return true;

  try {
    const campeonato = await firstValueFrom(campeonatosSrv.get$(campeonatoId));

    // Apenas campeonatos tipo 'unico' pulam a tela de seleção de categorias.
    if (campeonato?.tipo !== 'unico') return true;

    // ── Fast-path ────────────────────────────────────────────────────────
    // ID da categoria já denormalizado no documento → navegação instantânea.
    if (campeonato.categoriaPrincipalId) {
      return router.createUrlTree([
        '/app/campeonato', campeonatoId, 'categoria', campeonato.categoriaPrincipalId,
      ]);
    }

    // ── Fallback (campeonatos criados antes desta versão) ─────────────────
    // Busca a única categoria e grava categoriaPrincipalId pra próxima vez
    // ser instantâneo (migração automática, fire-and-forget).
    const cats = await firstValueFrom(categoriasSrv.list$(campeonatoId));
    if (cats.length > 0 && cats[0].id) {
      const catId = cats[0].id;
      campeonatosSrv
        .atualizar(campeonatoId, { categoriaPrincipalId: catId })
        .catch(() => { /* ignora falha de migração */ });
      return router.createUrlTree([
        '/app/campeonato', campeonatoId, 'categoria', catId,
      ]);
    }
  } catch {
    // Falha silenciosa — deixa entrar na InicioPage normalmente.
  }

  return true;
};
