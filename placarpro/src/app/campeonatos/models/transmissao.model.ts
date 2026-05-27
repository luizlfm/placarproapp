import { Timestamp } from '@angular/fire/firestore';

/**
 * Transmissão ao vivo de um jogo via LiveKit Cloud.
 *
 * Path Firestore:
 *   `campeonatos/{campeonatoId}/categorias/{categoriaId}/jogos/{jogoId}/transmissoes/{transmissaoId}`
 *
 * Convenção:
 *  - 1 jogo pode ter VÁRIAS transmissões ao longo do tempo (histórico).
 *  - Mas só UMA pode estar `ativa: true` por vez.
 *  - Quando o broadcaster encerra, seta `ativa: false` e `encerradoEm`.
 *
 * Nome da sala LiveKit = `jogo-{jogoId}` — determinístico, não usa o
 * `transmissaoId` (assim broadcaster que se reconecta entra na mesma sala
 * sem precisar coordenar via Firestore).
 */
export interface Transmissao {
  id?: string;

  /** ID do jogo no Firestore — usado pra montar `roomName`. */
  jogoId: string;
  /** Campeonato e categoria do jogo — denormalizado pra evitar joins. */
  campeonatoId: string;
  categoriaId: string;

  /**
   * UID do DONO do campeonato. Denormalizado aqui pra Cloud Function de
   * abate de crédito não precisar fazer `get` extra no doc do campeonato
   * a cada heartbeat. Setado uma vez na criação.
   */
  ownerId?: string;

  /** Nome da sala LiveKit (`jogo-<jogoId>`). Salva pra UI exibir / debug. */
  roomName: string;

  /** True enquanto o broadcaster está transmitindo. False quando encerra. */
  ativa: boolean;

  /** Quem está transmitindo (UID + nome). */
  broadcasterUid: string;
  broadcasterNome: string;

  /** Quando iniciou — preenchido com `serverTimestamp()` no `iniciar()`. */
  iniciadoEm?: Timestamp;
  /** Quando encerrou — preenchido só após `encerrar()`. */
  encerradoEm?: Timestamp;

  // ============ Contabilidade de tempo (heartbeat) ============
  /**
   * Tempo (em segundos) que ESTA sessão de transmissão durou. Atualizado
   * via heartbeat a cada 30s enquanto `ativa: true`. Permanece após
   * encerrar — usado pra somar o tempo total do jogo (ver
   * `tempoTotalDoJogo$` em TransmissoesService).
   */
  duracaoSegundos?: number;
  /** Último heartbeat recebido — usado pra inferir queda do broadcaster. */
  ultimoPing?: Timestamp;
  /**
   * `true` se a soma do tempo deste jogo passou de 2h30 nesta sessão e
   * a Cloud Function já decrementou 1 crédito do `ownerId`. Idempotência:
   * impede cobrar duas vezes o mesmo jogo se o broadcaster reconectar.
   *
   * Setado APENAS pela Cloud Function (Admin SDK) — nunca pelo client.
   */
  descontou?: boolean;

  // ============ Stats (denormalizado pra UI) ============
  /** Viewers conectados AGORA. Atualizado por webhook do LiveKit ou polling. */
  viewersAtuais?: number;
  /** Pico de viewers simultâneos durante a transmissão. */
  viewersPico?: number;
  /** Total acumulado de viewers únicos que conectaram. */
  totalViewers?: number;

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/** Input pro `iniciar()` — campos preenchidos pelo client (resto é server). */
export type NovaTransmissaoInput = Pick<
  Transmissao,
  'jogoId' | 'campeonatoId' | 'categoriaId' | 'roomName' | 'broadcasterUid' | 'broadcasterNome' | 'ownerId'
>;
