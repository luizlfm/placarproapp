import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  collectionGroup,
  doc,
  docData,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of } from 'rxjs';
import {
  NovaTransmissaoInput,
  Transmissao,
} from './models/transmissao.model';

/**
 * CRUD + queries da coleção de transmissões ao vivo.
 *
 * Path:
 *   `campeonatos/{campeonatoId}/categorias/{categoriaId}/jogos/{jogoId}/transmissoes/{transmissaoId}`
 *
 * Operações principais:
 *  - `iniciar()` — cria doc `ativa: true` quando broadcaster inicia. Retorna o ID.
 *  - `encerrar()` — seta `ativa: false` + `encerradoEm`.
 *  - `ativa$()` — Observable do doc ativo (ou null se nenhum ativo).
 *  - `historico$()` — todas as transmissões do jogo (incluindo encerradas).
 *
 * IMPORTANTE: A criação/encerramento são feitas DIRETAMENTE pelo client
 * porque ele tem o `broadcasterUid` autenticado. As Firestore Rules
 * validam permissão (só owner/moderador escreve). O token LiveKit em si
 * vem da Cloud Function — esse path é puramente metadata.
 */
@Injectable({ providedIn: 'root' })
export class TransmissoesService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string, jogoId: string): CollectionReference<Transmissao> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos', jogoId,
      'transmissoes',
    ) as CollectionReference<Transmissao>;
  }

  private docRef(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    transmissaoId: string,
  ): DocumentReference<Transmissao> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos', jogoId,
      'transmissoes', transmissaoId,
    ) as DocumentReference<Transmissao>;
  }

  /**
   * Observable da transmissão ATIVA pra este jogo (se houver).
   *
   * Query intencionalmente SIMPLES (só `where ativa == true` + `limit`)
   * pra evitar precisar de índice COMPOSTO no Firestore — combinar `where`
   * com `orderBy` em campos diferentes exige índice composto e dá erro
   * "FAILED_PRECONDITION" quando não existe (o app só vê resultado vazio
   * em produção, sem feedback claro). Como normalmente só HÁ uma
   * transmissão ativa por jogo, ordenar é desnecessário aqui.
   *
   * Caso futuro tenhamos várias `ativa: true` (bug), usamos `limit(1)`
   * pra escolher uma e o broadcaster pode encerrar as duplicatas via
   * dashboard. O importante é que esta query NUNCA falha por falta de
   * índice — funciona out of the box logo após deploy das rules.
   *
   * Emite `null` se ninguém está transmitindo agora.
   */
  ativa$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<Transmissao | null> {
    if (!campeonatoId || !categoriaId || !jogoId) return of(null);
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col(campeonatoId, categoriaId, jogoId),
        where('ativa', '==', true),
        limit(1),
      );
      return (collectionData(q, { idField: 'id' }) as Observable<Transmissao[]>).pipe(
        map(list => list[0] ?? null),
        // Erros do Firestore (índice ausente/em construção, rules, rede)
        // NÃO podem derrubar a UI inteira. Sem este catch, qualquer falha
        // transitória deixava o template em estado indefinido (nem YouTube,
        // nem player, nem empty state — só fundo preto). Emitir `null`
        // mantém a página utilizável e o erro vai pro console pra debug.
        catchError(err => {
          console.warn('[TransmissoesService] ativa$ falhou — emitindo null', {
            campeonatoId, categoriaId, jogoId, err,
          });
          return of(null);
        }),
      );
    });
  }

  /**
   * Histórico completo de transmissões do jogo — ativas e encerradas,
   * ordenadas da mais recente pra mais antiga.
   */
  historico$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<Transmissao[]> {
    if (!campeonatoId || !categoriaId || !jogoId) return of([]);
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col(campeonatoId, categoriaId, jogoId),
        orderBy('iniciadoEm', 'desc'),
      );
      return collectionData(q, { idField: 'id' }) as Observable<Transmissao[]>;
    });
  }

  /**
   * Inicia uma transmissão — cria doc `ativa: true` E denormaliza a
   * flag `transmissaoLiveAtiva` no doc do campeonato pra a home pública
   * conseguir exibir "AO VIVO" + "Assistir" sem varrer subcoleções.
   *
   * Retorna o ID da transmissão.
   */
  async iniciar(input: NovaTransmissaoInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const ts = serverTimestamp() as unknown as Timestamp;
      const payload: Transmissao = {
        ...input,
        ativa: true,
        viewersAtuais: 0,
        viewersPico: 0,
        totalViewers: 0,
        // Contabilidade de tempo zerada nesta sessão. A Cloud Function
        // soma com sessões anteriores pra decidir quando descontar 1 crédito.
        duracaoSegundos: 0,
        ultimoPing: ts,
        descontou: false,
        iniciadoEm: ts,
        criadoEm: ts,
        atualizadoEm: ts,
      };
      const ref = await addDoc(
        this.col(input.campeonatoId, input.categoriaId, input.jogoId),
        payload,
      );

      // Denormaliza no doc do campeonato (best-effort — falha silenciosa
      // não impede o broadcast de funcionar).
      // IMPORTANTE: `serverTimestamp()` NÃO pode ser usado dentro de objetos
      // aninhados (Firestore rejeita ou ignora). Usamos `Timestamp.now()`
      // (cliente) — diferença de ~ms é desprezível pro caso de uso.
      const campRef = doc(this.fs, 'campeonatos', input.campeonatoId);
      const flagPayload = {
        transmissaoLiveAtiva: {
          jogoId: input.jogoId,
          categoriaId: input.categoriaId,
          transmissaoId: ref.id,
          broadcasterNome: input.broadcasterNome,
          iniciadoEm: Timestamp.now(),
        },
      };
      console.info('[TransmissoesService] denormalizando flag transmissaoLiveAtiva', {
        campeonatoId: input.campeonatoId,
        flag: flagPayload,
      });
      await updateDoc(campRef, flagPayload).catch(err => {
        console.error('[TransmissoesService] denormalização campeonato FALHOU', err);
      });

      return ref.id;
    });
  }

  /**
   * Encerra a transmissão — seta `ativa: false` + `encerradoEm` E LIMPA
   * a flag `transmissaoLiveAtiva` do campeonato (volta a NÃO ter live).
   * Broadcaster chama isso quando aperta "Parar" ou fecha o modal.
   */
  async encerrar(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    transmissaoId: string,
    duracaoSegundos?: number,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ts = serverTimestamp() as unknown as Timestamp;
      // Grava `duracaoSegundos` final se informado — o cliente conta os
      // segundos localmente (mais preciso que diff de timestamps porque
      // exclui tempo pausado/desconectado).
      const payload: Partial<Transmissao> = {
        ativa: false,
        encerradoEm: ts,
        atualizadoEm: ts,
      };
      if (typeof duracaoSegundos === 'number' && duracaoSegundos >= 0) {
        payload.duracaoSegundos = duracaoSegundos;
      }
      await updateDoc(this.docRef(campeonatoId, categoriaId, jogoId, transmissaoId), payload);

      // Limpa a flag no campeonato — best-effort.
      const campRef = doc(this.fs, 'campeonatos', campeonatoId);
      await updateDoc(campRef, {
        transmissaoLiveAtiva: null,
      }).catch(err => {
        console.warn('[TransmissoesService] limpeza flag campeonato falhou', err);
      });
    });
  }

  /**
   * Atualiza contadores de viewers — opcional, chamado quando o cliente
   * detecta entrada/saída de viewer via eventos do LiveKit Room.
   *
   * Pra simplicidade inicial, só guardamos o pico — em vez de manter
   * contagem em tempo real (que daria writes constantes no Firestore).
   * Se você quiser polling em tempo real depois, dá pra adicionar via
   * webhook do LiveKit numa Cloud Function.
   */
  async atualizarStats(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    transmissaoId: string,
    stats: { viewersAtuais?: number; viewersPico?: number; totalViewers?: number },
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(this.docRef(campeonatoId, categoriaId, jogoId, transmissaoId), {
        ...stats,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      });
    });
  }

  /** Observable de UMA transmissão específica — usado quando o broadcaster
   *  quer ver os stats da própria transmissão atual. */
  get$(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    transmissaoId: string,
  ): Observable<Transmissao | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, categoriaId, jogoId, transmissaoId), { idField: 'id' }) as Observable<Transmissao | undefined>,
    );
  }

  /**
   * Observable de TODAS as transmissões ATIVAS no sistema inteiro
   * (collectionGroup query). Usado pela home pública pra detectar quais
   * campeonatos têm broadcast acontecendo agora — independente de flag
   * denormalizada no campeonato (mais resiliente).
   *
   * ⚠️ Requer rule do Firestore permitindo collectionGroup read de
   * `transmissoes` pra anônimos. Em `firestore.rules` adicionar:
   *   match /{path=**}/transmissoes/{transmissaoId} {
   *     allow read: if true;
   *   }
   *
   * Cada item retornado contém `campeonatoId` (denormalizado no doc da
   * transmissão), então a home pública mapeia direto pro card correto.
   */
  /**
   * Heartbeat enviado pelo broadcaster a cada 30s — atualiza o tempo
   * decorrido (`duracaoSegundos`) e marca `ultimoPing`. Permite que a
   * Cloud Function some o tempo total da partida mesmo se o broadcaster
   * cair (os 30s mais recentes podem ser perdidos, aceitável).
   *
   * Best-effort: erros (rede, write rejeitado) NÃO interrompem o broadcast
   * — só logam pra debug. A pior consequência é não descontar crédito,
   * o que o admin master corrige manualmente.
   */
  async atualizarHeartbeat(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    transmissaoId: string,
    duracaoSegundos: number,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ts = serverTimestamp() as unknown as Timestamp;
      await updateDoc(this.docRef(campeonatoId, categoriaId, jogoId, transmissaoId), {
        duracaoSegundos,
        ultimoPing: ts,
        atualizadoEm: ts,
      }).catch(err => {
        console.warn('[TransmissoesService] heartbeat falhou — ignorando', err);
      });
    });
  }

  /**
   * Observable do TEMPO TOTAL acumulado de transmissão deste jogo —
   * soma `duracaoSegundos` de TODAS as transmissões (ativas + encerradas).
   *
   * Usado pra UI mostrar "1h45m de 2h30 consumidos" em tempo real, dando
   * transparência ao broadcaster sobre quando vai bater 1 crédito. A
   * decisão real de DESCONTAR o crédito acontece na Cloud Function
   * (server-side) — esta é só pra UX.
   */
  tempoTotalDoJogo$(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
  ): Observable<number> {
    if (!campeonatoId || !categoriaId || !jogoId) return of(0);
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId, jogoId));
      return (collectionData(q) as Observable<Transmissao[]>).pipe(
        map(list => list.reduce((acc, t) => acc + (t.duracaoSegundos ?? 0), 0)),
        catchError(err => {
          console.warn('[TransmissoesService] tempoTotalDoJogo$ falhou', err);
          return of(0);
        }),
      );
    });
  }

  todasAtivas$(): Observable<Transmissao[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(
        collectionGroup(this.fs, 'transmissoes'),
        where('ativa', '==', true),
      );
      return (collectionData(q, { idField: 'id' }) as Observable<Transmissao[]>).pipe(
        // Mesma proteção do `ativa$` — falha (índice em build, rules)
        // emite lista vazia em vez de derrubar a seção "Ao Vivo Agora"
        // da home pública.
        catchError(err => {
          console.warn('[TransmissoesService] todasAtivas$ falhou — emitindo []', err);
          return of([] as Transmissao[]);
        }),
      );
    });
  }
}
