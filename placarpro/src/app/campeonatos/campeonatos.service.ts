import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  collectionData,
  collectionGroup,
  deleteDoc,
  doc,
  docData,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of, switchMap } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AuthService } from '../auth/auth.service';
import { Campeonato, NovoCampeonatoInput } from './campeonato.model';

/**
 * CRUD da coleção `campeonatos`. Lista filtra por ownerId === auth.uid.
 * Todas as chamadas Firestore passam por runInInjectionContext para
 * manter o change detection do Angular saudável.
 */
@Injectable({ providedIn: 'root' })
export class CampeonatosService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private get col(): CollectionReference<Campeonato> {
    return collection(this.fs, 'campeonatos') as CollectionReference<Campeonato>;
  }

  private docRef(id: string): DocumentReference<Campeonato> {
    return doc(this.fs, 'campeonatos', id) as DocumentReference<Campeonato>;
  }

  /** Stream dos campeonatos do usuário logado, mais recentes primeiro.
   *
   * IMPORTANTE: não usa `orderBy('criadoEm')` na query Firestore porque
   * documentos legacy (criados antes do campo existir) seriam EXCLUÍDOS
   * silenciosamente. A ordenação por data é feita client-side depois,
   * com documentos sem `criadoEm` indo pro final da lista. */
  listMeus$(): Observable<Campeonato[]> {
    return this.auth.user$.pipe(
      switchMap(user => {
        if (!user) {
          return of([] as Campeonato[]);
        }
        return runInInjectionContext(this.injector, () => {
          return (collectionData(
            query(this.col, where('ownerId', '==', user.uid)),
            { idField: 'id' },
          ) as Observable<Campeonato[]>).pipe(
            map(arr => arr.slice().sort((a, b) => {
              const ta = (a.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
              const tb = (b.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
              return tb - ta;
            })),
          );
        });
      }),
    );
  }

  /** Versão one-shot de `listOndeSouModerador$()` — usada no fluxo de
   *  login pra decidir o redirect (não precisa de subscription contínua).
   *  Retorna lista vazia se não houver usuário logado. */
  async listOndeSouModeradorOnce(uid: string): Promise<Campeonato[]> {
    if (!uid) return [];
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDocs(
        query(this.col, where('moderadorUids', 'array-contains', uid)),
      );
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as Campeonato);
    });
  }

  /**
   * Campeonatos onde o usuário logado é moderador. Estratégia híbrida:
   *
   *  1. CAMINHO RÁPIDO: query em `campeonatos` com `moderadorUids
   *     array-contains uid` — funciona quando o campo está denormalizado.
   *
   *  2. FALLBACK + AUTO-SYNC: se a query rápida vier vazia, faz scan
   *     via `collectionGroup('categorias')` procurando pelo UID dentro
   *     do array `moderadores` (que tem objetos `{ id, nome, email }`),
   *     extrai os campeonatoIds únicos, carrega os campeonatos e em
   *     paralelo tenta gravar o UID em `campeonato.moderadorUids`
   *     (best-effort — silencia se as rules bloquearem o write).
   *
   * Usado em "Meus campeonatos" pra moderadores verem os campeonatos
   * que ajudam a gerenciar, mesmo quando a denormalização não rodou.
   */
  listOndeSouModerador$(): Observable<Campeonato[]> {
    return this.auth.user$.pipe(
      switchMap(user => {
        if (!user) return of([] as Campeonato[]);
        const uid = user.uid;
        const email = user.email ?? null;
        return runInInjectionContext(this.injector, () => {
          // 1) Query rápida via campo denormalizado
          const rapida$ = collectionData(
            query(this.col, where('moderadorUids', 'array-contains', uid)),
            { idField: 'id' },
          ) as Observable<Campeonato[]>;

          // 2) Fallback: combina convitesModerador (uid + email) +
          //    collectionGroup das categorias. Só dispara se a query
          //    rápida vier vazia — economiza reads.
          return rapida$.pipe(
            switchMap(rapidos => {
              if (rapidos.length > 0) return of(rapidos);
              return this.descobrirCampeonatosOndeMod(uid, email);
            }),
          );
        });
      }),
    );
  }

  /**
   * Coleta diagnóstico completo do "porquê" um moderador vê (ou não vê)
   * campeonatos. Útil pra debug em produção — retorna info detalhada
   * de cada estratégia sem alterar nada no Firestore.
   */
  async diagnosticarAcessoModerador(uid: string, email?: string | null): Promise<{
    uid: string;
    email: string | null;
    rapida: { ok: boolean; count: number; erro?: string };
    convites: { ok: boolean; count: number; ids: string[]; erro?: string };
    convitesPorEmail: { ok: boolean; count: number; ids: string[]; erro?: string };
    categorias: { ok: boolean; totalLidas: number; matches: number; ids: string[]; erro?: string };
    campeonatosCarregaveis: { id: string; ok: boolean; titulo?: string; erro?: string }[];
  }> {
    const result = {
      uid,
      email: email ?? null,
      rapida: { ok: false, count: 0, erro: undefined as string | undefined },
      convites: { ok: false, count: 0, ids: [] as string[], erro: undefined as string | undefined },
      convitesPorEmail: { ok: false, count: 0, ids: [] as string[], erro: undefined as string | undefined },
      categorias: { ok: false, totalLidas: 0, matches: 0, ids: [] as string[], erro: undefined as string | undefined },
      campeonatosCarregaveis: [] as { id: string; ok: boolean; titulo?: string; erro?: string }[],
    };

    // A) Query rápida via moderadorUids denormalizado
    try {
      const snap = await runInInjectionContext(this.injector, () =>
        getDocs(query(this.col, where('moderadorUids', 'array-contains', uid))),
      );
      result.rapida.ok = true;
      result.rapida.count = snap.size;
    } catch (e) {
      result.rapida.erro = String(e);
    }

    // B) convitesModerador aceitoPorUid
    const todosIds = new Set<string>();
    try {
      const snap = await runInInjectionContext(this.injector, () =>
        getDocs(query(
          collection(this.fs, 'convitesModerador'),
          where('aceitoPorUid', '==', uid),
        )),
      );
      result.convites.ok = true;
      result.convites.count = snap.size;
      snap.forEach(d => {
        const data = d.data() as { campeonatoId?: string };
        if (data.campeonatoId) {
          result.convites.ids.push(data.campeonatoId);
          todosIds.add(data.campeonatoId);
        }
      });
    } catch (e) {
      result.convites.erro = String(e);
    }

    // C) convitesModerador por email (caso CF não tenha gravado aceitoPorUid)
    if (email) {
      try {
        const snap = await runInInjectionContext(this.injector, () =>
          getDocs(query(
            collection(this.fs, 'convitesModerador'),
            where('email', '==', email),
          )),
        );
        result.convitesPorEmail.ok = true;
        result.convitesPorEmail.count = snap.size;
        snap.forEach(d => {
          const data = d.data() as { campeonatoId?: string };
          if (data.campeonatoId) {
            result.convitesPorEmail.ids.push(data.campeonatoId);
            todosIds.add(data.campeonatoId);
          }
        });
      } catch (e) {
        result.convitesPorEmail.erro = String(e);
      }
    }

    // D) Scan categorias
    try {
      const snap = await runInInjectionContext(this.injector, () =>
        getDocs(collectionGroup(this.fs, 'categorias')),
      );
      result.categorias.ok = true;
      result.categorias.totalLidas = snap.size;
      snap.forEach(d => {
        const data = d.data() as { moderadores?: Array<{ id?: string; email?: string } | string> };
        const mods = data.moderadores;
        if (!Array.isArray(mods)) return;
        const acha = mods.some(m =>
          typeof m === 'object' && m !== null && (
            (m as { id?: string }).id === uid ||
            (email && (m as { email?: string }).email === email)
          ),
        );
        if (acha) {
          result.categorias.matches++;
          const campRef = d.ref.parent.parent;
          if (campRef && !result.categorias.ids.includes(campRef.id)) {
            result.categorias.ids.push(campRef.id);
            todosIds.add(campRef.id);
          }
        }
      });
    } catch (e) {
      result.categorias.erro = String(e);
    }

    // E) Tenta carregar cada campeonato
    for (const cId of todosIds) {
      try {
        const ds = await runInInjectionContext(this.injector, () => getDoc(this.docRef(cId)));
        if (!ds.exists()) {
          result.campeonatosCarregaveis.push({ id: cId, ok: false, erro: 'doc não existe' });
        } else {
          const data = ds.data() as Campeonato;
          result.campeonatosCarregaveis.push({ id: cId, ok: true, titulo: data.titulo });
        }
      } catch (e) {
        result.campeonatosCarregaveis.push({ id: cId, ok: false, erro: String(e) });
      }
    }

    return result;
  }

  /**
   * Fallback de descoberta de campeonatos onde o user é moderador.
   *
   * Tenta DUAS estratégias em paralelo (sem bloquear):
   *  A) `convitesModerador where aceitoPorUid == uid` — funciona sempre
   *     porque a coleção é publicamente legível. Dá os IDs dos campeonatos
   *     onde o user aceitou convite.
   *  B) `collectionGroup('categorias')` filtrando client-side por
   *     `moderadores[*].id == uid` — pega casos onde o organizador
   *     adicionou direto (sem convite formal). Só funciona pra
   *     campeonatos públicos ou onde rules permitirem.
   *
   * Une os campeonatoIds, carrega cada um best-effort, e dispara
   * denormalização opcional de `moderadorUids` (silencia se Rules
   * bloquearem o write — é só uma otimização pras próximas cargas).
   */
  private descobrirCampeonatosOndeMod(uid: string, email?: string | null): Observable<Campeonato[]> {
    return new Observable<Campeonato[]>(subscriber => {
      (async () => {
        const ids = new Set<string>();

        // Estratégia A: convitesModerador aceitoPorUid (sempre legível)
        try {
          const snapA = await runInInjectionContext(this.injector, () =>
            getDocs(query(
              collection(this.fs, 'convitesModerador'),
              where('aceitoPorUid', '==', uid),
            )),
          );
          snapA.forEach(d => {
            const data = d.data() as { campeonatoId?: string };
            if (data.campeonatoId) ids.add(data.campeonatoId);
          });
          console.info(`[CampeonatosSrv] convitesModerador aceitoPorUid: ${snapA.size}`);
        } catch (err) {
          console.warn('[CampeonatosSrv] busca convitesModerador por UID falhou:', err);
        }

        // Estratégia A2: convitesModerador por EMAIL (caso CF não tenha
        // gravado aceitoPorUid, ou user nunca aceitou via link mas o
        // organizador já cadastrou pelo email)
        if (email) {
          try {
            const snapEmail = await runInInjectionContext(this.injector, () =>
              getDocs(query(
                collection(this.fs, 'convitesModerador'),
                where('email', '==', email),
              )),
            );
            snapEmail.forEach(d => {
              const data = d.data() as { campeonatoId?: string };
              if (data.campeonatoId) ids.add(data.campeonatoId);
            });
            console.info(`[CampeonatosSrv] convitesModerador por email: ${snapEmail.size}`);
          } catch (err) {
            console.warn('[CampeonatosSrv] busca convitesModerador por email falhou:', err);
          }
        }

        // Estratégia B: scan categorias (best-effort, pode falhar por Rules).
        // Aceita match por UID ou por email no objeto moderador.
        try {
          const snapB = await runInInjectionContext(this.injector, () =>
            getDocs(collectionGroup(this.fs, 'categorias')),
          );
          let achados = 0;
          snapB.forEach(d => {
            const data = d.data() as { moderadores?: Array<{ id?: string; email?: string } | string> };
            const mods = data.moderadores;
            if (!Array.isArray(mods)) return;
            const acha = mods.some(m => {
              if (typeof m !== 'object' || m === null) return false;
              const obj = m as { id?: string; email?: string };
              return obj.id === uid || (email != null && obj.email === email);
            });
            if (acha) {
              achados++;
              const campRef = d.ref.parent.parent;
              if (campRef) ids.add(campRef.id);
            }
          });
          console.info(`[CampeonatosSrv] categorias scan: ${snapB.size} lidas, ${achados} com o user como moderador`);
        } catch (err) {
          console.warn('[CampeonatosSrv] scan de categorias falhou (provavelmente Rules):', err);
        }

        console.info(`[CampeonatosSrv] descobrir → ${ids.size} campeonato(s) únicos`);

        if (ids.size === 0) {
          subscriber.next([]);
          subscriber.complete();
          return;
        }

        // Carrega cada campeonato individualmente (best-effort)
        const docs = await Promise.all(
          Array.from(ids).map(async cId => {
            try {
              const ds = await runInInjectionContext(this.injector, () =>
                getDoc(this.docRef(cId)),
              );
              if (!ds.exists()) {
                console.warn(`[CampeonatosSrv] campeonato ${cId} não existe`);
                return null;
              }
              return { id: cId, ...ds.data() } as Campeonato;
            } catch (err) {
              console.warn(`[CampeonatosSrv] não consegue ler campeonato ${cId}:`, err);
              return null;
            }
          }),
        );
        const validos = docs.filter((c): c is Campeonato => !!c);
        console.info(`[CampeonatosSrv] carregados: ${validos.length}/${ids.size}`);
        subscriber.next(validos);

        // Best-effort: denormaliza moderadorUids pra próxima carga
        // cair no caminho rápido. Silencia erros de permissão.
        for (const camp of validos) {
          if (!camp.id) continue;
          try {
            await runInInjectionContext(this.injector, () =>
              updateDoc(this.docRef(camp.id!), { moderadorUids: arrayUnion(uid) }),
            );
          } catch {
            /* Rules bloqueiam — ok, segue sem denormalizar */
          }
        }
        subscriber.complete();
      })();
    });
  }

  /** União de `listMeus$()` + `listOndeSouModerador$()` sem duplicatas.
   *  Útil pra telas como "Meus campeonatos" que devem mostrar tanto os
   *  campeonatos do dono quanto os que ele modera. */
  listMeusEModerados$(): Observable<Campeonato[]> {
    return combineLatest([
      this.listMeus$().pipe(catchError(err => {
        console.warn('[CampeonatosSrv] listMeus$ erro:', err);
        return of([] as Campeonato[]);
      })),
      this.listOndeSouModerador$().pipe(catchError(err => {
        console.warn('[CampeonatosSrv] listOndeSouModerador$ erro:', err);
        return of([] as Campeonato[]);
      })),
    ]).pipe(
      map(([meus, modero]) => {
        const map = new Map<string, Campeonato>();
        for (const c of meus) if (c.id) map.set(c.id, c);
        for (const c of modero) if (c.id && !map.has(c.id)) map.set(c.id, c);
        return Array.from(map.values()).sort((a, b) => {
          const ta = (a.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          const tb = (b.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          return tb - ta;
        });
      }),
    );
  }

  /** Observa um campeonato específico. */
  get$(id: string): Observable<Campeonato | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(id), { idField: 'id' }) as Observable<Campeonato | undefined>,
    );
  }

  /** Cria um novo campeonato do usuário logado. */
  async criar(input: NovoCampeonatoInput): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('Usuário não autenticado.');
    }
    return runInInjectionContext(this.injector, async () => {
      const shortCode = await this.gerarShortCodeUnico();
      const payload: Campeonato = {
        publico: true,
        ...input,
        ownerId: user.uid,
        seguidores: 0,
        shortCode,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col, payload);
      return ref.id;
    });
  }

  /**
   * Gera um shortcode aleatório alfanumérico de 5 chars (sem 0/1/l/o pra evitar ambiguidade)
   * e garante via query que não colide com outro campeonato.
   */
  private async gerarShortCodeUnico(): Promise<string> {
    const alfabeto = 'abcdefghijkmnpqrstuvwxyz23456789';
    const gerar = () => {
      let s = '';
      for (let i = 0; i < 5; i++) {
        s += alfabeto[Math.floor(Math.random() * alfabeto.length)];
      }
      return s;
    };
    return runInInjectionContext(this.injector, async () => {
      for (let tentativa = 0; tentativa < 8; tentativa++) {
        const code = gerar();
        const existente = await getDocs(
          query(this.col, where('shortCode', '==', code), limit(1)),
        );
        if (existente.empty) return code;
      }
      // Após 8 tentativas, anexa timestamp pra forçar unicidade
      return gerar() + Date.now().toString(36).slice(-3);
    });
  }

  /**
   * Duplica um campeonato — cria um novo doc copiando metadata + (opcional)
   * estrutura (categorias / equipes / jogadores / partidas).
   *
   * Sempre copia:
   *   - logoUrl + logoMobileUrl + capaUrl + capaMobileUrl + bannerUrl (legacy)
   *   - flag `publico` do campeonato pai
   *   - tipo do campeonato (sobrescrito por options.tipo)
   *
   * Opcionalmente copia (controlado por `options`):
   *   - seguidores: array de UIDs que segue o campeonato
   *   - estrutura de categorias (sempre criada como esqueleto pra equipes/jogos fazerem sentido)
   *   - equipes (logo, nome, etc.) por categoria
   *   - jogadores por equipe (depende de copiarEquipes)
   *   - partidas (sem placar/status — resetados pra 'agendado') (depende de copiarEquipes)
   *
   * Estratégia: queries diretas via getDocs nas subcoleções, batch writes.
   * Pode demorar alguns segundos pra campeonatos grandes (centenas de equipes).
   *
   * Permissões: chamador precisa ser dono do campeonato original (rules
   * checam ownerId no read). O novo doc fica com ownerId = auth.currentUser.uid.
   */
  async duplicar(
    originalId: string,
    options: {
      titulo: string;
      subtitulo?: string;
      tipo: 'unico' | 'com-categorias';
      manterSeguidores?: boolean;
      copiarEquipes?: boolean;
      copiarJogadores?: boolean;
      copiarPartidas?: boolean;
    },
  ): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');

    return runInInjectionContext(this.injector, async () => {
      // 1) Carrega o doc original pra clonar campos cosméticos (logo/banner).
      const origSnap = await getDoc(this.docRef(originalId));
      if (!origSnap.exists()) throw new Error('Campeonato original não encontrado.');
      const orig = origSnap.data() as Campeonato;

      // 2) Cria o novo campeonato com metadata copiada + overrides do form.
      const shortCode = await this.gerarShortCodeUnico();
      const novoPayload: Campeonato = {
        publico: orig.publico ?? true,
        titulo: options.titulo,
        ...(options.subtitulo ? { subtitulo: options.subtitulo } : {}),
        tipo: options.tipo,
        ownerId: user.uid,
        // Cosméticos copiados do original — logo + capa (web + mobile) + banner legado.
        ...(orig.logoUrl       ? { logoUrl:       orig.logoUrl       } : {}),
        ...(orig.logoMobileUrl ? { logoMobileUrl: orig.logoMobileUrl } : {}),
        ...(orig.capaUrl       ? { capaUrl:       orig.capaUrl       } : {}),
        ...(orig.capaMobileUrl ? { capaMobileUrl: orig.capaMobileUrl } : {}),
        ...(orig.bannerUrl     ? { bannerUrl:     orig.bannerUrl     } : {}),
        // Seguidores: copia array de UIDs se pediu (recria a relação na coleção
        // `seguidores` via field arrayUnion separado — TODO em versão futura)
        seguidores: options.manterSeguidores ? (orig.seguidores ?? 0) : 0,
        shortCode,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const novoRef = await addDoc(this.col, novoPayload);
      const novoId = novoRef.id;

      // 3) Copia ESTRUTURA (categorias + filhos) se solicitado. Mesmo se o
      //    user não pediu copiar equipes/jogos, ainda copiamos as CATEGORIAS
      //    porque é a backbone — sem isso o novo campeonato fica vazio.
      const catsSnap = await getDocs(
        collection(this.fs, 'campeonatos', originalId, 'categorias'),
      );

      for (const catDoc of catsSnap.docs) {
        const catData = catDoc.data() as Record<string, unknown>;
        const novaCatRef = await addDoc(
          collection(this.fs, 'campeonatos', novoId, 'categorias'),
          {
            ...catData,
            criadoEm: serverTimestamp() as unknown as Timestamp,
            atualizadoEm: serverTimestamp() as unknown as Timestamp,
          },
        );

        // 3a) Equipes (e mapping de IDs antigo → novo pra remapear partidas)
        const mapEquipes = new Map<string, string>();
        if (options.copiarEquipes) {
          const equipesSnap = await getDocs(
            collection(this.fs, 'campeonatos', originalId, 'categorias', catDoc.id, 'equipes'),
          );
          for (const eqDoc of equipesSnap.docs) {
            const eqData = eqDoc.data() as Record<string, unknown>;
            const novaEqRef = await addDoc(
              collection(this.fs, 'campeonatos', novoId, 'categorias', novaCatRef.id, 'equipes'),
              {
                ...eqData,
                criadoEm: serverTimestamp() as unknown as Timestamp,
                atualizadoEm: serverTimestamp() as unknown as Timestamp,
              },
            );
            mapEquipes.set(eqDoc.id, novaEqRef.id);
          }
        }

        // 3b) Jogadores (vinculados à equipe via equipeId — remapeia)
        if (options.copiarEquipes && options.copiarJogadores) {
          const jogSnap = await getDocs(
            collection(this.fs, 'campeonatos', originalId, 'categorias', catDoc.id, 'jogadores'),
          );
          for (const jDoc of jogSnap.docs) {
            const jData = jDoc.data() as Record<string, unknown>;
            const eqOrig = jData['equipeId'] as string | undefined;
            const eqNovo = eqOrig ? mapEquipes.get(eqOrig) : undefined;
            // Skipa jogadores cuja equipe não foi copiada (deveria ser raro)
            if (eqOrig && !eqNovo) continue;
            await addDoc(
              collection(this.fs, 'campeonatos', novoId, 'categorias', novaCatRef.id, 'jogadores'),
              {
                ...jData,
                ...(eqNovo ? { equipeId: eqNovo } : {}),
                criadoEm: serverTimestamp() as unknown as Timestamp,
                atualizadoEm: serverTimestamp() as unknown as Timestamp,
              },
            );
          }
        }

        // 3c) Partidas (placar/status zerados — mantém só confronto + meta)
        if (options.copiarEquipes && options.copiarPartidas) {
          const jogosSnap = await getDocs(
            collection(this.fs, 'campeonatos', originalId, 'categorias', catDoc.id, 'jogos'),
          );
          for (const jDoc of jogosSnap.docs) {
            const j = jDoc.data() as Record<string, unknown>;
            const mandanteOrig = j['mandanteId'] as string | undefined;
            const visitanteOrig = j['visitanteId'] as string | undefined;
            const mandanteNovo = mandanteOrig ? mapEquipes.get(mandanteOrig) : undefined;
            const visitanteNovo = visitanteOrig ? mapEquipes.get(visitanteOrig) : undefined;
            if (!mandanteNovo || !visitanteNovo) continue;

            await addDoc(
              collection(this.fs, 'campeonatos', novoId, 'categorias', novaCatRef.id, 'jogos'),
              {
                // Confronto + meta original
                mandanteId: mandanteNovo,
                visitanteId: visitanteNovo,
                fase: j['fase'] ?? null,
                rodada: j['rodada'] ?? null,
                grupoId: j['grupoId'] ?? null,
                dataHora: j['dataHora'] ?? null,
                local: j['local'] ?? null,
                // Estado RESETADO — nova edição, partidas começam zeradas
                status: 'agendado',
                golsMandante: null,
                golsVisitante: null,
                penaltisMandante: null,
                penaltisVisitante: null,
                campeonatoId: novoId,
                categoriaId: novaCatRef.id,
                criadoEm: serverTimestamp() as unknown as Timestamp,
                atualizadoEm: serverTimestamp() as unknown as Timestamp,
              },
            );
          }
        }
      }

      return novoId;
    });
  }

  /** Atualiza campos parciais. */
  async atualizar(id: string, patch: Partial<Campeonato>): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(id), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  /** Remove o campeonato. */
  async remover(id: string): Promise<void> {
    await runInInjectionContext(this.injector, () => deleteDoc(this.docRef(id)));
  }

  /**
   * Resolve um campeonato a partir de um identificador da URL pública.
   * Tenta várias formas pra ser amigável:
   *   1) slug exato
   *   2) slug lowercase (pra URLs digitadas)
   *   3) shortCode exato + lowercase
   *   4) ID direto (fallback final)
   */
  async getBySlug(slug: string): Promise<Campeonato | undefined> {
    if (!slug) return undefined;
    const candidatos = [slug, slug.toLowerCase(), slug.trim().replace(/[^A-Za-z0-9_-]/g, '')];
    const unicos = Array.from(new Set(candidatos.filter(Boolean)));

    return runInInjectionContext(this.injector, async () => {
      // IMPORTANTE: Esse método é chamado da página pública (anônimo).
      // Toda query inclui `publico == true` pra satisfazer as Firestore Rules
      // (rules de list só passam se a query GARANTE o filtro).
      // Pro caso de admin/owner ver seu próprio privado, primeiro tentamos
      // com o filtro publico, e se vier vazio tentamos sem (vai dar erro
      // se anônimo — `catch` retorna undefined silenciosamente).

      // 1) Busca por slug + publico
      for (const cand of unicos) {
        try {
          const snap = await getDocs(
            query(this.col, where('publico', '==', true), where('slug', '==', cand), limit(1)),
          );
          if (!snap.empty) {
            const d = snap.docs[0];
            return { id: d.id, ...d.data() } as Campeonato;
          }
        } catch (err) {
          console.warn('[getBySlug] slug+publico falhou', err);
        }
      }

      // 2) Busca por shortCode + publico
      for (const cand of unicos) {
        try {
          const snap = await getDocs(
            query(this.col, where('publico', '==', true), where('shortCode', '==', cand), limit(1)),
          );
          if (!snap.empty) {
            const d = snap.docs[0];
            return { id: d.id, ...d.data() } as Campeonato;
          }
        } catch (err) {
          console.warn('[getBySlug] shortCode+publico falhou', err);
        }
      }

      // 3) Tentar como ID direto (rule de `get` deixa passar se o doc é público OU o user é dono)
      try {
        const direto = await getDoc(this.docRef(slug));
        if (direto.exists()) {
          return { id: direto.id, ...direto.data() } as Campeonato;
        }
      } catch { /* ignore */ }

      // 4) Fallback (autenticado/dono pode buscar privado pelo slug)
      for (const cand of unicos) {
        try {
          const snap = await getDocs(
            query(this.col, where('slug', '==', cand), limit(1)),
          );
          if (!snap.empty) {
            const d = snap.docs[0];
            return { id: d.id, ...d.data() } as Campeonato;
          }
        } catch { /* sem auth: ignora */ }
      }

      return undefined;
    });
  }

  // ============== Slug helpers ==============

  /**
   * Converte um texto livre em slug URL-safe.
   *
   *  "5ª Copa Regional Sport+ 2026!" → "5-copa-regional-sport-2026"
   *
   * Regras:
   *  - lowercase
   *  - remove acentos (NFD + strip diacritics)
   *  - tudo que não for [a-z0-9] vira hífen
   *  - colapsa hífens duplicados
   *  - remove hífens das pontas
   */
  slugify(texto: string): string {
    return (texto ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // remove acentos
      .replace(/[^a-z0-9]+/g, '-')        // não-alfanumérico vira hífen
      .replace(/-{2,}/g, '-')             // colapsa hífens
      .replace(/^-+|-+$/g, '');           // trim hífens das pontas
  }

  /**
   * Gera um slug ÚNICO a partir de um texto base. Se o slug "interclubes"
   * já está em uso por outro campeonato, tenta "interclubes-2",
   * "interclubes-3"... até achar disponível.
   *
   * @param base Texto fonte (geralmente o título do campeonato)
   * @param ignorarId UID do doc que deve ser ignorado na checagem de
   *                  duplicata (útil ao editar — o próprio campeonato
   *                  não deve "colidir consigo mesmo").
   *
   * Limita a 100 tentativas — depois disso usa timestamp como sufixo
   * (extremamente improvável de chegar lá, mas evita loop infinito se
   * Firestore ficar inconsistente).
   */
  async gerarSlugUnico(base: string, ignorarId?: string): Promise<string> {
    const slugBase = this.slugify(base);
    if (!slugBase) return '';

    return runInInjectionContext(this.injector, async () => {
      let candidato = slugBase;
      for (let n = 2; n <= 100; n++) {
        const ehDup = await this.slugEmUso(candidato, ignorarId);
        if (!ehDup) return candidato;
        candidato = `${slugBase}-${n}`;
      }
      // Safety: cai aqui se houver 100+ duplicatas (improvável)
      return `${slugBase}-${Date.now().toString(36)}`;
    });
  }

  /**
   * Checa se um slug já está em uso por outro campeonato.
   * Retorna `false` se o único hit for `ignorarId` (o próprio doc editado).
   */
  async slugEmUso(slug: string, ignorarId?: string): Promise<boolean> {
    return runInInjectionContext(this.injector, async () => {
      try {
        const snap = await getDocs(
          query(this.col, where('slug', '==', slug), limit(2)),
        );
        if (snap.empty) return false;
        // Se o único resultado for o próprio doc sendo editado, não conta.
        return snap.docs.some(d => d.id !== ignorarId);
      } catch (err) {
        // Sem auth pra fazer a query → fail-open (deixa salvar; quem checa
        // de novo é a próxima carga). Não bloqueia UX por falha de leitura.
        console.warn('[slugEmUso] falha', err);
        return false;
      }
    });
  }

  /**
   * Lista os campeonatos públicos de um organizador específico (ownerId).
   * Usado pela página pública do organizador (`/org/:slug`).
   */
  listPublicosDoOwner$(ownerId: string): Observable<Campeonato[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col,
        where('ownerId', '==', ownerId),
        where('publico', '==', true),
        limit(60),
      );
      return (collectionData(q, { idField: 'id' }) as Observable<Campeonato[]>).pipe(
        map(arr =>
          arr.sort((a, b) => {
            const ta = (a.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            const tb = (b.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            return tb - ta;
          }),
        ),
      );
    });
  }

  /** Stream de campeonatos públicos (todos os com `publico: true`), mais recentes primeiro.
   *  Usado pela landing pública. Não exige autenticação. */
  listPublicos$(): Observable<Campeonato[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col,
        where('publico', '==', true),
        orderBy('criadoEm', 'desc'),
        limit(60),
      );
      return collectionData(q, { idField: 'id' }) as Observable<Campeonato[]>;
    });
  }

  /**
   * Lista TODOS os campeonatos visíveis (exclui apenas os marcados
   * explicitamente como privados, `publico === false`). Inclui legacy
   * sem o campo `publico` definido — tratados como públicos pra trás.
   *
   * As Firestore Rules permitem `list: if true` no nível campeonatos,
   * então essa query funciona sem restrição. A filtragem `publico !==
   * false` acontece client-side.
   *
   * IMPORTANTE: não usa `orderBy('criadoEm')` na query porque documentos
   * legacy (sem esse campo) seriam excluídos silenciosamente pelo Firestore.
   * Ordenação por data é feita client-side; docs sem `criadoEm` ficam no fim.
   */
  listTodosVisiveis$(): Observable<Campeonato[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col, limit(200));
      return (collectionData(q, { idField: 'id' }) as Observable<Campeonato[]>).pipe(
        map(arr => {
          const visiveis = arr.filter(c => c.publico !== false);
          return visiveis.sort((a, b) => {
            const ta = (a.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            const tb = (b.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
            return tb - ta;
          });
        }),
      );
    });
  }

  /** Lista TODOS os campeonatos do sistema (públicos E privados, de
   *  qualquer dono). Reservado para o painel admin master.
   *  As Firestore Rules precisam permitir leitura ampla pra admin. */
  listAllSystem$(): Observable<Campeonato[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col, orderBy('criadoEm', 'desc'), limit(500));
      return collectionData(q, { idField: 'id' }) as Observable<Campeonato[]>;
    });
  }

  /** Lista campeonatos públicos pelo ID (usado pela página /app/seguindo). */
  listByIds$(ids: string[]): Observable<Campeonato[]> {
    if (ids.length === 0) return of<Campeonato[]>([]);
    return runInInjectionContext(this.injector, () => {
      // Firestore aceita até 10 IDs num `in`. Para listas maiores precisaria
      // particionar; para o uso atual (seguidos por um usuário), 10 já cobre 99%.
      const chunks = ids.length <= 10 ? [ids] : [ids.slice(0, 10)];
      const q = query(this.col, where('__name__', 'in', chunks[0]));
      return collectionData(q, { idField: 'id' }) as Observable<Campeonato[]>;
    });
  }

  /** Incremento atômico do contador denormalizado de seguidores. */
  async ajustarContadorSeguidores(id: string, delta: number): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(id), { seguidores: increment(delta) }),
    );
  }
}
