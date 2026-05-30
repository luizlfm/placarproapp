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
  getDoc,
  getDocs,
  increment,
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
  /**
   * Tempo máximo (em ms) desde o último ping da transmissão antes de
   * considerá-la ZUMBI (e portanto NÃO ativa pra UI). Sessões inativas
   * por mais que isso são tratadas como encerradas mesmo com `ativa: true`
   * no Firestore — evita o bug de "TRANSMITINDO" pra sempre quando o
   * broadcaster fechou o app sem clicar em Encerrar.
   *
   * 3 minutos = balança entre tolerância a reconexões temporárias e
   * evitar mostrar uma transmissão fantasma por horas.
   */
  private readonly TIMEOUT_ULTIMO_PING_MS = 3 * 60 * 1000;

  ativa$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<Transmissao | null> {
    if (!campeonatoId || !categoriaId || !jogoId) return of(null);
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col(campeonatoId, categoriaId, jogoId),
        where('ativa', '==', true),
        limit(1),
      );
      return (collectionData(q, { idField: 'id' }) as Observable<Transmissao[]>).pipe(
        map(list => {
          const t = list[0];
          if (!t) return null;
          // Filtro anti-zumbi: se ultimoPing é antigo demais, a
          // transmissão provavelmente foi abandonada (broadcaster
          // fechou app sem encerrar). Auto-encerra em background +
          // retorna null pra UI.
          if (this.estaZumbi(t)) {
            this.encerrarZumbi(campeonatoId, categoriaId, jogoId, t.id!);
            return null;
          }
          return t;
        }),
        // Erros do Firestore (índice ausente/em construção, rules, rede)
        // NÃO podem derrubar a UI inteira. Sem este catch, qualquer falha
        // transitória deixava o template em estado indefinido (nem player,
        // nem empty state — só fundo preto). Emitir `null`
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

  /** True quando `ultimoPing` da transmissão é mais antigo que o limite. */
  private estaZumbi(t: Transmissao): boolean {
    const ultimoPing = (t.ultimoPing as { toMillis?: () => number } | undefined)?.toMillis?.();
    if (!ultimoPing) return false; // sem ping = recém-criada, dá margem
    const agora = Date.now();
    return (agora - ultimoPing) > this.TIMEOUT_ULTIMO_PING_MS;
  }

  /**
   * Encerra automaticamente uma transmissão zumbi em background.
   * Best-effort — falhas são silenciosas (não bloqueiam a UI).
   */
  private encerrarZumbi(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    transmissaoId: string,
  ): void {
    this.encerrar(campeonatoId, categoriaId, jogoId, transmissaoId).catch(err => {
      console.warn('[TransmissoesService] auto-encerrar zumbi falhou', err);
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

  /**
   * Reserva +1 "hora-crédito" de transmissão para o jogo:
   *  - incrementa `jogo.horasTransmissaoPagas` (libera mais 1 bloco de tempo)
   *  - debita 1 `transmissoesExtras` do DONO do campeonato
   *
   * Débito do crédito: a regra do Firestore só deixa o PRÓPRIO dono (ou
   * admin) escrever em `users/{ownerId}`. Por isso, quando o broadcaster é
   * o dono (`meuUid === ownerId`), debitamos de fato; quando é um moderador,
   * o tempo é liberado (incrementa horas pagas) mas o débito do crédito fica
   * pendente de reconciliação pelo admin (best-effort).
   *
   * NOTA: pra cobrança robusta (moderadores, anti-fraude) o ideal é uma
   * Cloud Function callable. Esta versão client-side cobre o caso comum
   * (organizador transmitindo).
   *
   * @returns 'ok' | 'sem-creditos' | 'erro'
   */
  async reservarHoraTransmissao(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    ownerId: string,
    meuUid: string | null,
  ): Promise<'ok' | 'sem-creditos' | 'erro'> {
    return runInInjectionContext(this.injector, async () => {
      try {
        // Gate: o dono tem saldo? (leitura permitida pra signed-in).
        const userRef = doc(this.fs, 'users', ownerId);
        const snap = await getDoc(userRef);
        const saldo = (snap.data()?.['transmissoesExtras'] as number | undefined) ?? 0;
        if (saldo <= 0) return 'sem-creditos';

        // Libera mais um bloco de tempo no jogo (owner/moderador podem escrever).
        const jogoRef = doc(
          this.fs, 'campeonatos', campeonatoId, 'categorias', categoriaId, 'jogos', jogoId,
        );
        // Na 1ª reserva (baseline ainda não definido), grava o tempo já
        // acumulado como baseline — assim o tempo legado/anterior NÃO
        // consome o crédito recém-reservado.
        const jogoSnap = await getDoc(jogoRef);
        const baseAtual = jogoSnap.data()?.['transmissaoSegundosBase'] as number | undefined | null;
        const update: Record<string, unknown> = {
          horasTransmissaoPagas: increment(1),
          atualizadoEm: serverTimestamp(),
        };
        if (baseAtual === undefined || baseAtual === null) {
          update['transmissaoSegundosBase'] = await this.tempoTotalAtual(campeonatoId, categoriaId, jogoId);
        }
        await updateDoc(jogoRef, update);

        // Debita o crédito do dono — só quando EU sou o dono (regra isSelf).
        if (meuUid && meuUid === ownerId) {
          await updateDoc(userRef, { transmissoesExtras: increment(-1) }).catch(err => {
            console.warn('[Transmissao] débito de crédito falhou (best-effort)', err);
          });
        } else {
          console.info('[Transmissao] broadcaster não é o dono — débito de crédito pendente de reconciliação.');
        }
        return 'ok';
      } catch (err) {
        console.error('[Transmissao] reservarHoraTransmissao falhou', err);
        return 'erro';
      }
    });
  }

  /** Soma (one-shot) do `duracaoSegundos` de todas as sessões do jogo. */
  private async tempoTotalAtual(campeonatoId: string, categoriaId: string, jogoId: string): Promise<number> {
    const snap = await getDocs(this.col(campeonatoId, categoriaId, jogoId));
    let total = 0;
    snap.forEach(d => { total += (d.data() as Transmissao).duracaoSegundos ?? 0; });
    return total;
  }

  /**
   * Gate de crédito ANTES de iniciar uma transmissão.
   *  - Se ainda há tempo dentro do orçamento já pago → 'ok' (não debita).
   *  - Senão, tenta reservar +1 bloco (debita 1 crédito do dono).
   *  - Sem crédito → 'sem-creditos'.
   *
   * Chamado no momento REAL do início (dentro do modal de broadcast), pra
   * o crédito só ser debitado quando a transmissão realmente começa.
   */
  async garantirTempoParaIniciar(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    ownerId: string,
    meuUid: string | null,
    limiteMin: number,
  ): Promise<'ok' | 'sem-creditos' | 'erro'> {
    return runInInjectionContext(this.injector, async () => {
      try {
        const total = await this.tempoTotalAtual(campeonatoId, categoriaId, jogoId);
        const jogoRef = doc(
          this.fs, 'campeonatos', campeonatoId, 'categorias', categoriaId, 'jogos', jogoId,
        );
        const jogoSnap = await getDoc(jogoRef);
        const horasPagas = (jogoSnap.data()?.['horasTransmissaoPagas'] as number | undefined) ?? 0;
        const base = (jogoSnap.data()?.['transmissaoSegundosBase'] as number | undefined) ?? 0;
        const consumido = Math.max(0, total - base);
        const orcamentoSeg = horasPagas * limiteMin * 60;
        if (orcamentoSeg > consumido) return 'ok'; // ainda tem tempo pago
        return await this.reservarHoraTransmissao(campeonatoId, categoriaId, jogoId, ownerId, meuUid);
      } catch (err) {
        console.error('[Transmissao] garantirTempoParaIniciar falhou', err);
        return 'erro';
      }
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
