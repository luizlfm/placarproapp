import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

/**
 * Convite público vinculado a uma equipe específica. Quem tem o token
 * pode preencher o formulário de jogadores (página `/inscricao/:token`).
 * O token é gerado aleatoriamente (8 chars URL-safe).
 */
export interface ConviteEquipe {
  id?: string;             // = token (legível na URL)
  campeonatoId: string;
  categoriaId: string;
  equipeId: string;
  /** Nome da equipe (denormalizado pra evitar 1 fetch extra). */
  nomeEquipe?: string;
  /** Título do campeonato (denormalizado). */
  tituloCampeonato?: string;
  /** Subtítulo do campeonato (denormalizado). */
  subtituloCampeonato?: string;
  /** uid do admin que criou o convite (auditoria). */
  criadoPor: string;
  criadoEm?: Timestamp;
  /** uid do usuário que preencheu o form (preenche ao confirmar). */
  preenchidoPor?: string;
  preenchidoEm?: Timestamp;
  /** Se true, o link já foi usado — pode ser reaberto pelo admin. */
  usado?: boolean;
}

/** Snapshot de convite vinculado a um usuário (users/{uid}/meusConvites/{token}). */
export interface MeuConvite {
  id?: string;             // = token (igual ao convite raiz)
  token: string;
  campeonatoId: string;
  categoriaId: string;
  equipeId: string;
  nomeEquipe?: string;
  tituloCampeonato?: string;
  subtituloCampeonato?: string;
  vinculadoEm?: Timestamp;
}

@Injectable({ providedIn: 'root' })
export class ConvitesEquipeService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  /** Coleção raiz pública — acessível por token sem precisar do path completo. */
  private col(): CollectionReference<ConviteEquipe> {
    return collection(this.fs, 'convitesEquipe') as CollectionReference<ConviteEquipe>;
  }
  private docRef(token: string): DocumentReference<ConviteEquipe> {
    return doc(this.fs, 'convitesEquipe', token) as DocumentReference<ConviteEquipe>;
  }

  /** Gera um token de 8 caracteres URL-safe (alfanumérico). */
  private gerarToken(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 8; i++) {
      s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
  }

  /**
   * Cria (ou recupera) um convite para a equipe. Se já existir convite
   * NÃO usado, retorna o mesmo token. Se foi usado, cria um novo.
   */
  async criarOuRecuperar(
    campeonatoId: string,
    categoriaId: string,
    equipeId: string,
    criadoPor: string,
    nomeEquipe?: string,
    tituloCampeonato?: string,
    subtituloCampeonato?: string,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      // Tenta 5 vezes pra evitar colisão (extremamente raro)
      for (let tent = 0; tent < 5; tent++) {
        const token = this.gerarToken();
        const ref = this.docRef(token);
        const snap = await getDoc(ref);
        if (snap.exists()) continue;

        const payload: ConviteEquipe = {
          campeonatoId,
          categoriaId,
          equipeId,
          nomeEquipe,
          tituloCampeonato,
          subtituloCampeonato,
          criadoPor,
          criadoEm: serverTimestamp() as unknown as Timestamp,
        };
        await setDoc(ref, payload);
        return token;
      }
      throw new Error('Não foi possível gerar token único.');
    });
  }

  async getByToken(token: string): Promise<ConviteEquipe | undefined> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDoc(this.docRef(token));
      if (!snap.exists()) return undefined;
      return { id: snap.id, ...(snap.data() as ConviteEquipe) };
    });
  }

  /**
   * Cria um snapshot do convite na subcoleção do usuário, vinculando o
   * convite ao UID. Isso permite ao espectador ver "seus convites"
   * depois — sem precisar do link na URL.
   *
   *   /users/{uid}/meusConvites/{token}
   */
  async vincularAoUsuario(token: string, uid: string, convite: ConviteEquipe): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'users', uid, 'meusConvites', token);
      await setDoc(ref, {
        token,
        campeonatoId: convite.campeonatoId,
        categoriaId: convite.categoriaId,
        equipeId: convite.equipeId,
        nomeEquipe: convite.nomeEquipe ?? '',
        tituloCampeonato: convite.tituloCampeonato ?? '',
        subtituloCampeonato: convite.subtituloCampeonato ?? '',
        vinculadoEm: serverTimestamp(),
      }, { merge: true });
    });
  }

  /** Lista convites vinculados ao usuário (ordenados pelo mais recente). */
  listMeusConvites$(uid: string): Observable<MeuConvite[]> {
    return runInInjectionContext(this.injector, () => {
      const col = collection(this.fs, 'users', uid, 'meusConvites') as CollectionReference<MeuConvite>;
      const q = query(col, orderBy('vinculadoEm', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<MeuConvite[]>;
    });
  }

  /** Marca o convite como preenchido. */
  async marcarPreenchido(token: string, preenchidoPor: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(this.docRef(token), {
        preenchidoPor,
        preenchidoEm: serverTimestamp(),
        usado: true,
      });
    });
  }

  /**
   * Reabre um convite previamente marcado como `usado`. Só o dono do
   * campeonato pode chamar (Rules `convitesEquipe` allow update if isOwner).
   * Limpa `usado` e os campos de preenchimento; o link volta a aceitar
   * edição da ficha de inscrição.
   */
  async reabrirConvite(token: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(this.docRef(token), {
        usado: false,
        atualizadoEm: serverTimestamp(),
      });
    });
  }
}
