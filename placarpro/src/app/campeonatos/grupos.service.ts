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
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { Grupo } from './models/grupo.model';
import { EquipesService } from './equipes.service';

@Injectable({ providedIn: 'root' })
export class GruposService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly equipesSrv = inject(EquipesService);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Grupo> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'grupos',
    ) as CollectionReference<Grupo>;
  }

  private docRef(campeonatoId: string, categoriaId: string, grupoId: string): DocumentReference<Grupo> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'grupos', grupoId,
    ) as DocumentReference<Grupo>;
  }

  list$(campeonatoId: string, categoriaId: string): Observable<Grupo[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('ordem', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<Grupo[]>;
    });
  }

  /** Substitui a estrutura de grupos pelo número informado. */
  async definirQuantidade(
    campeonatoId: string,
    categoriaId: string,
    quantidade: number,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const existentes = await getDocs(this.col(campeonatoId, categoriaId));
      const batch = writeBatch(this.fs);

      // Apaga excedentes (se já tinha mais do que vai ter)
      existentes.docs.forEach((d, i) => {
        if (i >= quantidade) batch.delete(d.ref);
      });
      await batch.commit();

      // Cria os que faltam
      const atual = Math.min(existentes.size, quantidade);
      for (let i = atual; i < quantidade; i++) {
        const letra = String.fromCharCode(65 + i); // A, B, C…
        await addDoc(this.col(campeonatoId, categoriaId), {
          campeonatoId,
          categoriaId,
          ordem: i,
          nome: `Grupo ${letra}`,
          criadoEm: serverTimestamp() as unknown as Timestamp,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        });
      }
    });
  }

  async renomear(
    campeonatoId: string,
    categoriaId: string,
    grupoId: string,
    nome: string,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, grupoId), {
        nome,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  async remover(campeonatoId: string, categoriaId: string, grupoId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, grupoId)),
    );
  }

  /** Distribui equipes nos grupos em ordem aleatória. */
  async sortear(campeonatoId: string, categoriaId: string): Promise<void> {
    const grupos = await firstValueFrom(this.list$(campeonatoId, categoriaId));
    const equipes = await firstValueFrom(this.equipesSrv.list$(campeonatoId, categoriaId));
    if (grupos.length === 0 || equipes.length === 0) return;

    // Shuffle (Fisher-Yates)
    const shuffled = [...equipes];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Distribui round-robin
    for (let i = 0; i < shuffled.length; i++) {
      const grupo = grupos[i % grupos.length];
      await this.equipesSrv.atualizar(campeonatoId, categoriaId, shuffled[i].id!, {
        grupoId: grupo.id,
      });
    }
  }
}
