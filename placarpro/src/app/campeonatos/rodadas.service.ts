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
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Rodada } from './models/rodada.model';

@Injectable({ providedIn: 'root' })
export class RodadasService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Rodada> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'rodadas',
    ) as CollectionReference<Rodada>;
  }

  private docRef(campeonatoId: string, categoriaId: string, rodadaId: string): DocumentReference<Rodada> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'rodadas', rodadaId,
    ) as DocumentReference<Rodada>;
  }

  list$(campeonatoId: string, categoriaId: string): Observable<Rodada[]> {
    return runInInjectionContext(this.injector, () =>
      collectionData(this.col(campeonatoId, categoriaId), { idField: 'id' }) as Observable<Rodada[]>,
    );
  }

  /**
   * Localiza o doc de uma rodada por (faseNome, numero). Retorna `null` se
   * ainda não foi criado — a UI então usa defaults (sem título custom, não
   * oculta, não permite envio).
   */
  async buscarPorFaseNumero(
    campeonatoId: string,
    categoriaId: string,
    faseNome: string,
    numero: number,
  ): Promise<Rodada | null> {
    return runInInjectionContext(this.injector, async () => {
      const q = query(
        this.col(campeonatoId, categoriaId),
        where('faseNome', '==', faseNome),
        where('numero', '==', numero),
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...(d.data() as Rodada) };
    });
  }

  /**
   * Cria ou atualiza o doc de rodada por (faseNome, numero). Use isto sempre
   * que o usuário salvar — não precisa o caller saber o id Firestore.
   */
  async upsert(
    campeonatoId: string,
    categoriaId: string,
    faseNome: string,
    numero: number,
    patch: Partial<Pick<Rodada, 'titulo' | 'oculta' | 'permiteEnvioResultados'>>,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const existente = await this.buscarPorFaseNumero(campeonatoId, categoriaId, faseNome, numero);
      if (existente?.id) {
        await updateDoc(this.docRef(campeonatoId, categoriaId, existente.id), {
          ...patch,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
        });
        return existente.id;
      }
      const payload: Rodada = {
        campeonatoId,
        categoriaId,
        faseNome,
        numero,
        ...patch,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col(campeonatoId, categoriaId), payload);
      return ref.id;
    });
  }

  /** Apaga só o doc de metadados da rodada (não toca nos jogos). */
  async remover(campeonatoId: string, categoriaId: string, rodadaId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, rodadaId)),
    );
  }

  /**
   * Remove o doc de metadados localizando por (faseNome, numero). Útil quando
   * o caller ainda não tem o id do doc (provavelmente nunca foi criado).
   * Idempotente — não faz nada se não existir.
   */
  async removerPorFaseNumero(
    campeonatoId: string,
    categoriaId: string,
    faseNome: string,
    numero: number,
  ): Promise<void> {
    const existente = await this.buscarPorFaseNumero(campeonatoId, categoriaId, faseNome, numero);
    if (existente?.id) await this.remover(campeonatoId, categoriaId, existente.id);
  }
}
