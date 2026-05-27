import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CampeonatosService } from './campeonatos.service';
import { CategoriasService } from './categorias.service';
import { UsersService } from '../users/users.service';
import { Campeonato } from './campeonato.model';
import { Categoria, Moderador } from './categoria.model';

/**
 * Resolve QUEM pode editar dados de um campeonato/categoria.
 *
 * Regras (qualquer uma libera):
 *  - É admin master (flag `isMaster` no user doc)
 *  - É dono do campeonato (`ownerId === uid`)
 *  - É moderador convidado e VALIDADO:
 *    - `campeonato.moderadores[].id === uid` (nível campeonato), OU
 *    - `categoria.moderadores[].id === uid` em alguma categoria
 *    - E `user.moderadorValidado === true` (admin master aprovou
 *      ou o user usou código de convite no signup)
 *
 * Centraliza essa lógica num lugar só pra:
 *  - Guards (campeonatoOwnershipGuard) reutilizarem
 *  - Pages esconderem botões de edição quando o user só tem visão
 *  - Firestore Rules espelharem a mesma política (lá não dá pra usar
 *    isso, mas o conceito é o mesmo)
 */
@Injectable({ providedIn: 'root' })
export class CampeonatoPermissoesService {
  private readonly auth = inject(AuthService);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly usersSrv = inject(UsersService);

  /**
   * Stream: true se o user logado pode editar este campeonato.
   * Reage a auth + mudanças no doc do campeonato + perfil do user.
   */
  podeEditar$(campeonatoId: string): Observable<boolean> {
    if (!campeonatoId) return of(false);
    return combineLatest([
      this.auth.user$,
      this.campsSrv.get$(campeonatoId),
      this.usersSrv.profile$(),
      this.catsSrv.list$(campeonatoId),
    ]).pipe(
      map(([user, camp, profile, cats]) => {
        if (!user) return false;
        if (profile?.isMaster) return true;
        if (camp?.ownerId === user.uid) return true;
        return this.uidEhModeradorValidado(user.uid, !!profile?.moderadorValidado, camp, cats);
      }),
    );
  }

  /**
   * Snapshot (assíncrono, uma vez) — útil em guards e ações pontuais
   * onde Observable seria overkill.
   */
  async podeEditar(campeonatoId: string): Promise<boolean> {
    if (!campeonatoId) return false;
    const user = this.auth.currentUser;
    if (!user) {
      await this.auth.waitForAuthInit();
    }
    const u = this.auth.currentUser;
    if (!u) return false;

    // Master? Libera direto.
    try {
      const master = await this.usersSrv.isMasterAsync();
      if (master) return true;
    } catch {
      // segue
    }

    const camp = await this.firstValue(this.campsSrv.get$(campeonatoId));
    if (camp?.ownerId === u.uid) return true;

    const profile = await this.firstValue(this.usersSrv.profile$());
    const validado = !!profile?.moderadorValidado;

    const cats = await this.firstValue(this.catsSrv.list$(campeonatoId));
    return this.uidEhModeradorValidado(u.uid, validado, camp, cats ?? []);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internos
  // ─────────────────────────────────────────────────────────────────────

  /** Verdadeiro quando o UID está no array `moderadores` (do campeonato
   *  OU de alguma categoria) E o user tem flag `moderadorValidado: true`.
   *  Bloqueio: moderador pendente NÃO tem permissão de edição. */
  private uidEhModeradorValidado(
    uid: string,
    moderadorValidado: boolean,
    camp: Campeonato | undefined,
    cats: Categoria[],
  ): boolean {
    if (!moderadorValidado) return false;

    // Nível campeonato
    const modsCamp = camp?.moderadores ?? [];
    if (modsCamp.some(m => m.id === uid)) return true;

    // Nível categoria — checa todas as categorias do campeonato
    for (const c of cats) {
      const mods = c.moderadores;
      if (!mods) continue;
      // O array pode ser legacy (`string[]` com UIDs) ou novo (`Moderador[]`).
      for (const m of mods as Array<string | Moderador>) {
        if (typeof m === 'string') {
          if (m === uid) return true;
        } else {
          if (m.id === uid) return true;
        }
      }
    }
    return false;
  }

  private firstValue<T>(obs: Observable<T>): Promise<T | undefined> {
    return new Promise(resolve => {
      const sub = obs.subscribe({
        next: v => { resolve(v); sub.unsubscribe(); },
        error: () => { resolve(undefined); sub.unsubscribe(); },
        complete: () => resolve(undefined),
      });
    });
  }
}
