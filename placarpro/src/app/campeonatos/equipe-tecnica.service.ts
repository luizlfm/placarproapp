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
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { MembroTecnico } from './models/membro-tecnico.model';

@Injectable({ providedIn: 'root' })
export class EquipeTecnicaService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(
    campeonatoId: string,
    categoriaId: string,
  ): CollectionReference<MembroTecnico> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipeTecnica',
    ) as CollectionReference<MembroTecnico>;
  }

  private docRef(
    campeonatoId: string,
    categoriaId: string,
    membroId: string,
  ): DocumentReference<MembroTecnico> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipeTecnica', membroId,
    ) as DocumentReference<MembroTecnico>;
  }

  listPorEquipe$(
    campeonatoId: string,
    categoriaId: string,
    equipeId: string,
  ): Observable<MembroTecnico[]> {
    return runInInjectionContext(this.injector, () => {
      // IMPORTANTE: usamos APENAS `where` no Firestore — sem `orderBy` —
      // porque a combinação `where('equipeId') + orderBy('criadoEm')`
      // exige um índice composto que não existe (Firestore retornaria
      // FAILED_PRECONDITION). A ordenação por `criadoEm` é feita no client
      // depois (custo de uma sort O(n log n) sobre, no máximo, dezenas de
      // membros — irrelevante).
      const q = query(
        this.col(campeonatoId, categoriaId),
        where('equipeId', '==', equipeId),
      );
      return (collectionData(q, { idField: 'id' }) as Observable<MembroTecnico[]>).pipe(
        // Sort client-side por criadoEm asc. Timestamps do Firestore têm
        // .toMillis(); strings/undefined caem pro fim com fallback `0`.
        map(list => [...list].sort((a, b) => {
          const ta = (a.criadoEm as any)?.toMillis?.() ?? 0;
          const tb = (b.criadoEm as any)?.toMillis?.() ?? 0;
          return ta - tb;
        })),
      );
    });
  }

  async criar(
    campeonatoId: string,
    categoriaId: string,
    input: Omit<MembroTecnico, 'id' | 'criadoEm' | 'atualizadoEm'>,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload: MembroTecnico = {
        ...input,
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
    membroId: string,
    patch: Partial<MembroTecnico>,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, membroId), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  async remover(
    campeonatoId: string,
    categoriaId: string,
    membroId: string,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, membroId)),
    );
  }
}
