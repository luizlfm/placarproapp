import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  docData,
  getDoc,
  increment,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Jogador, NovoJogadorInput } from './models/jogador.model';

@Injectable({ providedIn: 'root' })
export class JogadoresService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Jogador> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores',
    ) as CollectionReference<Jogador>;
  }

  private docRef(campeonatoId: string, categoriaId: string, jogadorId: string): DocumentReference<Jogador> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores', jogadorId,
    ) as DocumentReference<Jogador>;
  }

  private equipeRef(campeonatoId: string, categoriaId: string, equipeId: string): DocumentReference {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipes', equipeId,
    );
  }

  /** Todos os jogadores da categoria. */
  list$(campeonatoId: string, categoriaId: string): Observable<Jogador[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('nome', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<Jogador[]>;
    });
  }

  /** Apenas os jogadores de uma equipe. */
  listPorEquipe$(campeonatoId: string, categoriaId: string, equipeId: string): Observable<Jogador[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col(campeonatoId, categoriaId),
        where('equipeId', '==', equipeId),
        orderBy('nome', 'asc'),
      );
      return collectionData(q, { idField: 'id' }) as Observable<Jogador[]>;
    });
  }

  get$(campeonatoId: string, categoriaId: string, jogadorId: string): Observable<Jogador | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, categoriaId, jogadorId), { idField: 'id' }) as Observable<Jogador | undefined>,
    );
  }

  async criar(campeonatoId: string, categoriaId: string, input: NovoJogadorInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const newRef = doc(this.col(campeonatoId, categoriaId));
      const payload: Jogador = stripUndefined({
        ...input,
        campeonatoId,
        categoriaId,
        cadastradoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }) as Jogador;
      const batch = writeBatch(this.fs);
      batch.set(newRef, payload);
      batch.update(this.equipeRef(campeonatoId, categoriaId, input.equipeId), {
        totalJogadores: increment(1),
        atualizadoEm: serverTimestamp(),
      });
      await batch.commit();
      return newRef.id;
    });
  }

  /**
   * Cria múltiplos jogadores em batch. Ajusta totalJogadores das equipes
   * envolvidas via increment. Lotes de 400 (limite do batch é 500).
   */
  async criarEmLote(
    campeonatoId: string,
    categoriaId: string,
    jogadores: NovoJogadorInput[],
  ): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      if (jogadores.length === 0) return 0;
      const tamanho = 400;
      let total = 0;
      for (let i = 0; i < jogadores.length; i += tamanho) {
        const lote = jogadores.slice(i, i + tamanho);
        const batch = writeBatch(this.fs);
        const contadorPorEquipe = new Map<string, number>();
        for (const j of lote) {
          const newRef = doc(this.col(campeonatoId, categoriaId));
          const payload: Jogador = stripUndefined({
            ...j,
            campeonatoId,
            categoriaId,
            cadastradoEm: serverTimestamp() as unknown as Timestamp,
            atualizadoEm: serverTimestamp() as unknown as Timestamp,
          }) as Jogador;
          batch.set(newRef, payload);
          contadorPorEquipe.set(j.equipeId, (contadorPorEquipe.get(j.equipeId) ?? 0) + 1);
        }
        contadorPorEquipe.forEach((qtd, equipeId) => {
          batch.update(this.equipeRef(campeonatoId, categoriaId, equipeId), {
            totalJogadores: increment(qtd),
            atualizadoEm: serverTimestamp(),
          });
        });
        await batch.commit();
        total += lote.length;
      }
      return total;
    });
  }

  async atualizar(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
    patch: Partial<Jogador>,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.docRef(campeonatoId, categoriaId, jogadorId);
      const novaEquipeId = patch.equipeId;
      if (novaEquipeId) {
        // Possível transferência entre equipes — ajusta contadores.
        const snap = await getDoc(ref);
        const antigaEquipeId = (snap.data() as Jogador | undefined)?.equipeId;
        const batch = writeBatch(this.fs);
        batch.update(ref, stripUndefined({
          ...patch,
          atualizadoEm: serverTimestamp(),
        }));
        if (antigaEquipeId && antigaEquipeId !== novaEquipeId) {
          batch.update(this.equipeRef(campeonatoId, categoriaId, antigaEquipeId), {
            totalJogadores: increment(-1),
            atualizadoEm: serverTimestamp(),
          });
          batch.update(this.equipeRef(campeonatoId, categoriaId, novaEquipeId), {
            totalJogadores: increment(1),
            atualizadoEm: serverTimestamp(),
          });
        }
        await batch.commit();
        return;
      }
      const batch = writeBatch(this.fs);
      batch.update(ref, stripUndefined({
        ...patch,
        atualizadoEm: serverTimestamp(),
      }));
      await batch.commit();
    });
  }

  /**
   * Lista jogadores de uma equipe (versão SEM orderBy para evitar
   * exigência de índice composto enquanto o índice está sendo construído).
   * O componente faz a ordenação por nome no client.
   */
  listPorEquipeSemIndex$(
    campeonatoId: string,
    categoriaId: string,
    equipeId: string,
  ): Observable<Jogador[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), where('equipeId', '==', equipeId));
      return collectionData(q, { idField: 'id' }) as Observable<Jogador[]>;
    });
  }

  async remover(campeonatoId: string, categoriaId: string, jogadorId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.docRef(campeonatoId, categoriaId, jogadorId);
      const snap = await getDoc(ref);
      const equipeId = (snap.data() as Jogador | undefined)?.equipeId;
      const batch = writeBatch(this.fs);
      batch.delete(ref);
      if (equipeId) {
        batch.update(this.equipeRef(campeonatoId, categoriaId, equipeId), {
          totalJogadores: increment(-1),
          atualizadoEm: serverTimestamp(),
        });
      }
      await batch.commit();
    });
  }
}

/**
 * Remove chaves cujo valor é `undefined`.
 * Firestore rejeita undefined em set/update e dispara
 * `Unsupported field value: undefined`.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
