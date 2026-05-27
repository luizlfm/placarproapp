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
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import {
  Enquete,
  EnqueteAlternativa,
  NovaEnqueteInput,
  VotoEnquete,
} from './models/enquete.model';

@Injectable({ providedIn: 'root' })
export class EnquetesService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Enquete> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'enquetes',
    ) as CollectionReference<Enquete>;
  }

  private docRef(campeonatoId: string, categoriaId: string, enqId: string): DocumentReference<Enquete> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'enquetes', enqId,
    ) as DocumentReference<Enquete>;
  }

  private votoDocRef(
    campeonatoId: string,
    categoriaId: string,
    enqId: string,
    uid: string,
  ): DocumentReference<VotoEnquete> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'enquetes', enqId,
      'votos', uid,
    ) as DocumentReference<VotoEnquete>;
  }

  list$(campeonatoId: string, categoriaId: string): Observable<Enquete[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('criadoEm', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<Enquete[]>;
    });
  }

  get$(campeonatoId: string, categoriaId: string, enqId: string): Observable<Enquete | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, categoriaId, enqId), { idField: 'id' }) as Observable<Enquete | undefined>,
    );
  }

  async criar(
    campeonatoId: string,
    categoriaId: string,
    input: NovaEnqueteInput,
  ): Promise<string> {
    const user = this.auth.currentUser;
    return runInInjectionContext(this.injector, async () => {
      const payload: Enquete = {
        campeonatoId,
        categoriaId,
        pergunta: input.pergunta,
        alternativas: (input.alternativas ?? []).map(a => ({ ...a, votos: a.votos ?? 0 })),
        visivel:          input.visivel          ?? true,
        mostrarResultado: input.mostrarResultado ?? true,
        votacaoAberta:    input.votacaoAberta    ?? true,
        multiplaEscolha:  input.multiplaEscolha  ?? false,
        totalVotos:       0,
        ownerId:          user?.uid,
        criadoEm:         serverTimestamp() as unknown as Timestamp,
        atualizadoEm:     serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col(campeonatoId, categoriaId), this.semUndefined(payload) as Enquete);
      return ref.id;
    });
  }

  async atualizar(
    campeonatoId: string,
    categoriaId: string,
    enqId: string,
    patch: Partial<Enquete>,
  ): Promise<void> {
    const data = this.semUndefined({
      ...patch,
      atualizadoEm: serverTimestamp() as unknown as Timestamp,
    });
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, enqId), data),
    );
  }

  async remover(campeonatoId: string, categoriaId: string, enqId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, enqId)),
    );
  }

  /** Voto do usuário atual (busca pelo uid no doc id). */
  meuVoto$(campeonatoId: string, categoriaId: string, enqId: string): Observable<VotoEnquete | undefined> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return of(undefined);
    return runInInjectionContext(this.injector, () =>
      docData(this.votoDocRef(campeonatoId, categoriaId, enqId, uid)) as Observable<VotoEnquete | undefined>,
    );
  }

  /**
   * Registra (ou atualiza) o voto do usuário. Atualiza os contadores
   * denormalizados na enquete (`alternativas[].votos` + `totalVotos`).
   */
  async votar(
    campeonatoId: string,
    categoriaId: string,
    enqId: string,
    alternativaIds: string[],
  ): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Você precisa estar logado para votar.');
    if (alternativaIds.length === 0) throw new Error('Escolha pelo menos uma alternativa.');

    await runInInjectionContext(this.injector, async () => {
      const enqSnap = await getDoc(this.docRef(campeonatoId, categoriaId, enqId));
      if (!enqSnap.exists()) throw new Error('Enquete não existe.');
      const enq = enqSnap.data();
      if (!enq.votacaoAberta) throw new Error('Votação encerrada.');

      // Voto anterior (se houver) — pra ajustar contadores
      const votoRef = this.votoDocRef(campeonatoId, categoriaId, enqId, uid);
      const votoAntSnap = await getDoc(votoRef);
      const anterior = votoAntSnap.exists() ? votoAntSnap.data() : null;

      const deltaPorAlt = new Map<string, number>();
      if (anterior) {
        for (const id of anterior.alternativaIds) {
          deltaPorAlt.set(id, (deltaPorAlt.get(id) ?? 0) - 1);
        }
      }
      for (const id of alternativaIds) {
        deltaPorAlt.set(id, (deltaPorAlt.get(id) ?? 0) + 1);
      }

      // Aplica os deltas em `alternativas[]`
      const alternativasAtualizadas: EnqueteAlternativa[] = (enq.alternativas ?? []).map(a => ({
        ...a,
        votos: (a.votos ?? 0) + (deltaPorAlt.get(a.id) ?? 0),
      }));

      const totalDelta = (anterior ? 0 : 1); // só conta 1 voto novo se for primeiro voto
      await updateDoc(this.docRef(campeonatoId, categoriaId, enqId), {
        alternativas: alternativasAtualizadas,
        totalVotos: increment(totalDelta),
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      });

      // Salva o voto do usuário
      await setDoc(votoRef, {
        alternativaIds,
        criadoEm: serverTimestamp() as unknown as Timestamp,
      });
    });
  }

  /** Remove a chave undefined antes de mandar pro Firestore. */
  private semUndefined<T extends object>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
    return out as T;
  }
}
