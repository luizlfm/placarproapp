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
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of, switchMap } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../auth/auth.service';
import {
  Racha,
  RachaJogador,
  RachaTime,
  RachaAvaliacao,
  RachaConquista,
  RachaLancamento,
  RachaPartida,
  RachaEvento,
} from './models/racha.model';
import { setDoc } from '@angular/fire/firestore';

/**
 * CRUD da coleção `rachas` (Firestore root). Filtra por `ownerId` no
 * `listMeus$`. Padrão idêntico ao `CampeonatosService` — usa
 * `runInInjectionContext` pra manter Zone.js feliz.
 *
 * Diferença pra Campeonato:
 *  - Racha não tem fases / inscrições / súmula
 *  - Foco em sorteio de times + presença + ranking rápido
 */
@Injectable({ providedIn: 'root' })
export class RachaService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private get col(): CollectionReference<Racha> {
    return collection(this.fs, 'rachas') as CollectionReference<Racha>;
  }

  private docRef(id: string): DocumentReference<Racha> {
    return doc(this.fs, 'rachas', id) as DocumentReference<Racha>;
  }

  /**
   * Remove chaves com `undefined` de um objeto antes de gravar no Firestore.
   * O SDK do Firestore rejeita docs com `undefined` (mas aceita `null` e
   * aceita omitir a chave). Aqui escolhemos *omitir* — é a opção mais limpa
   * (não cria campos vazios no doc, queries por "campo existe" funcionam).
   *
   * Recursivo apenas no nível raiz — campos aninhados precisam ser
   * normalizados pelo caller (raro no nosso caso).
   */
  private cleanUndefined<T extends Record<string, unknown>>(obj: T): T {
    const out = {} as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
    return out as T;
  }

  /** Stream dos rachas do usuário logado, mais recentes primeiro. */
  listMeus$(): Observable<Racha[]> {
    return this.auth.user$.pipe(
      switchMap(user => {
        if (!user) return of([] as Racha[]);
        return runInInjectionContext(this.injector, () => {
          const q = query(
            this.col,
            where('ownerId', '==', user.uid),
            orderBy('criadoEm', 'desc'),
          );
          return collectionData(q, { idField: 'id' }) as Observable<Racha[]>;
        });
      }),
    );
  }

  /** Observa um racha específico (reativo). */
  get$(id: string): Observable<Racha | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(id), { idField: 'id' }) as Observable<Racha | undefined>,
    );
  }

  /**
   * Cria um novo racha. Retorna o ID gerado pelo Firestore.
   * Já calcula `capacidadeTotal = qtdTimes × jogadoresPorTime`.
   *
   * O `status` começa como `rascunho` — fica como `ativo` quando o wizard
   * de ativação termina. Useful pra distinguir cards que precisam de
   * setup vs. cards prontos.
   */
  async criar(input: {
    nome: string;
    qtdTimes: number;
    jogadoresPorTime: number;
    local?: string;
    horario?: string;
  }): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Não autenticado.');
    return runInInjectionContext(this.injector, async () => {
      const payload: Racha = {
        ownerId: user.uid,
        nome: input.nome.trim(),
        qtdTimes: input.qtdTimes,
        jogadoresPorTime: input.jogadoresPorTime,
        capacidadeTotal: input.qtdTimes * input.jogadoresPorTime,
        local: input.local?.trim() || '',
        horario: input.horario?.trim() || '',
        status: 'rascunho',
        ativado: false,
        visibilidade: 'privado',
        plano: 'gratis',
        seguidores: 0,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col, this.cleanUndefined(payload as unknown as Record<string, unknown>) as unknown as Racha);
      return ref.id;
    });
  }

  /**
   * Atualiza campos do racha. Recalcula `capacidadeTotal` se qtdTimes ou
   * jogadoresPorTime foram alterados — assim a UI sempre tem o valor
   * derivado correto sem precisar recomputar client-side.
   *
   * IMPORTANTE: usa `getDoc()` (Promise nativa do SDK) pra ler o doc atual
   * quando só um dos dois campos foi alterado. ANTES usava
   * `docData().toPromise()` que NUNCA resolve porque `docData` retorna
   * um Observable contínuo (sem `complete()`), travando o salvar pra sempre.
   */
  async atualizar(id: string, patch: Partial<Racha>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const next: Partial<Racha> = {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      if (patch.qtdTimes !== undefined || patch.jogadoresPorTime !== undefined) {
        // Se ambos vieram no patch, calcula direto sem ler do Firestore.
        if (patch.qtdTimes !== undefined && patch.jogadoresPorTime !== undefined) {
          next.capacidadeTotal = patch.qtdTimes * patch.jogadoresPorTime;
        } else {
          // Só um veio — lê o doc atual pra pegar o outro.
          try {
            const snap = await getDoc(this.docRef(id));
            const atual = snap.exists() ? (snap.data() as Racha) : null;
            const qtdTimes = patch.qtdTimes ?? atual?.qtdTimes ?? 2;
            const jogadores = patch.jogadoresPorTime ?? atual?.jogadoresPorTime ?? 5;
            next.capacidadeTotal = qtdTimes * jogadores;
          } catch (err) {
            console.warn('[RachaService] atualizar — falha ao ler doc pra recalcular capacidade, mantendo patch como veio', err);
          }
        }
      }
      await updateDoc(this.docRef(id), this.cleanUndefined(next as Record<string, unknown>));
    });
  }

  /** Marca o wizard de ativação como concluído (status: ativo). */
  async marcarAtivado(id: string): Promise<void> {
    await this.atualizar(id, { ativado: true, status: 'ativo' });
  }

  async remover(id: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(this.docRef(id));
    });
  }

  // ====================================================================
  // Subcoleções: times e jogadores
  // ====================================================================

  /** Ref pra subcoleção `rachas/{rachaId}/times`. */
  private timesCol(rachaId: string): CollectionReference<RachaTime> {
    return collection(this.fs, 'rachas', rachaId, 'times') as CollectionReference<RachaTime>;
  }

  /** Stream dos times de um racha, ordenados por `ordem` ascendente. */
  listTimes$(rachaId: string): Observable<RachaTime[]> {
    if (!rachaId) return of([] as RachaTime[]);
    return runInInjectionContext(this.injector, () => {
      const q = query(this.timesCol(rachaId), orderBy('ordem', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<RachaTime[]>;
    });
  }

  async criarTime(rachaId: string, data: Omit<RachaTime, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload = this.cleanUndefined({
        ...data,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      } as Record<string, unknown>);
      const ref = await addDoc(this.timesCol(rachaId), payload as unknown as RachaTime);
      return ref.id;
    });
  }

  async atualizarTime(rachaId: string, timeId: string, patch: Partial<RachaTime>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(
        doc(this.fs, 'rachas', rachaId, 'times', timeId),
        this.cleanUndefined({ ...patch, atualizadoEm: serverTimestamp() } as Record<string, unknown>),
      );
    });
  }

  async removerTime(rachaId: string, timeId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(doc(this.fs, 'rachas', rachaId, 'times', timeId));
    });
  }

  /** Ref pra subcoleção `rachas/{rachaId}/jogadores`. */
  private jogadoresCol(rachaId: string): CollectionReference<RachaJogador> {
    return collection(this.fs, 'rachas', rachaId, 'jogadores') as CollectionReference<RachaJogador>;
  }

  listJogadores$(rachaId: string): Observable<RachaJogador[]> {
    if (!rachaId) return of([] as RachaJogador[]);
    return runInInjectionContext(this.injector, () => {
      const q = query(this.jogadoresCol(rachaId), orderBy('nome', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<RachaJogador[]>;
    });
  }

  async criarJogador(rachaId: string, data: Omit<RachaJogador, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload = this.cleanUndefined({
        ...data,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      } as Record<string, unknown>);
      const ref = await addDoc(this.jogadoresCol(rachaId), payload as unknown as RachaJogador);
      return ref.id;
    });
  }

  async atualizarJogador(rachaId: string, jogadorId: string, patch: Partial<RachaJogador>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(
        doc(this.fs, 'rachas', rachaId, 'jogadores', jogadorId),
        this.cleanUndefined({ ...patch, atualizadoEm: serverTimestamp() } as Record<string, unknown>),
      );
    });
  }

  async removerJogador(rachaId: string, jogadorId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(doc(this.fs, 'rachas', rachaId, 'jogadores', jogadorId));
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Avaliações peer-to-peer
  // ──────────────────────────────────────────────────────────────────

  private avaliacoesCol(rachaId: string): CollectionReference<RachaAvaliacao> {
    return collection(this.fs, 'rachas', rachaId, 'avaliacoes') as CollectionReference<RachaAvaliacao>;
  }

  /** Stream de todas as avaliações do racha. Usado pra calcular médias. */
  listAvaliacoes$(rachaId: string): Observable<RachaAvaliacao[]> {
    if (!rachaId) return of([] as RachaAvaliacao[]);
    return runInInjectionContext(this.injector, () =>
      collectionData(this.avaliacoesCol(rachaId), { idField: 'id' }) as Observable<RachaAvaliacao[]>,
    );
  }

  /**
   * Salva (upsert) avaliação peer-to-peer. Doc id = `${avaliador}_${avaliado}`
   * pra garantir 1 voto por par e permitir update do mesmo doc.
   */
  async salvarAvaliacao(
    rachaId: string,
    data: Omit<RachaAvaliacao, 'id' | 'criadoEm' | 'atualizadoEm'>,
  ): Promise<void> {
    const docId = `${data.avaliadorId}_${data.avaliadoId}`;
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'rachas', rachaId, 'avaliacoes', docId);
      await setDoc(
        ref,
        {
          ...data,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
          criadoEm: serverTimestamp() as unknown as Timestamp,
        } as RachaAvaliacao,
        { merge: true },
      );
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Conquistas (badges)
  // ──────────────────────────────────────────────────────────────────

  private conquistasCol(rachaId: string): CollectionReference<RachaConquista> {
    return collection(this.fs, 'rachas', rachaId, 'conquistas') as CollectionReference<RachaConquista>;
  }

  listConquistas$(rachaId: string): Observable<RachaConquista[]> {
    if (!rachaId) return of([] as RachaConquista[]);
    return runInInjectionContext(this.injector, () =>
      collectionData(this.conquistasCol(rachaId), { idField: 'id' }) as Observable<RachaConquista[]>,
    );
  }

  /** Registra (upsert) uma conquista. Doc id = `${jogadorId}_${badgeId}`. */
  async registrarConquista(
    rachaId: string,
    jogadorId: string,
    badgeId: string,
  ): Promise<void> {
    const docId = `${jogadorId}_${badgeId}`;
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'rachas', rachaId, 'conquistas', docId);
      await setDoc(
        ref,
        {
          jogadorId,
          badgeId,
          conquistadaEm: serverTimestamp() as unknown as Timestamp,
        } as RachaConquista,
        { merge: true },
      );
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Lançamentos financeiros (entradas/saídas)
  // ──────────────────────────────────────────────────────────────────

  private lancamentosCol(rachaId: string): CollectionReference<RachaLancamento> {
    return collection(this.fs, 'rachas', rachaId, 'lancamentos') as CollectionReference<RachaLancamento>;
  }

  /** Stream de todos os lançamentos do racha, ordenado por data desc. */
  listLancamentos$(rachaId: string): Observable<RachaLancamento[]> {
    if (!rachaId) return of([] as RachaLancamento[]);
    return runInInjectionContext(this.injector, () => {
      const q = query(this.lancamentosCol(rachaId), orderBy('criadoEm', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<RachaLancamento[]>;
    });
  }

  async criarLancamento(
    rachaId: string,
    data: Omit<RachaLancamento, 'id' | 'criadoEm' | 'atualizadoEm'>,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload = this.cleanUndefined({
        ...data,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      } as Record<string, unknown>);
      const ref = await addDoc(this.lancamentosCol(rachaId), payload as unknown as RachaLancamento);
      return ref.id;
    });
  }

  async removerLancamento(rachaId: string, lancamentoId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(doc(this.fs, 'rachas', rachaId, 'lancamentos', lancamentoId));
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Partidas + Eventos
  // ──────────────────────────────────────────────────────────────────

  private partidasCol(rachaId: string): CollectionReference<RachaPartida> {
    return collection(this.fs, 'rachas', rachaId, 'partidas') as CollectionReference<RachaPartida>;
  }

  /** Stream de partidas do racha, ordenado por data desc (mais recente primeiro). */
  listPartidas$(rachaId: string): Observable<RachaPartida[]> {
    if (!rachaId) return of([] as RachaPartida[]);
    return runInInjectionContext(this.injector, () => {
      const q = query(this.partidasCol(rachaId), orderBy('data', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<RachaPartida[]>;
    });
  }

  async criarPartida(
    rachaId: string,
    data: Omit<RachaPartida, 'id' | 'criadoEm' | 'atualizadoEm'>,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload = this.cleanUndefined({
        ...data,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      } as Record<string, unknown>);
      const ref = await addDoc(this.partidasCol(rachaId), payload as unknown as RachaPartida);
      return ref.id;
    });
  }

  async atualizarPartida(
    rachaId: string,
    partidaId: string,
    patch: Partial<RachaPartida>,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(
        doc(this.fs, 'rachas', rachaId, 'partidas', partidaId),
        this.cleanUndefined({ ...patch, atualizadoEm: serverTimestamp() } as Record<string, unknown>),
      );
    });
  }

  async removerPartida(rachaId: string, partidaId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(doc(this.fs, 'rachas', rachaId, 'partidas', partidaId));
    });
  }

  // Eventos por partida (subcoleção da partida)

  private eventosCol(rachaId: string, partidaId: string): CollectionReference<RachaEvento> {
    return collection(this.fs, 'rachas', rachaId, 'partidas', partidaId, 'eventos') as CollectionReference<RachaEvento>;
  }

  listEventos$(rachaId: string, partidaId: string): Observable<RachaEvento[]> {
    if (!rachaId || !partidaId) return of([] as RachaEvento[]);
    return runInInjectionContext(this.injector, () => {
      const q = query(this.eventosCol(rachaId, partidaId), orderBy('criadoEm', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<RachaEvento[]>;
    });
  }

  /**
   * Stream de TODOS os eventos do racha (cross-partidas). Cada evento é
   * enriquecido com `partidaId` (não vem do Firestore porque o id do pai
   * não está no doc filho). Necessário pros consumidores que precisam
   * agrupar eventos por partida (ex: detectar hat-trick).
   */
  listEventosDoRacha$(rachaId: string): Observable<RachaEvento[]> {
    if (!rachaId) return of([] as RachaEvento[]);
    return this.listPartidas$(rachaId).pipe(
      switchMap(partidas => {
        if (partidas.length === 0) return of([] as RachaEvento[]);
        return runInInjectionContext(this.injector, () => {
          const streams = partidas
            .filter(p => p.id)
            .map(p =>
              this.listEventos$(rachaId, p.id!).pipe(
                // Enriquece cada evento com partidaId pro consumer.
                map(eventos => eventos.map(ev => ({ ...ev, partidaId: p.id! } as RachaEvento & { partidaId: string }))),
              ),
            );
          return combineLatestSafe(streams);
        });
      }),
    );
  }

  async criarEvento(
    rachaId: string,
    partidaId: string,
    data: Omit<RachaEvento, 'id' | 'criadoEm'>,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload = this.cleanUndefined({
        ...data,
        criadoEm: serverTimestamp() as unknown as Timestamp,
      } as Record<string, unknown>);
      const ref = await addDoc(this.eventosCol(rachaId, partidaId), payload as unknown as RachaEvento);
      return ref.id;
    });
  }

  async removerEvento(rachaId: string, partidaId: string, eventoId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(doc(this.fs, 'rachas', rachaId, 'partidas', partidaId, 'eventos', eventoId));
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers fora da classe
// ────────────────────────────────────────────────────────────────────

/** Combina N streams `Observable<T[]>` em um único `Observable<T[]>`
 *  achatado. Safe pra array vazio (retorna `of([])`). */
function combineLatestSafe<T>(streams: Observable<T[]>[]): Observable<T[]> {
  if (streams.length === 0) return of([] as T[]);
  return combineLatest(streams).pipe(
    map(arrays => arrays.flat()),
  );
}
