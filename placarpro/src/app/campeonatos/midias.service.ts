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
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Midia, NovaMidiaInput } from './models/midia.model';
import { StorageService } from '../shared/storage.service';

@Injectable({ providedIn: 'root' })
export class MidiasService {
  private readonly fs = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly storage = inject(StorageService);

  /**
   * Coleção das mídias. Se `categoriaId` for fornecido, vai para
   * `campeonatos/{id}/categorias/{catId}/midias`, senão para `campeonatos/{id}/midias`.
   */
  private col(campeonatoId: string, categoriaId?: string): CollectionReference<Midia> {
    if (categoriaId) {
      return collection(
        this.fs,
        'campeonatos', campeonatoId,
        'categorias', categoriaId,
        'midias',
      ) as CollectionReference<Midia>;
    }
    return collection(this.fs, 'campeonatos', campeonatoId, 'midias') as CollectionReference<Midia>;
  }

  private docRef(campeonatoId: string, midiaId: string, categoriaId?: string): DocumentReference<Midia> {
    if (categoriaId) {
      return doc(
        this.fs,
        'campeonatos', campeonatoId,
        'categorias', categoriaId,
        'midias', midiaId,
      ) as DocumentReference<Midia>;
    }
    return doc(this.fs, 'campeonatos', campeonatoId, 'midias', midiaId) as DocumentReference<Midia>;
  }

  list$(campeonatoId: string, categoriaId?: string): Observable<Midia[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('criadoEm', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<Midia[]>;
    });
  }

  get$(campeonatoId: string, midiaId: string, categoriaId?: string): Observable<Midia | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, midiaId, categoriaId), { idField: 'id' }) as Observable<Midia | undefined>,
    );
  }

  async criar(campeonatoId: string, input: NovaMidiaInput, categoriaId?: string): Promise<string> {
    const user = this.auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado.');
    return runInInjectionContext(this.injector, async () => {
      const rawPayload: Midia = {
        ...input,
        campeonatoId,
        categoriaId: categoriaId ?? input.categoriaId,
        ownerId: user.uid,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const payload = this.semUndefined(rawPayload);
      const ref = await addDoc(this.col(campeonatoId, categoriaId), payload as Midia);
      return ref.id;
    });
  }

  async atualizar(
    campeonatoId: string,
    midiaId: string,
    patch: Partial<Midia>,
    categoriaId?: string,
  ): Promise<void> {
    const sanitized = this.semUndefined({
      ...patch,
      atualizadoEm: serverTimestamp() as unknown as Timestamp,
    });
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, midiaId, categoriaId), sanitized),
    );
  }

  /**
   * Remove chaves com valor `undefined`. O Firestore lança erro nesses casos
   * ("Function ... called with invalid data. Unsupported field value: undefined").
   * Para "limpar" um campo via update use `null` ou `deleteField()`.
   */
  private semUndefined<T extends object>(obj: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = v;
    }
    return out as T;
  }

  /** Remove o documento + arquivos do Storage (se houver). */
  async remover(campeonatoId: string, midia: Midia, categoriaId?: string): Promise<void> {
    const id = midia.id;
    if (!id) return;
    if (midia.arquivoPath) {
      try { await this.storage.remove(midia.arquivoPath); } catch { /* ignore */ }
    }
    if (midia.capaPath) {
      try { await this.storage.remove(midia.capaPath); } catch { /* ignore */ }
    }
    await runInInjectionContext(this.injector, () => deleteDoc(this.docRef(campeonatoId, id, categoriaId)));
  }

  /**
   * Faz upload de uma imagem/vídeo da galeria e retorna o path + url.
   * Path canônico: `users/{uid}/campeonatos/{id}/[categorias/{catId}/]midias/{ts}-{nome}`.
   */
  async uploadArquivo(
    campeonatoId: string,
    file: File,
    categoriaId?: string,
  ): Promise<{ url: string; path: string }> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Usuário não autenticado.');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const subpath = categoriaId
      ? `campeonatos/${campeonatoId}/categorias/${categoriaId}/midias`
      : `campeonatos/${campeonatoId}/midias`;
    const path = `users/${uid}/${subpath}/${Date.now()}-${safe}`;
    const url = await this.storage.upload(path, file);
    return { url, path };
  }

  /** Extrai o id de um link do YouTube (suporta youtu.be, watch?v=, shorts, embed). */
  static parseYoutubeId(input: string): string | null {
    if (!input) return null;
    const url = input.trim();
    const patterns = [
      /youtu\.be\/([A-Za-z0-9_-]{6,})/,
      /youtube\.com\/watch\?[^#]*v=([A-Za-z0-9_-]{6,})/,
      /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    if (/^[A-Za-z0-9_-]{6,}$/.test(url)) return url;
    return null;
  }

  /**
   * Mede a duração (em segundos) de um arquivo de vídeo no client, lendo só
   * os metadados. Retorna 0 se não conseguir ler — nesse caso o chamador NÃO
   * deve bloquear o upload (evita travar por falha de leitura do navegador).
   */
  static medirDuracaoVideo(file: File): Promise<number> {
    return new Promise<number>((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          resolve(Number.isFinite(v.duration) ? v.duration : 0);
        };
        v.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
        v.src = url;
      } catch {
        resolve(0);
      }
    });
  }
}
