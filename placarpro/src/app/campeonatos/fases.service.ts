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
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { CRITERIOS_PADRAO, Fase, NovaFaseInput } from './models/fase.model';

@Injectable({ providedIn: 'root' })
export class FasesService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Fase> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'fases',
    ) as CollectionReference<Fase>;
  }

  private docRef(campeonatoId: string, categoriaId: string, faseId: string): DocumentReference<Fase> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'fases', faseId,
    ) as DocumentReference<Fase>;
  }

  list$(campeonatoId: string, categoriaId: string): Observable<Fase[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('ordem', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<Fase[]>;
    });
  }

  async criar(
    campeonatoId: string,
    categoriaId: string,
    input: NovaFaseInput,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const existentes = await firstValueFrom(this.list$(campeonatoId, categoriaId));
      const payload: Fase = {
        campeonatoId,
        categoriaId,
        nome: input.nome,
        tipo: input.tipo,
        turnos: input.turnos ?? 1,
        ordem: input.ordem ?? existentes.length,
        criterios: input.criterios ?? [...CRITERIOS_PADRAO],
        pontosVitoria: input.pontosVitoria ?? 3,
        pontosEmpate: input.pontosEmpate ?? 1,
        pontosDerrota: input.pontosDerrota ?? 0,
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
    faseId: string,
    patch: Partial<Fase>,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, faseId), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  async remover(campeonatoId: string, categoriaId: string, faseId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, faseId)),
    );
  }

  /** Garante que existe pelo menos uma fase. Se não houver, cria "1ª Fase". */
  async ensureDefault(campeonatoId: string, categoriaId: string): Promise<Fase> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDocs(query(this.col(campeonatoId, categoriaId), orderBy('ordem', 'asc')));
      if (!snap.empty) {
        const d = snap.docs[0];
        return { id: d.id, ...(d.data() as Fase) };
      }
      const id = await this.criar(campeonatoId, categoriaId, {
        nome: '1ª Fase',
        tipo: 'pontos-corridos',
        turnos: 1,
        ordem: 0,
      });
      return {
        id,
        campeonatoId,
        categoriaId,
        nome: '1ª Fase',
        tipo: 'pontos-corridos',
        turnos: 1,
        ordem: 0,
        criterios: [...CRITERIOS_PADRAO],
        pontosVitoria: 3,
        pontosEmpate: 1,
        pontosDerrota: 0,
      };
    });
  }
}
