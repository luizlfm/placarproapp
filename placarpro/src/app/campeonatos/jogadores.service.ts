import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  deleteField,
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
import {
  Jogador,
  JogadorPrivado,
  NovoJogadorInput,
  CAMPOS_PII_JOGADOR,
} from './models/jogador.model';
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

  /** Doc PRIVADO de PII do jogador: `jogadores/{id}/privado/dados`.
   *  Legível só por dono/moderador (ver Firestore Rules) — nunca público. */
  private piiRef(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
  ): DocumentReference<JogadorPrivado> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores', jogadorId,
      'privado', 'dados',
    ) as DocumentReference<JogadorPrivado>;
  }

  /**
   * Separa um input de jogador em { publico, privado }.
   * Os campos PII (cpf/rg/dataNascimento/telefone/documento) vão pro objeto
   * `privado`; o resto fica no `publico`. Usado na escrita pra garantir que
   * dado sensível NUNCA entre no doc público (legível em campeonatos públicos).
   */
  private separarPii<T extends Record<string, unknown>>(
    input: T,
  ): { publico: Record<string, unknown>; privado: JogadorPrivado; temPii: boolean } {
    const publico: Record<string, unknown> = {};
    const privado: Record<string, unknown> = {};
    let temPii = false;
    const piiKeys = CAMPOS_PII_JOGADOR as readonly string[];
    for (const [k, v] of Object.entries(input)) {
      // `inscricaoToken` e `equipeId` são campos de AUTORIZAÇÃO: as Firestore
      // Rules validam o token de inscrição contra o equipeId DENTRO do próprio
      // subdoc privado (não dá pra ler o doc pai via get() porque, na criação
      // pública, pai e subdoc são gravados no MESMO batch). Por isso ambos vão
      // pros DOIS lados (público + privado). NÃO são PII nem dado de negócio.
      if (k === 'inscricaoToken' || k === 'equipeId') {
        if (v !== undefined) { publico[k] = v; privado[k] = v; }
        continue;
      }
      if (piiKeys.includes(k)) {
        if (v !== undefined) { privado[k] = v; temPii = true; }
      } else {
        publico[k] = v;
      }
    }
    return { publico, privado: privado as JogadorPrivado, temPii };
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
   * Lê os dados PII (cpf/rg/dataNascimento/telefone) do jogador — APENAS pra
   * telas ADMIN (dono/moderador). Vem da subcoleção privada
   * `jogadores/{id}/privado/dados`. Stream reativo.
   *
   * Retrocompat: se o subdoc privado ainda não existir (jogador antigo, antes
   * da migração), o chamador deve cair pros campos legados do doc público.
   */
  getPrivado$(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
  ): Observable<JogadorPrivado | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.piiRef(campeonatoId, categoriaId, jogadorId)) as Observable<JogadorPrivado | undefined>,
    );
  }

  /**
   * Enriquece uma lista de jogadores (docs públicos) com a PII do subdoc
   * privado — pra telas ADMIN que precisam de CPF/RG/nascimento/telefone
   * (carteirinhas, impressão, relatórios). Faz 1 leitura por jogador, em
   * paralelo. Fallback retrocompat: jogador sem subdoc privado mantém o que
   * já tiver no doc público (não migrado). Só dono/moderador consegue ler o
   * subdoc — pra espectador/público as leituras falham e caem no fallback.
   */
  async enriquecerComPii(
    campeonatoId: string,
    categoriaId: string,
    jogadores: Jogador[],
  ): Promise<Jogador[]> {
    return runInInjectionContext(this.injector, async () => {
      const out = await Promise.all(
        jogadores.map(async (j) => {
          if (!j.id) return j;
          try {
            const pii = await this.getPrivadoOnce(campeonatoId, categoriaId, j.id);
            if (!pii) return j;
            return { ...j, ...stripUndefined(pii as Record<string, unknown>) } as Jogador;
          } catch {
            return j;
          }
        }),
      );
      return out;
    });
  }

  /** Versão one-shot (Promise) do getPrivado$ — pra forms que carregam 1x. */
  async getPrivadoOnce(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
  ): Promise<JogadorPrivado | undefined> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDoc(this.piiRef(campeonatoId, categoriaId, jogadorId));
      return snap.exists() ? (snap.data() as JogadorPrivado) : undefined;
    });
  }

  /**
   * Carrega o jogador COMPLETO (público + PII) pra edição em telas admin.
   * Faz merge: pega o doc público e sobrepõe os campos PII do subdoc privado.
   * Fallback retrocompat: se não houver subdoc privado, usa os campos PII que
   * ainda estiverem no doc público (jogadores não migrados).
   */
  async getCompletoParaEdicao(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
  ): Promise<Jogador | undefined> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDoc(this.docRef(campeonatoId, categoriaId, jogadorId));
      if (!snap.exists()) return undefined;
      const base = { id: snap.id, ...(snap.data() as Jogador) };
      const pii = await this.getPrivadoOnce(campeonatoId, categoriaId, jogadorId);
      if (pii) {
        // Subdoc privado é a fonte de verdade dos campos sensíveis.
        return { ...base, ...stripUndefined(pii as Record<string, unknown>) } as Jogador;
      }
      return base;
    });
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

      // Separa PII (cpf/rg/etc) → vai pro subdoc privado, NUNCA no doc público.
      const { publico, privado, temPii } = this.separarPii({
        ...input,
        // Convenção do sistema: nome SEMPRE em maiúsculas.
        nome: (input.nome ?? '').trim().toUpperCase(),
      });

      const payload = stripUndefined({
        ...publico,
        campeonatoId,
        categoriaId,
        cadastradoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      });
      const batch = writeBatch(this.fs);
      batch.set(newRef as DocumentReference, payload);
      if (temPii) {
        batch.set(this.piiRef(campeonatoId, categoriaId, newRef.id), stripUndefined({
          ...(privado as Record<string, unknown>),
          atualizadoEm: serverTimestamp(),
        }) as JogadorPrivado);
      }
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
          // Separa PII → subdoc privado (não vaza em campeonato público).
          const { publico, privado, temPii } = this.separarPii({ ...j });
          const payload = stripUndefined({
            ...publico,
            campeonatoId,
            categoriaId,
            cadastradoEm: serverTimestamp() as unknown as Timestamp,
            atualizadoEm: serverTimestamp() as unknown as Timestamp,
          });
          batch.set(newRef as DocumentReference, payload);
          if (temPii) {
            batch.set(this.piiRef(campeonatoId, categoriaId, newRef.id), stripUndefined({
              ...(privado as Record<string, unknown>),
              atualizadoEm: serverTimestamp(),
            }) as JogadorPrivado);
          }
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

      // Separa PII do patch: público vai pro doc, sensível pro subdoc privado.
      const { publico, privado, temPii } = this.separarPii({ ...patch });
      // Se o patch mexe em PII, também garante a REMOÇÃO de qualquer resíduo
      // legado desses campos no doc público (jogadores não migrados).
      const limpezaLegado: Record<string, unknown> = {};
      if (temPii) {
        for (const k of CAMPOS_PII_JOGADOR) {
          if (k in privado) limpezaLegado[k] = deleteField();
        }
      }

      const novaEquipeId = patch.equipeId;
      const batch = writeBatch(this.fs);

      batch.update(ref, stripUndefined({
        ...publico,
        ...limpezaLegado,
        atualizadoEm: serverTimestamp(),
      }));

      if (temPii) {
        batch.set(this.piiRef(campeonatoId, categoriaId, jogadorId), stripUndefined({
          ...(privado as Record<string, unknown>),
          atualizadoEm: serverTimestamp(),
        }), { merge: true });
      }

      if (novaEquipeId) {
        // Possível transferência entre equipes — ajusta contadores.
        const snap = await getDoc(ref);
        const antigaEquipeId = (snap.data() as Jogador | undefined)?.equipeId;
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
      }

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
      // Remove também o subdoc privado de PII (se existir).
      batch.delete(this.piiRef(campeonatoId, categoriaId, jogadorId));
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
