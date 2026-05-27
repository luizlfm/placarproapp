import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docData,
  getDoc,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, of, switchMap, map } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { TipoConta, UserProfile } from './models/user-profile.model';
import { Local } from './models/local.model';
import { Arbitro } from './models/arbitro.model';
import { Patrocinador } from './models/patrocinador.model';
import { environment } from '../../environments/environment';

/**
 * Cuida de tudo que vive sob `users/{uid}`:
 * - Perfil do organizador (doc raiz)
 * - Locais de jogo (subcoleção)
 * - Árbitros (subcoleção)
 * - Patrocinadores (subcoleção)
 */
@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private get uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  // ============ Profile ============

  profile$(): Observable<UserProfile | undefined> {
    return this.auth.user$.pipe(
      switchMap(u => {
        if (!u) return of(undefined);
        return runInInjectionContext(this.injector, () =>
          docData(doc(this.fs, 'users', u.uid)) as Observable<UserProfile | undefined>,
        );
      }),
    );
  }

  async saveProfile(patch: Partial<UserProfile>): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      setDoc(
        doc(this.fs, 'users', uid),
        {
          uid,
          ...patch,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      ),
    );
  }

  /**
   * Valida se o código de convite informado autoriza o cadastro como
   * o `tipo` informado (organizador ou moderador). Comparação:
   *  - case-insensitive
   *  - trim nos espaços
   *  - lista vem de `environment.organizadorInviteCodes` (para organizador)
   *    ou `environment.moderadorInviteCodes` (para moderador)
   *
   * Para `tipo === 'cliente'` (espectador), sempre retorna true — espectador
   * não precisa de código de convite.
   *
   * Códigos são REUTILIZÁVEIS (não há "consumo") — qualquer pessoa com
   * o código vale. Pra invalidar um código, basta removê-lo da lista
   * no `environment.ts` e fazer redeploy.
   *
   * Retorna `true` se o código está na lista, `false` caso contrário
   * (inclusive quando `codigo` é vazio ou só com espaços, para os tipos
   * que exigem código).
   */
  validarCodigoConvite(codigo: string, tipo: TipoConta = 'organizador'): boolean {
    // Cliente (espectador) e Racha (organizador de pelada) — cadastro livre,
    // sem código de convite. O 'racha' não exige código porque o público
    // alvo é diferente do organizador profissional: rachas são informais.
    if (tipo === 'cliente' || tipo === 'racha') return true;
    const c = (codigo ?? '').trim().toLowerCase();
    if (!c) return false;
    const validos = tipo === 'moderador'
      ? (environment.moderadorInviteCodes ?? [])
      : (environment.organizadorInviteCodes ?? []);
    return validos.some(v => v.trim().toLowerCase() === c);
  }

  /**
   * Garante consistência entre o `tipo` selecionado na UI e o `tipo`
   * persistido em `users/{uid}.tipo`. Cobre 3 cenários:
   *
   *  1) **Doc inexistente** (conta NOVA — primeiro login OAuth):
   *     cria o doc com `tipo: tipoEsperado`. → `ok: true`.
   *
   *  2) **Doc existente sem campo `tipo`** (LEGACY — usuário cadastrado
   *     antes do conceito de espectador existir):
   *     atribui `tipo: 'organizador'` (legacy só tinha organizadores).
   *     Se o usuário tentou logar como ESPECTADOR mas é organizador
   *     legacy → `ok: false` com `tipoReal: 'organizador'`.
   *
   *  3) **Doc existente com `tipo` definido**:
   *     compara. Se diferente → `ok: false` (caller deve fazer signOut
   *     e mostrar mensagem amigável).
   *
   * Importante: NÃO sobrescreve o `tipo` se já existir — isso evitaria
   * que um espectador "vire" organizador acidentalmente (ou vice-versa)
   * só por clicar no card errado.
   */
  async ensureTipo(
    uid: string,
    tipoEsperado: TipoConta,
    opts: { forceCliente?: boolean } = {},
  ): Promise<{ ok: boolean; tipoReal: TipoConta }> {
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'users', uid);
      const snap = await getDoc(ref);

      // OAuth no /login (Google/Apple) com conta NOVA: sempre cria como
      // 'cliente'. Pra virar organizador, o usuário precisa passar pelo
      // fluxo de cadastro (/signup) e informar código de convite válido.
      // Isso evita que qualquer um vire organizador só clicando no card.
      const tipoCriacao: TipoConta = opts.forceCliente ? 'cliente' : tipoEsperado;

      if (!snap.exists()) {
        await setDoc(
          ref,
          {
            uid,
            tipo: tipoCriacao,
            criadoEm: serverTimestamp() as unknown as Timestamp,
            atualizadoEm: serverTimestamp() as unknown as Timestamp,
          },
          { merge: true },
        );
        console.log('[ensureTipo] doc novo criado com tipo:', tipoCriacao,
          opts.forceCliente ? '(forçado a cliente — OAuth login)' : '');
        const ok = tipoCriacao === tipoEsperado;
        return { ok, tipoReal: tipoCriacao };
      }

      const data = snap.data() as UserProfile;
      if (!data.tipo) {
        // Legacy doc (sem tipo). Se forceCliente está ligado (login OAuth),
        // assume cliente. Caso contrário, respeita a escolha do usuário.
        const tipoMigrado: TipoConta = opts.forceCliente ? 'cliente' : tipoEsperado;
        await setDoc(ref, { tipo: tipoMigrado }, { merge: true });
        console.log('[ensureTipo] doc legacy migrado pra tipo:', tipoMigrado);
        const ok = tipoMigrado === tipoEsperado;
        return { ok, tipoReal: tipoMigrado };
      }

      const ok = data.tipo === tipoEsperado;
      console.log(
        '[ensureTipo] check uid=%s tipoEsperado=%s tipoReal=%s ok=%s',
        uid, tipoEsperado, data.tipo, ok,
      );
      return { ok, tipoReal: data.tipo };
    });
  }

  // ============ Admin Master ============

  /** Checa se um UID está na lista hardcoded de super-admins do
   *  environment.ts. Garante acesso mesmo sem doc no Firestore. */
  private isHardcodedAdmin(uid: string | null | undefined): boolean {
    if (!uid) return false;
    const lista = environment.adminMasterUids ?? [];
    return lista.includes(uid);
  }

  /** True APENAS quando o UID logado está na lista hardcoded
   *  `environment.adminMasterUids`. Stream reativo (reage a login/logout). */
  isHardcodedAdmin$(): Observable<boolean> {
    return this.auth.user$.pipe(
      map(u => !!u && this.isHardcodedAdmin(u.uid)),
    );
  }

  /** Versão síncrona/Promise do isHardcodedAdmin$ — usada pelos guards.
   *  NÃO consulta Firestore; depende só do UID do auth e da lista hardcoded. */
  async isHardcodedAdminAsync(): Promise<boolean> {
    return this.isHardcodedAdmin(this.uid);
  }

  /** True quando o usuário logado é admin master.
   *  Verifica DUAS fontes (OR):
   *   - UID na lista hardcoded `environment.adminMasterUids` (root permanente)
   *   - Campo `isMaster: true` no doc `users/{uid}` (admins promovidos)
   *  Stream reativo — atualiza se o doc for editado no Firestore Console.
   *
   *  IMPORTANTE: pra controlar VISIBILIDADE do item "Painel Admin" no menu
   *  lateral, use `isHardcodedAdmin$()` em vez deste — esse aqui ainda libera
   *  organizadores antigos que foram promovidos via signup com o código
   *  `admin-master` (vetor já fechado, mas docs antigos persistem). */
  isMaster$(): Observable<boolean> {
    return this.auth.user$.pipe(
      switchMap(u => {
        if (!u) return of(false);
        // Hardcoded UID → sempre admin (atalho, não precisa ler doc)
        if (this.isHardcodedAdmin(u.uid)) return of(true);
        return this.profile$().pipe(map(p => !!p?.isMaster));
      }),
    );
  }

  /** Snapshot síncrono usado pelo adminGuard antes de renderizar a página. */
  async isMasterAsync(): Promise<boolean> {
    const uid = this.uid;
    if (!uid) return false;
    // Hardcoded UID → sempre admin (root permanente, sem precisar de Firestore)
    if (this.isHardcodedAdmin(uid)) return true;
    return runInInjectionContext(this.injector, async () => {
      try {
        const snap = await getDoc(doc(this.fs, 'users', uid));
        if (!snap.exists()) return false;
        const data = snap.data() as UserProfile;
        return !!data.isMaster;
      } catch (err) {
        console.warn('[isMasterAsync] falha ao ler perfil', err);
        return false;
      }
    });
  }

  /** Altera o plano de QUALQUER usuário do sistema.
   *  Reservado pro admin master. As Firestore Rules devem garantir
   *  que apenas admins consigam escrever em `users/{outro_uid}`. */
  async updateUserPlano(uid: string, plano: UserProfile['plano']): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    await runInInjectionContext(this.injector, () =>
      setDoc(
        doc(this.fs, 'users', uid),
        {
          plano,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      ),
    );
  }

  /**
   * Adiciona (ou remove, se delta negativo) transmissões avulsas ao usuário.
   * Chama `increment(delta)` do Firestore — thread-safe, sem race condition.
   * Reservado ao admin master (rules exigem isMaster).
   */
  async updateTransmissoesExtras(uid: string, delta: number): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    await runInInjectionContext(this.injector, () =>
      setDoc(
        doc(this.fs, 'users', uid),
        {
          transmissoesExtras: increment(delta),
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      ),
    );
  }

  /** Toggle de `isMaster` em outro usuário — apenas admin master pode. */
  async toggleUserIsMaster(uid: string, isMaster: boolean): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    await runInInjectionContext(this.injector, () =>
      setDoc(
        doc(this.fs, 'users', uid),
        {
          isMaster,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      ),
    );
  }

  /**
   * BLOQUEAR conta — bloqueio "soft" reversível. O AuthGuard checa
   * `bloqueado` no login e bloqueia o acesso à área autenticada. Não
   * apaga nada — só impede entrada.
   *
   * Diferente de banir: bloqueio costuma ser temporário (revisar
   * comportamento, suspender plano vencido, etc).
   */
  async setBloqueado(uid: string, bloqueado: boolean): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    const adminUid = this.auth.currentUser?.uid;
    await runInInjectionContext(this.injector, () =>
      setDoc(
        doc(this.fs, 'users', uid),
        {
          bloqueado,
          bloqueadoEm: bloqueado ? (serverTimestamp() as unknown as Timestamp) : null,
          bloqueadoPor: bloqueado ? (adminUid ?? null) : null,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      ),
    );
  }

  /**
   * BANIR conta — punição com razão registrada. Mais severo que bloqueio:
   * fica como histórico permanente. O `motivo` é exibido ao user na tela
   * de login bloqueada (UI futura).
   *
   * Para desbanir, passe `banido=false` (mantém o motivo no histórico).
   */
  async setBanido(uid: string, banido: boolean, motivo?: string): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    const adminUid = this.auth.currentUser?.uid;
    const patch: Record<string, unknown> = {
      banido,
      atualizadoEm: serverTimestamp(),
    };
    if (banido) {
      // Só grava o motivo/timestamp/autor no momento da punição. Manter
      // o motivo antigo ao desbanir é OK (histórico).
      patch['banidoMotivo'] = motivo ?? '';
      patch['banidoEm'] = serverTimestamp();
      patch['banidoPor'] = adminUid ?? null;
    }
    await runInInjectionContext(this.injector, () =>
      setDoc(doc(this.fs, 'users', uid), patch, { merge: true }),
    );
  }

  /**
   * VALIDA moderador — admin master "ativa" uma conta moderador pendente.
   * O signup permite criar conta moderador sem código (fica pendente);
   * depois o admin valida via painel `/app/admin → Detalhes do usuário`.
   *
   * Grava `moderadorValidado: true` + timestamp + uid de quem validou.
   * Pra revogar, passa `validado=false`.
   */
  async setModeradorValidado(uid: string, validado: boolean): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    const adminUid = this.auth.currentUser?.uid;
    const patch: Record<string, unknown> = {
      moderadorValidado: validado,
      atualizadoEm: serverTimestamp(),
    };
    if (validado) {
      patch['moderadorValidadoEm'] = serverTimestamp();
      patch['moderadorValidadoPor'] = adminUid ?? null;
    }
    await runInInjectionContext(this.injector, () =>
      setDoc(doc(this.fs, 'users', uid), patch, { merge: true }),
    );
  }

  /**
   * Atualiza dados básicos de outro usuário — usado pelo admin master no
   * modal de detalhes. Diferente de `saveProfile()`, que opera no doc do
   * usuário logado. Aqui o `uid` alvo é explícito.
   */
  async adminAtualizarUser(uid: string, patch: Partial<UserProfile>): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    // Limpa undefineds — Firestore rejeita.
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) limpo[k] = v;
    }
    limpo['atualizadoEm'] = serverTimestamp();
    await runInInjectionContext(this.injector, () =>
      setDoc(doc(this.fs, 'users', uid), limpo, { merge: true }),
    );
  }

  /** Lista TODOS os usuários do sistema. Reservado pro painel admin.
   *  Ordenado por nome (case-insensitive client-side). */
  listAllUsers$(): Observable<UserProfile[]> {
    return runInInjectionContext(this.injector, () => {
      const col = collection(this.fs, 'users') as CollectionReference<UserProfile>;
      return (collectionData(col, { idField: 'uid' }) as Observable<UserProfile[]>).pipe(
        map(list => [...list].sort((a, b) =>
          (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
        )),
      );
    });
  }

  // ============ Locais ============

  locais$(): Observable<Local[]> {
    return this.auth.user$.pipe(
      switchMap(u =>
        u
          ? runInInjectionContext(this.injector, () => {
              const col = collection(this.fs, 'users', u.uid, 'locais') as CollectionReference<Local>;
              return collectionData(query(col, orderBy('nome')), { idField: 'id' }) as Observable<Local[]>;
            })
          : of([] as Local[]),
      ),
    );
  }

  async criarLocal(data: Omit<Local, 'id' | 'ownerId' | 'criadoEm'>): Promise<string> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    return runInInjectionContext(this.injector, async () => {
      const col = collection(this.fs, 'users', uid, 'locais') as CollectionReference<Local>;
      const ref = await addDoc(col, {
        ...data,
        ownerId: uid,
        criadoEm: serverTimestamp() as unknown as Timestamp,
      });
      return ref.id;
    });
  }

  async atualizarLocal(id: string, patch: Partial<Local>): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      updateDoc(doc(this.fs, 'users', uid, 'locais', id) as DocumentReference<Local>, patch),
    );
  }

  async removerLocal(id: string): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      deleteDoc(doc(this.fs, 'users', uid, 'locais', id)),
    );
  }

  // ============ Árbitros ============

  arbitros$(): Observable<Arbitro[]> {
    return this.auth.user$.pipe(
      switchMap(u =>
        u
          ? runInInjectionContext(this.injector, () => {
              const col = collection(this.fs, 'users', u.uid, 'arbitros') as CollectionReference<Arbitro>;
              return collectionData(query(col, orderBy('nome')), { idField: 'id' }) as Observable<Arbitro[]>;
            })
          : of([] as Arbitro[]),
      ),
    );
  }

  async criarArbitro(data: Omit<Arbitro, 'id' | 'ownerId' | 'criadoEm'>): Promise<string> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    return runInInjectionContext(this.injector, async () => {
      const col = collection(this.fs, 'users', uid, 'arbitros') as CollectionReference<Arbitro>;
      const ref = await addDoc(col, {
        ...data,
        ownerId: uid,
        criadoEm: serverTimestamp() as unknown as Timestamp,
      });
      return ref.id;
    });
  }

  async atualizarArbitro(id: string, patch: Partial<Arbitro>): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      updateDoc(doc(this.fs, 'users', uid, 'arbitros', id) as DocumentReference<Arbitro>, patch),
    );
  }

  async removerArbitro(id: string): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      deleteDoc(doc(this.fs, 'users', uid, 'arbitros', id)),
    );
  }

  // ============ Patrocinadores ============

  patrocinadores$(): Observable<Patrocinador[]> {
    return this.auth.user$.pipe(
      switchMap(u =>
        u
          ? runInInjectionContext(this.injector, () => {
              const col = collection(this.fs, 'users', u.uid, 'patrocinadores') as CollectionReference<Patrocinador>;
              return collectionData(query(col, orderBy('nome')), { idField: 'id' }) as Observable<Patrocinador[]>;
            })
          : of([] as Patrocinador[]),
      ),
    );
  }

  /**
   * Lê o doc de perfil de um UID específico (sem precisar estar logado
   * como esse user). Usado em telas que precisam de dados públicos do
   * dono do campeonato (banner do app, logo, cor primária).
   * As Firestore Rules limitam quais campos vazam — leitura completa só
   * pro próprio user ou admin master.
   */
  profilePorUid$(uid: string): Observable<UserProfile | undefined> {
    if (!uid) return of(undefined);
    return runInInjectionContext(this.injector, () =>
      docData(doc(this.fs, 'users', uid)) as Observable<UserProfile | undefined>,
    );
  }

  /**
   * Lista os patrocinadores de um dono específico (`ownerId` = uid).
   * Usado nas páginas PÚBLICAS pra exibir patrocinadores do organizador
   * do campeonato. Requer regra Firestore que permita read em
   * `users/{ownerId}/patrocinadores` (ver `firestore.rules`).
   */
  patrocinadoresDoOwner$(ownerId: string): Observable<Patrocinador[]> {
    if (!ownerId) return of<Patrocinador[]>([]);
    return runInInjectionContext(this.injector, () => {
      const col = collection(this.fs, 'users', ownerId, 'patrocinadores') as CollectionReference<Patrocinador>;
      return collectionData(query(col, orderBy('nome')), { idField: 'id' }) as Observable<Patrocinador[]>;
    });
  }

  async criarPatrocinador(data: Omit<Patrocinador, 'id' | 'ownerId' | 'criadoEm'>): Promise<string> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    return runInInjectionContext(this.injector, async () => {
      const col = collection(this.fs, 'users', uid, 'patrocinadores') as CollectionReference<Patrocinador>;
      const ref = await addDoc(col, {
        ...data,
        ownerId: uid,
        criadoEm: serverTimestamp() as unknown as Timestamp,
      });
      return ref.id;
    });
  }

  async atualizarPatrocinador(id: string, patch: Partial<Patrocinador>): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      updateDoc(doc(this.fs, 'users', uid, 'patrocinadores', id) as DocumentReference<Patrocinador>, patch),
    );
  }

  async removerPatrocinador(id: string): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, () =>
      deleteDoc(doc(this.fs, 'users', uid, 'patrocinadores', id)),
    );
  }

  // ============ Seguindo ============

  /** IDs dos campeonatos que o usuário segue (subcoleção `users/{uid}/seguindo/{campId}`). */
  seguindoIds$(): Observable<string[]> {
    return this.auth.user$.pipe(
      switchMap(u => {
        if (!u) return of<string[]>([]);
        return runInInjectionContext(this.injector, () => {
          const col = collection(this.fs, 'users', u.uid, 'seguindo');
          const items$ = collectionData(query(col, orderBy('criadoEm', 'desc')), { idField: 'id' }) as Observable<{ id: string }[]>;
          return items$.pipe(map(arr => arr.map(a => a.id)));
        });
      }),
    );
  }

  /** Verifica se o usuário segue um campeonato específico. */
  segue$(campeonatoId: string): Observable<boolean> {
    return this.auth.user$.pipe(
      switchMap(u => {
        if (!u) return of(false);
        return runInInjectionContext(this.injector, () => {
          const r = doc(this.fs, 'users', u.uid, 'seguindo', campeonatoId);
          return (docData(r) as Observable<unknown>).pipe(map(d => !!d));
        });
      }),
    );
  }

  async seguir(campeonatoId: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, async () => {
      // 1) PRIMÁRIO — sempre funciona: doc é dele.
      await setDoc(
        doc(this.fs, 'users', user.uid, 'seguindo', campeonatoId),
        { criadoEm: serverTimestamp() },
        { merge: true },
      );

      // 2) ESPELHO — pode falhar se as Firestore Rules ainda não tiverem sido publicadas.
      //    Não bloqueia o seguir: catch silencioso (admin pode rodar Sincronizar).
      try {
        await setDoc(
          doc(this.fs, 'campeonatos', campeonatoId, 'seguidores', user.uid),
          {
            uid: user.uid,
            nome: user.displayName || user.email?.split('@')[0] || 'Usuário',
            ...(user.email ? { email: user.email } : {}),
            ...(user.photoURL ? { fotoUrl: user.photoURL } : {}),
            seguindoDesde: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (err) {
        console.warn(
          '[UsersService] Espelho seguidores falhou (verifique firestore.rules). Seguir mesmo assim.',
          err,
        );
      }
    });
  }

  async deixarDeSeguir(campeonatoId: string): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('Não autenticado');
    await runInInjectionContext(this.injector, async () => {
      // PRIMÁRIO
      await deleteDoc(doc(this.fs, 'users', uid, 'seguindo', campeonatoId));
      // ESPELHO — silencia falha
      try {
        await deleteDoc(doc(this.fs, 'campeonatos', campeonatoId, 'seguidores', uid));
      } catch (err) {
        console.warn('[UsersService] Espelho seguidores delete falhou.', err);
      }
    });
  }
}
