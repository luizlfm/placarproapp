import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  collection,
  deleteDoc,
  doc,
  docData,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

/**
 * Convite de moderador. Documento root em `convitesModerador/{linkToken}`
 * usado pra resolver o link mágico `/m/{linkToken}` sem ter que varrer
 * todas as categorias/campeonatos procurando o token no array `moderadores`.
 *
 * Fluxo:
 *  1. Organizador convida moderador no modal → gera linkToken
 *  2. Modal grava o moderador no array `categoria.moderadores` E
 *     cria/atualiza esse doc espelho em `convitesModerador/{linkToken}`
 *  3. Quando o moderador clica em `/m/{linkToken}`:
 *     - Página lê esse doc → tem `campeonatoId` + `categoriaId` + `moderadorId`
 *     - Se logado, registra o UID no array `moderadores` da categoria
 *     - Redireciona pra `/app/campeonato/{campeonatoId}/inicio`
 */
export interface ConviteModerador {
  /** linkToken também é o ID do doc. */
  linkToken?: string;
  campeonatoId: string;
  /** Vazio se for moderador a nível de campeonato (não específico de categoria). */
  categoriaId?: string;
  /** ID local do moderador dentro do array `moderadores`. */
  moderadorId: string;
  /** Nome de exibição (pra UI de aceite). */
  nome?: string;
  /** Email opcional (pra UI de aceite). */
  email?: string;
  /** Quando foi convidado. */
  criadoEm?: Timestamp;
  /** UID do organizador que criou. */
  criadoPor: string;
  /** Quando foi aceito (preenchido no /m/aceitar). */
  aceitoEm?: Timestamp | null;
  /** UID do user que aceitou. */
  aceitoPorUid?: string;
}

/**
 * CRUD da coleção root `convitesModerador/{linkToken}`.
 * Permissões: read aberto (token = segredo); write só pro dono do campeonato.
 */
@Injectable({ providedIn: 'root' })
export class ConvitesModeradorService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(): CollectionReference<ConviteModerador> {
    return collection(this.fs, 'convitesModerador') as CollectionReference<ConviteModerador>;
  }
  private docRef(token: string): DocumentReference<ConviteModerador> {
    return doc(this.fs, 'convitesModerador', token) as DocumentReference<ConviteModerador>;
  }

  /** Lê um convite específico pelo token. Retorna undefined se não existir. */
  get$(token: string): Observable<ConviteModerador | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(token), { idField: 'linkToken' }) as Observable<ConviteModerador | undefined>,
    );
  }

  /** Upsert (cria ou substitui) — chamado quando organizador adiciona moderador. */
  async upsert(token: string, dados: Omit<ConviteModerador, 'linkToken' | 'criadoEm'>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await setDoc(
        this.docRef(token),
        {
          ...dados,
          criadoEm: serverTimestamp() as unknown as Timestamp,
        },
        { merge: true },
      );
    });
  }

  /** Marca o convite como aceito (registra UID do moderador que ativou). */
  async marcarAceito(token: string, uid: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await setDoc(
        this.docRef(token),
        {
          aceitoEm: serverTimestamp() as unknown as Timestamp,
          aceitoPorUid: uid,
        } as unknown as ConviteModerador,
        { merge: true },
      );
    });
  }

  /** Remove o convite (chamado quando organizador remove o moderador). */
  async remover(token: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(this.docRef(token));
    });
  }
}
