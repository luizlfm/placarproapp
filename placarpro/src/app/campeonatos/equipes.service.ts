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
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Equipe, NovaEquipeInput } from './models/equipe.model';

@Injectable({ providedIn: 'root' })
export class EquipesService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Equipe> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipes',
    ) as CollectionReference<Equipe>;
  }

  private docRef(campeonatoId: string, categoriaId: string, equipeId: string): DocumentReference<Equipe> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipes', equipeId,
    ) as DocumentReference<Equipe>;
  }

  private jogadoresCol(campeonatoId: string, categoriaId: string): CollectionReference {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores',
    );
  }

  list$(campeonatoId: string, categoriaId: string): Observable<Equipe[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('nome', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<Equipe[]>;
    });
  }

  get$(campeonatoId: string, categoriaId: string, equipeId: string): Observable<Equipe | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, categoriaId, equipeId), { idField: 'id' }) as Observable<Equipe | undefined>,
    );
  }

  async criar(campeonatoId: string, categoriaId: string, input: NovaEquipeInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload: Equipe = {
        ...input,
        // Convenção do sistema: nome de equipe SEMPRE em maiúsculas
        // (consistência visual em listas, súmulas, relatórios, públicas).
        nome: (input.nome ?? '').trim().toUpperCase(),
        campeonatoId,
        categoriaId,
        totalJogadores: 0,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col(campeonatoId, categoriaId), payload);
      return ref.id;
    });
  }

  async atualizar(
    campeonatoId: string,
    categoriaId: string,
    equipeId: string,
    patch: Partial<Equipe>,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, equipeId), {
        ...patch,
        // Garante uppercase em atualizações também (se vier `nome` no patch)
        ...(patch.nome != null ? { nome: patch.nome.trim().toUpperCase() } : {}),
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  /**
   * Remove a equipe e em cascata: jogadores vinculados, jogos em que ela
   * aparece (mandante OU visitante) e os eventos desses jogos.
   *
   * Sem a cascata de jogos, partidas ficavam ÓRFÃS apontando pra uma equipe
   * inexistente — nomes em branco na UI e uma "equipe fantasma" contando na
   * classificação (via collectionGroup de eventos).
   */
  async remover(campeonatoId: string, categoriaId: string, equipeId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      // 1) Jogadores + a própria equipe (batch atômico).
      const jogadoresSnap = await getDocs(
        query(this.jogadoresCol(campeonatoId, categoriaId), where('equipeId', '==', equipeId)),
      );
      const batch = writeBatch(this.fs);
      jogadoresSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(this.docRef(campeonatoId, categoriaId, equipeId));
      await batch.commit();

      // 2) Jogos que referenciam a equipe (Firestore não faz OR — 2 queries).
      const jogosCol = collection(
        this.fs, 'campeonatos', campeonatoId, 'categorias', categoriaId, 'jogos',
      );
      const [comoMandante, comoVisitante] = await Promise.all([
        getDocs(query(jogosCol, where('mandanteId', '==', equipeId))),
        getDocs(query(jogosCol, where('visitanteId', '==', equipeId))),
      ]);
      const jogoRefs = new Map<string, DocumentReference>();
      comoMandante.docs.forEach(d => jogoRefs.set(d.id, d.ref));
      comoVisitante.docs.forEach(d => jogoRefs.set(d.id, d.ref));

      // 3) Pra cada jogo afetado: apaga eventos (subcoleção) + o doc do jogo.
      //    Um batch por jogo evita estourar o limite de 500 ops do Firestore.
      for (const jogoRef of jogoRefs.values()) {
        const evSnap = await getDocs(collection(jogoRef, 'eventos'));
        const b = writeBatch(this.fs);
        evSnap.docs.forEach(d => b.delete(d.ref));
        b.delete(jogoRef);
        await b.commit();
      }
    });
  }

  /** Remove apenas a equipe (sem cascade). Útil para casos específicos. */
  async removerSimples(campeonatoId: string, categoriaId: string, equipeId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, equipeId)),
    );
  }
}
