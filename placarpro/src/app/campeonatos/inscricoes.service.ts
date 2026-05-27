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
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Inscricao, NovaInscricaoInput } from './models/inscricao.model';
import { EquipesService } from './equipes.service';

@Injectable({ providedIn: 'root' })
export class InscricoesService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly equipesSrv = inject(EquipesService);

  private col(campeonatoId: string): CollectionReference<Inscricao> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'inscricoes',
    ) as CollectionReference<Inscricao>;
  }

  private docRef(campeonatoId: string, inscricaoId: string): DocumentReference<Inscricao> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'inscricoes', inscricaoId,
    ) as DocumentReference<Inscricao>;
  }

  list$(campeonatoId: string): Observable<Inscricao[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId), orderBy('criadoEm', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<Inscricao[]>;
    });
  }

  /** Lista filtrada pelas inscrições de uma categoria específica (filtro client-side). */
  listPorCategoria$(campeonatoId: string, categoriaId: string): Observable<Inscricao[]> {
    return this.list$(campeonatoId).pipe(
      map(list => list.filter(i => i.categoriaId === categoriaId)),
    );
  }

  async criar(campeonatoId: string, input: NovaInscricaoInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload: Inscricao = {
        ...input,
        campeonatoId,
        status: 'pendente',
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col(campeonatoId), payload);
      return ref.id;
    });
  }

  async atualizar(campeonatoId: string, inscricaoId: string, patch: Partial<Inscricao>): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, inscricaoId), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  async remover(campeonatoId: string, inscricaoId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, inscricaoId)),
    );
  }

  /**
   * Aprova a inscrição: marca como aprovada e cria a Equipe na categoria escolhida.
   * Se a categoria não estiver definida, lança erro.
   */
  async aprovar(
    campeonatoId: string,
    inscricaoId: string,
    insc: Inscricao,
  ): Promise<string> {
    if (!insc.categoriaId) {
      throw new Error('Designe uma categoria antes de aprovar.');
    }
    const equipeId = await this.equipesSrv.criar(campeonatoId, insc.categoriaId, {
      nome: insc.nomeEquipe,
      cidade: insc.cidade,
      tecnico: insc.responsavel,
    });
    await this.atualizar(campeonatoId, inscricaoId, { status: 'aprovada' });
    return equipeId;
  }

  async rejeitar(campeonatoId: string, inscricaoId: string, motivo?: string): Promise<void> {
    await this.atualizar(campeonatoId, inscricaoId, {
      status: 'rejeitada',
      motivoRejeicao: motivo,
    });
  }
}
