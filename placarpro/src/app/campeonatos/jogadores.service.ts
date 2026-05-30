import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  docData,
  getCountFromServer,
  getDoc,
  increment,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Jogador, NovoJogadorInput } from './models/jogador.model';
import { PlanosService } from '../users/planos.service';

/**
 * Erro lançado quando o cadastro de jogadores excederia o limite
 * `maxJogadoresPorCategoria` do plano do DONO do campeonato. Os componentes
 * podem checar `instanceof LimiteExcedidoError` pra mostrar uma mensagem
 * amigável de "faça upgrade".
 */
export class LimiteExcedidoError extends Error {
  constructor(message: string, readonly max: number, readonly atual: number) {
    super(message);
    this.name = 'LimiteExcedidoError';
  }
}

@Injectable({ providedIn: 'root' })
export class JogadoresService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly planosSrv = inject(PlanosService);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Jogador> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores',
    ) as CollectionReference<Jogador>;
  }

  private docRef(campeonatoId: string, categoriaId: string, jogadorId: string): DocumentReference<Jogador> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores', jogadorId,
    ) as DocumentReference<Jogador>;
  }

  private equipeRef(campeonatoId: string, categoriaId: string, equipeId: string): DocumentReference {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipes', equipeId,
    );
  }

  /** Todos os jogadores da categoria. */
  list$(campeonatoId: string, categoriaId: string): Observable<Jogador[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('nome', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<Jogador[]>;
    });
  }

  /** Apenas os jogadores de uma equipe. */
  listPorEquipe$(campeonatoId: string, categoriaId: string, equipeId: string): Observable<Jogador[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col(campeonatoId, categoriaId),
        where('equipeId', '==', equipeId),
        orderBy('nome', 'asc'),
      );
      return collectionData(q, { idField: 'id' }) as Observable<Jogador[]>;
    });
  }

  get$(campeonatoId: string, categoriaId: string, jogadorId: string): Observable<Jogador | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, categoriaId, jogadorId), { idField: 'id' }) as Observable<Jogador | undefined>,
    );
  }

  /**
   * Limite de jogadores POR CATEGORIA do plano do DONO do campeonato.
   * Retorna -1 (ilimitado) quando não há dono identificável.
   */
  private async limiteJogadoresPorCategoria(campeonatoId: string): Promise<number> {
    const campSnap = await getDoc(doc(this.fs, 'campeonatos', campeonatoId));
    const ownerId = (campSnap.data() as { ownerId?: string } | undefined)?.ownerId;
    if (!ownerId) return -1;
    const userSnap = await getDoc(doc(this.fs, 'users', ownerId));
    const plano = (userSnap.data() as { plano?: string } | undefined)?.plano;
    return this.planosSrv.getPlanoDef(plano).limites.maxJogadoresPorCategoria;
  }

  /**
   * Bloqueia o cadastro se ele estourar o limite de jogadores por categoria
   * do plano do dono. Checagem feita ANTES de qualquer escrita (sem cadastro
   * parcial). Lança `LimiteExcedidoError`.
   */
  private async assertLimiteJogadores(
    campeonatoId: string,
    categoriaId: string,
    novos: number,
  ): Promise<void> {
    // Fail-open: se não der pra resolver plano/contagem (ex.: regras de
    // segurança bloqueiam a leitura num fluxo público), NÃO bloqueia o
    // cadastro — só uma falha de validação não deve impedir a operação.
    let max: number;
    try {
      max = await this.limiteJogadoresPorCategoria(campeonatoId);
    } catch {
      return;
    }
    if (max === -1) return; // ilimitado

    let atual: number;
    try {
      const snap = await getCountFromServer(this.col(campeonatoId, categoriaId));
      atual = snap.data().count;
    } catch {
      return;
    }

    if (atual + novos > max) {
      throw new LimiteExcedidoError(
        `Limite de ${max} jogadores por categoria atingido no plano atual. ` +
          `Faça upgrade do plano pra cadastrar mais.`,
        max,
        atual,
      );
    }
  }

  async criar(campeonatoId: string, categoriaId: string, input: NovoJogadorInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      await this.assertLimiteJogadores(campeonatoId, categoriaId, 1);
      const newRef = doc(this.col(campeonatoId, categoriaId));
      const payload: Jogador = stripUndefined({
        ...input,
        // Convenção do sistema: nome de jogador SEMPRE em maiúsculas
        // (consistência visual em listas, súmulas, escalações, públicas).
        nome: (input.nome ?? '').trim().toUpperCase(),
        campeonatoId,
        categoriaId,
        cadastradoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }) as Jogador;
      const batch = writeBatch(this.fs);
      batch.set(newRef, payload);
      batch.update(this.equipeRef(campeonatoId, categoriaId, input.equipeId), {
        totalJogadores: increment(1),
        atualizadoEm: serverTimestamp(),
      });
      await batch.commit();
      return newRef.id;
    });
  }

  /**
   * Cria múltiplos jogadores em batch. Ajusta totalJogadores das equipes
   * envolvidas via increment. Lotes de 400 (limite do batch é 500).
   */
  async criarEmLote(
    campeonatoId: string,
    categoriaId: string,
    jogadores: NovoJogadorInput[],
  ): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      if (jogadores.length === 0) return 0;
      await this.assertLimiteJogadores(campeonatoId, categoriaId, jogadores.length);
      const tamanho = 400;
      let total = 0;
      for (let i = 0; i < jogadores.length; i += tamanho) {
        const lote = jogadores.slice(i, i + tamanho);
        const batch = writeBatch(this.fs);
        const contadorPorEquipe = new Map<string, number>();
        for (const j of lote) {
          const newRef = doc(this.col(campeonatoId, categoriaId));
          const payload: Jogador = stripUndefined({
            ...j,
            campeonatoId,
            categoriaId,
            cadastradoEm: serverTimestamp() as unknown as Timestamp,
            atualizadoEm: serverTimestamp() as unknown as Timestamp,
          }) as Jogador;
          batch.set(newRef, payload);
          contadorPorEquipe.set(j.equipeId, (contadorPorEquipe.get(j.equipeId) ?? 0) + 1);
        }
        contadorPorEquipe.forEach((qtd, equipeId) => {
          batch.update(this.equipeRef(campeonatoId, categoriaId, equipeId), {
            totalJogadores: increment(qtd),
            atualizadoEm: serverTimestamp(),
          });
        });
        await batch.commit();
        total += lote.length;
      }
      return total;
    });
  }

  async atualizar(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
    patch: Partial<Jogador>,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.docRef(campeonatoId, categoriaId, jogadorId);
      const novaEquipeId = patch.equipeId;
      if (novaEquipeId) {
        // Possível transferência entre equipes — ajusta contadores.
        const snap = await getDoc(ref);
        const antigaEquipeId = (snap.data() as Jogador | undefined)?.equipeId;
        const batch = writeBatch(this.fs);
        batch.update(ref, stripUndefined({
          ...patch,
          atualizadoEm: serverTimestamp(),
        }));
        if (antigaEquipeId && antigaEquipeId !== novaEquipeId) {
          batch.update(this.equipeRef(campeonatoId, categoriaId, antigaEquipeId), {
            totalJogadores: increment(-1),
            atualizadoEm: serverTimestamp(),
          });
          batch.update(this.equipeRef(campeonatoId, categoriaId, novaEquipeId), {
            totalJogadores: increment(1),
            atualizadoEm: serverTimestamp(),
          });
        }
        await batch.commit();
        return;
      }
      const batch = writeBatch(this.fs);
      batch.update(ref, stripUndefined({
        ...patch,
        atualizadoEm: serverTimestamp(),
      }));
      await batch.commit();
    });
  }

  /**
   * Lista jogadores de uma equipe (versão SEM orderBy para evitar
   * exigência de índice composto enquanto o índice está sendo construído).
   * O componente faz a ordenação por nome no client.
   */
  listPorEquipeSemIndex$(
    campeonatoId: string,
    categoriaId: string,
    equipeId: string,
  ): Observable<Jogador[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), where('equipeId', '==', equipeId));
      return collectionData(q, { idField: 'id' }) as Observable<Jogador[]>;
    });
  }

  async remover(campeonatoId: string, categoriaId: string, jogadorId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.docRef(campeonatoId, categoriaId, jogadorId);
      const snap = await getDoc(ref);
      const equipeId = (snap.data() as Jogador | undefined)?.equipeId;
      const batch = writeBatch(this.fs);
      batch.delete(ref);
      if (equipeId) {
        batch.update(this.equipeRef(campeonatoId, categoriaId, equipeId), {
          totalJogadores: increment(-1),
          atualizadoEm: serverTimestamp(),
        });
      }
      await batch.commit();
    });
  }
}

/**
 * Remove chaves cujo valor é `undefined`.
 * Firestore rejeita undefined em set/update e dispara
 * `Unsupported field value: undefined`.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
