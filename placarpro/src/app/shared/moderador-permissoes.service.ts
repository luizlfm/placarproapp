import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of, shareReplay, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { CampeonatosService } from '../campeonatos/campeonatos.service';
import {
  Campeonato,
  ModeradorCampeonato,
  ModeradorPermissoesCamp,
} from '../campeonatos/campeonato.model';

/**
 * Nível de acesso do usuário logado em um campeonato específico.
 *
 *  - **dono**: ownerId do campeonato. Pode TUDO.
 *  - **admin-master**: UID está em `environment.adminMasterUids` ou
 *     `usuarios/{uid}.isMaster === true`. Pode TUDO.
 *  - **moderador**: UID está em `campeonato.moderadores[i].id`. Permissões
 *     granulares vindas de `m.permissoes`.
 *  - **nenhum**: usuário não logado ou sem relação com o campeonato. Só
 *     pode ler (telas públicas).
 */
export type NivelAcessoCampeonato = 'dono' | 'admin-master' | 'moderador' | 'nenhum';

/**
 * Permissões efetivas do usuário no campeonato — combina o nível de acesso
 * com as permissões granulares do moderador. Donos e admins ganham TODAS as
 * permissões em true automaticamente.
 */
export interface PermissoesEfetivas {
  nivel: NivelAcessoCampeonato;
  /** Editar config do campeonato (banner, regras, slug), config da
   *  categoria e gerenciar patrocinadores. */
  editarCampeonato: boolean;
  /** Gerenciar equipes, jogadores, equipe técnica e aprovar inscrições. */
  gerenciarEquipes: boolean;
  /** Editar placar, eventos, escalações de jogos. */
  editarResultados: boolean;
  /** Upload/edição de fotos, vídeos, notícias. */
  enviarMidias: boolean;
  /** Criar/editar enquetes e votações. */
  gerenciarEnquetes: boolean;
  /** Categorias específicas que o moderador pode acessar (vazio = todas).
   *  Donos/admins têm acesso a todas independente disso. */
  categoriasPermitidas?: string[];
}

/**
 * Service centralizado pra gerenciar permissões de moderadores.
 *
 * Uso típico:
 * ```ts
 * permissoes.efetivas$(campeonatoId).subscribe(p => {
 *   if (!p.editarCampeonato) this.bloquearForm();
 * });
 * ```
 *
 * Cacheia o stream por campeonatoId via shareReplay pra evitar refetch
 * em cada subscribe.
 */
@Injectable({ providedIn: 'root' })
export class ModeradorPermissoesService {
  private readonly auth = inject(AuthService);
  private readonly usersSrv = inject(UsersService);
  private readonly campSrv = inject(CampeonatosService);

  /** Cache por campeonatoId — evita criar pipeline novo a cada chamada. */
  private readonly cache = new Map<string, Observable<PermissoesEfetivas>>();

  /**
   * Stream das permissões efetivas do usuário logado no campeonato.
   * Combina: auth user + campeonato (ownerId + moderadores) + isMaster.
   */
  efetivas$(campeonatoId: string): Observable<PermissoesEfetivas> {
    if (!campeonatoId) return of(this.semAcesso());

    const cached = this.cache.get(campeonatoId);
    if (cached) return cached;

    const stream = combineLatest([
      this.auth.user$,
      this.campSrv.get$(campeonatoId),
      this.usersSrv.isMaster$(),
    ]).pipe(
      map(([user, camp, isMaster]) => this.calcular(user?.uid, camp, isMaster)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.cache.set(campeonatoId, stream);
    return stream;
  }

  /** Helper: só o booleano `editarCampeonato`. */
  podeEditarCampeonato$(campeonatoId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(map(p => p.editarCampeonato));
  }

  /** Helper: só o booleano `gerenciarEquipes`. */
  podeGerenciarEquipes$(campeonatoId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(map(p => p.gerenciarEquipes));
  }

  /** Helper: só o booleano `editarResultados`. */
  podeEditarResultados$(campeonatoId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(map(p => p.editarResultados));
  }

  /** Helper: só o booleano `enviarMidias`. */
  podeEnviarMidias$(campeonatoId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(map(p => p.enviarMidias));
  }

  /** Helper: só o booleano `gerenciarEnquetes`. */
  podeGerenciarEnquetes$(campeonatoId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(map(p => p.gerenciarEnquetes));
  }

  /** Helper: true pra dono OU admin-master. Usado quando precisamos saber
   *  se o user pode TUDO (ex: deletar campeonato, alterar slug). */
  ehDonoOuAdmin$(campeonatoId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(
      map(p => p.nivel === 'dono' || p.nivel === 'admin-master'),
    );
  }

  /** Helper: true se o user tem acesso à categoria (dono/admin sempre têm). */
  podeAcessarCategoria$(campeonatoId: string, categoriaId: string): Observable<boolean> {
    return this.efetivas$(campeonatoId).pipe(
      map(p => {
        if (p.nivel === 'dono' || p.nivel === 'admin-master') return true;
        if (p.nivel === 'nenhum') return false;
        const cats = p.categoriasPermitidas ?? [];
        return cats.length === 0 || cats.includes(categoriaId);
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  private calcular(
    uid: string | undefined,
    camp: Campeonato | undefined,
    isMaster: boolean,
  ): PermissoesEfetivas {
    if (!uid || !camp) return this.semAcesso();

    if (isMaster) return this.acessoTotal('admin-master');
    if (camp.ownerId === uid) return this.acessoTotal('dono');

    const moderadores: ModeradorCampeonato[] = Array.isArray(camp.moderadores)
      ? camp.moderadores
      : [];
    const meuMod = moderadores.find(m => m?.id === uid);
    if (!meuMod) return this.semAcesso();

    const perms = (meuMod.permissoes ?? {}) as Partial<ModeradorPermissoesCamp>;
    return {
      nivel: 'moderador',
      editarCampeonato: !!perms.editarCampeonato,
      gerenciarEquipes: !!perms.gerenciarEquipes,
      editarResultados: !!perms.editarResultados,
      enviarMidias: !!perms.enviarMidias,
      gerenciarEnquetes: !!perms.gerenciarEnquetes,
      categoriasPermitidas: perms.categoriasPermitidas ?? [],
    };
  }

  private acessoTotal(nivel: NivelAcessoCampeonato): PermissoesEfetivas {
    return {
      nivel,
      editarCampeonato: true,
      gerenciarEquipes: true,
      editarResultados: true,
      enviarMidias: true,
      gerenciarEnquetes: true,
      categoriasPermitidas: [],
    };
  }

  private semAcesso(): PermissoesEfetivas {
    return {
      nivel: 'nenhum',
      editarCampeonato: false,
      gerenciarEquipes: false,
      editarResultados: false,
      enviarMidias: false,
      gerenciarEnquetes: false,
      categoriasPermitidas: [],
    };
  }
}
