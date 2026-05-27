import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  collectionGroup,
  deleteDoc,
  doc,
  docData,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Seguidor } from './models/seguidor.model';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class SeguidoresService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);

  private col(campeonatoId: string): CollectionReference<Seguidor> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'seguidores',
    ) as CollectionReference<Seguidor>;
  }

  private docRef(campeonatoId: string, uid: string): DocumentReference<Seguidor> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'seguidores', uid,
    ) as DocumentReference<Seguidor>;
  }

  /** Lista todos os seguidores do campeonato (mais recentes primeiro). */
  list$(campeonatoId: string): Observable<Seguidor[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId), orderBy('seguindoDesde', 'desc'));
      return collectionData(q, { idField: 'uid' }) as Observable<Seguidor[]>;
    });
  }

  /** Verifica em tempo real se o usuário corrente segue. */
  euSigo$(campeonatoId: string): Observable<boolean> {
    return runInInjectionContext(this.injector, () => {
      const uid = this.auth.currentUser?.uid;
      if (!uid) return new Observable<boolean>(s => s.next(false));
      return (docData(this.docRef(campeonatoId, uid)) as Observable<Seguidor | undefined>).pipe(
        map(d => !!d),
      );
    });
  }

  /**
   * O usuário corrente passa a seguir o campeonato.
   * Idempotente: chamar várias vezes sem erro.
   */
  async seguir(campeonatoId: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Não autenticado');
    return runInInjectionContext(this.injector, async () => {
      const payload: Seguidor = {
        uid: user.uid,
        nome: user.displayName || user.email?.split('@')[0] || 'Usuário',
        ...(user.email ? { email: user.email } : {}),
        ...(user.photoURL ? { fotoUrl: user.photoURL } : {}),
        seguindoDesde: serverTimestamp() as unknown as Timestamp,
      };
      const ref = this.docRef(campeonatoId, user.uid);
      const snap = await getDoc(ref);
      const batch = writeBatch(this.fs);
      if (snap.exists()) {
        // já segue — só atualiza dados do perfil
        batch.update(ref, {
          nome: payload.nome,
          ...(payload.email ? { email: payload.email } : {}),
          ...(payload.fotoUrl ? { fotoUrl: payload.fotoUrl } : {}),
        });
      } else {
        batch.set(ref, payload);
        // incrementa contador denormalizado no campeonato
        batch.update(
          doc(this.fs, 'campeonatos', campeonatoId),
          {
            seguidores: increment(1),
            atualizadoEm: serverTimestamp(),
          },
        );
      }
      await batch.commit();
    });
  }

  /** O usuário corrente deixa de seguir. */
  async deixarDeSeguir(campeonatoId: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Não autenticado');
    return runInInjectionContext(this.injector, async () => {
      const ref = this.docRef(campeonatoId, user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const batch = writeBatch(this.fs);
      batch.delete(ref);
      batch.update(doc(this.fs, 'campeonatos', campeonatoId), {
        seguidores: increment(-1),
        atualizadoEm: serverTimestamp(),
      });
      await batch.commit();
    });
  }

  /**
   * Migra/sincroniza seguidores antigos.
   *
   * No app, ao seguir, o doc também era gravado em `users/{uid}/seguindo/{campId}`.
   * Aqui usamos `collectionGroup('seguindo')` pra encontrar todos os users que
   * têm um doc apontando pro `campeonatoId` e espelhamos pra
   * `campeonatos/{id}/seguidores/{uid}` (que é onde o admin lê).
   *
   * Requer que as Firestore Rules permitam `collectionGroup('seguindo')` read.
   * Se as rules atuais negarem, o método retorna 0 (sem erro fatal).
   */
  async sincronizarDeUsers(campeonatoId: string): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      let espelhados = 0;
      try {
        const q = query(collectionGroup(this.fs, 'seguindo'));
        const snap = await getDocs(q);

        // Coleta uids cujo doc.id === campeonatoId (filtragem client-side)
        const uids = new Set<string>();
        snap.forEach(d => {
          if (d.id !== campeonatoId) return;
          const userRef = d.ref.parent.parent;
          if (!userRef) return;
          uids.add(userRef.id);
        });

        const batch = writeBatch(this.fs);

        // Pra cada uid, tenta enriquecer com dados do perfil (silencia se rules negarem)
        for (const uid of uids) {
          let nome = 'Usuário ' + uid.slice(0, 6);
          let email: string | undefined;
          let fotoUrl: string | undefined;
          try {
            const userDoc = await getDoc(doc(this.fs, 'users', uid));
            const data = userDoc.data() as
              | { nome?: string; displayName?: string; email?: string; fotoUrl?: string; photoURL?: string }
              | undefined;
            if (data) {
              nome = data.nome || data.displayName || nome;
              email = data.email;
              fotoUrl = data.fotoUrl || data.photoURL;
            }
          } catch {
            /* sem permissão de ler users/{uid} — usa nome genérico */
          }
          const segRef = this.docRef(campeonatoId, uid);
          const payload: Record<string, unknown> = {
            uid,
            nome,
            seguindoDesde: serverTimestamp(),
          };
          if (email) payload['email'] = email;
          if (fotoUrl) payload['fotoUrl'] = fotoUrl;
          batch.set(segRef, payload, { merge: true });
          espelhados++;
        }

        // Atualiza contador denormalizado no doc do campeonato
        if (espelhados > 0) {
          batch.set(
            doc(this.fs, 'campeonatos', campeonatoId),
            { seguidores: espelhados, atualizadoEm: serverTimestamp() },
            { merge: true },
          );
          await batch.commit();
        }
        return espelhados;
      } catch (err) {
        console.warn('[Seguidores] sincronizarDeUsers falhou (rules?)', err);
        return 0;
      }
    });
  }

  /** Remove um seguidor específico (operação do admin). */
  async removerSeguidor(campeonatoId: string, uid: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.docRef(campeonatoId, uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const batch = writeBatch(this.fs);
      batch.delete(ref);
      batch.update(doc(this.fs, 'campeonatos', campeonatoId), {
        seguidores: increment(-1),
        atualizadoEm: serverTimestamp(),
      });
      await batch.commit();
    });
  }
}
