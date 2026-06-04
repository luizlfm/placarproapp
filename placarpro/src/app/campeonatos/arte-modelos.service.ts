import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/** Modelo de arte salvo pelo organizador (sincronizado no Firestore em
 *  `users/{uid}/arteModelos/{id}`). `dados` é o snapshot JSON do editor. */
export interface ArteModeloDoc {
  id: string;
  nome: string;
  dados: string;
  padrao?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ArteModelosService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);

  private uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  /** Lista (tempo real) os modelos do usuário logado. */
  listar(): Observable<ArteModeloDoc[]> {
    return from(this.auth.authStateReady()).pipe(
      switchMap(() => {
        const uid = this.uid();
        if (!uid) return of([] as ArteModeloDoc[]);
        return runInInjectionContext(this.injector, () =>
          collectionData(collection(this.fs, 'users', uid, 'arteModelos'), { idField: 'id' }) as Observable<ArteModeloDoc[]>,
        );
      }),
    );
  }

  async salvar(m: ArteModeloDoc): Promise<void> {
    const uid = this.uid();
    if (!uid) throw new Error('sem-usuario');
    await runInInjectionContext(this.injector, () =>
      setDoc(doc(this.fs, 'users', uid, 'arteModelos', m.id), {
        nome: m.nome,
        dados: m.dados,
        padrao: !!m.padrao,
      }),
    );
  }

  async remover(id: string): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    await runInInjectionContext(this.injector, () =>
      deleteDoc(doc(this.fs, 'users', uid, 'arteModelos', id)),
    );
  }

  /** Marca um id como padrão (ou nenhum) garantindo único `padrao: true`. */
  async definirPadrao(idAlvo: string | null, lista: ArteModeloDoc[]): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    await runInInjectionContext(this.injector, async () => {
      for (const m of lista) {
        const novo = m.id === idAlvo;
        if (!!m.padrao !== novo) {
          await updateDoc(doc(this.fs, 'users', uid, 'arteModelos', m.id), { padrao: novo });
        }
      }
    });
  }
}
