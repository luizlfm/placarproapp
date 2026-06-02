import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of, shareReplay } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { CampeonatosService } from '../campeonatos/campeonatos.service';
import { CategoriasService } from '../campeonatos/categorias.service';
import {
  Campeonato,
  ModeradorCampeonato,
  ModeradorPermissoesCamp,
} from '../campeonatos/campeonato.model';
import { Categoria, Moderador } from '../campeonatos/categoria.model';
import { UserProfile } from '../users/models/user-profile.model';

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
  private readonly catsSrv = inject(CategoriasService);

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
      this.usersSrv.profile$(),
      this.catsSrv.list$(campeonatoId),
    ]).pipe(
      map(([user, camp, profile, cats]) =>
        this.calcular(user?.uid, camp, profile, cats ?? []),
      ),
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
    profile: UserProfile | undefined,
    cats: Categoria[],
  ): PermissoesEfetivas {
    if (!uid || !camp) return this.semAcesso();

    if (profile?.isMaster) return this.acessoTotal('admin-master');
    if (camp.ownerId === uid) return this.acessoTotal('dono');

    // Moderador convidado SÓ tem permissão depois de validado pelo admin
    // master (ou via código de convite no signup). Espelha as Firestore
    // Rules — sem isso a UI mostrava botões de edição que o servidor nega.
    if (!profile?.moderadorValidado) return this.semAcesso();

    // Nível campeonato — permissões granulares completas.
    const moderadores: ModeradorCampeonato[] = Array.isArray(camp.moderadores)
      ? camp.moderadores
      : [];
    const meuModCamp = moderadores.find(m => m?.id === uid);
    if (meuModCamp) {
      const perms = (meuModCamp.permissoes ?? {}) as Partial<ModeradorPermissoesCamp>;
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

    // Nível categoria — o moderador pode estar só em categorias específicas.
    // Agrega as permissões e restringe `categoriasPermitidas` às categorias
    // onde ele realmente aparece.
    return this.calcularPorCategoria(uid, cats);
  }

  /** Resolve permissões quando o UID é moderador apenas em categorias
   *  (não no campeonato). Mescla as permissões de todas as categorias em
   *  que aparece e limita o acesso a essas categorias. */
  private calcularPorCategoria(uid: string, cats: Categoria[]): PermissoesEfetivas {
    const efetivas = this.semAcesso();
    let achou = false;
    const categoriasPermitidas: string[] = [];

    for (const cat of cats) {
      const mods = cat.moderadores;
      if (!mods) continue;

      let meu: Moderador | undefined;
      for (const m of mods as Array<string | Moderador>) {
        if (typeof m === 'string') {
          // Formato legado: array de UIDs = acesso "gerenciar".
          if (m === uid) { meu = { id: uid, nome: '', permissoes: 'gerenciar' }; break; }
        } else if (m?.id === uid) {
          meu = m;
          break;
        }
      }
      if (!meu) continue;

      achou = true;
      if (cat.id) categoriasPermitidas.push(cat.id);

      const pd = meu.permissoesDetalhadas;
      if (pd) {
        // `editarCampeonato` no nível categoria engloba equipes e enquetes.
        if (pd.editarCampeonato) {
          efetivas.editarCampeonato = true;
          efetivas.gerenciarEquipes = true;
          efetivas.gerenciarEnquetes = true;
        }
        if (pd.editarResultados) efetivas.editarResultados = true;
        if (pd.enviarMidias) efetivas.enviarMidias = true;
      } else if (meu.permissoes === 'gerenciar') {
        efetivas.editarCampeonato = true;
        efetivas.gerenciarEquipes = true;
        efetivas.gerenciarEnquetes = true;
        efetivas.editarResultados = true;
        efetivas.enviarMidias = true;
      } else if (meu.permissoes === 'apenas-lances') {
        efetivas.editarResultados = true;
      }
    }

    if (!achou) return this.semAcesso();
    efetivas.nivel = 'moderador';
    efetivas.categoriasPermitidas = categoriasPermitidas;
    return efetivas;
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
