import { RachaEvento, RachaPartida } from './models/racha.model';

/**
 * Stats agregadas de um jogador a partir dos eventos das partidas.
 * Usado por Mercado de Notas, Conquistas e Ranking pra evitar duplicação.
 */
export interface StatsJogador {
  jogadorId: string;
  gols: number;
  assistencias: number;
  amarelos: number;
  vermelhos: number;
  azuis: number;
  /** Total de cartões (qualquer cor). */
  cartoes: number;
  /** Quantas partidas o jogador participou (apareceu em ≥1 evento). */
  jogos: number;
  /** Quantos hat-tricks (3+ gols numa mesma partida). */
  hatTricks: number;
}

/**
 * Agrega estatísticas de um jogador a partir de TODOS os eventos do racha
 * e da lista de partidas (pra contar `jogos` corretamente — partida sem
 * evento não conta como jogo do jogador).
 *
 * Complexidade: O(N) sobre eventos + O(M) sobre partidas. Pra rachas
 * típicos (<10k eventos) é trivial; pra escalar, considere agregação
 * via Cloud Function denormalizando direto no doc do jogador.
 */
export function computarStatsJogador(
  jogadorId: string,
  eventos: RachaEvento[],
  _partidas: RachaPartida[],
): StatsJogador {
  let gols = 0;
  let assistencias = 0;
  let amarelos = 0;
  let vermelhos = 0;
  let azuis = 0;
  // partidaId → contagem de gols pra detectar hat-trick.
  const golsPorPartida = new Map<string, number>();
  // Set de partidaIds em que o jogador apareceu (eventos próprios ou assist).
  const partidasJogadas = new Set<string>();

  for (const ev of eventos) {
    const partidaId = (ev as RachaEvento & { partidaId?: string }).partidaId ?? '';

    if (ev.jogadorId === jogadorId) {
      partidasJogadas.add(partidaId);
      switch (ev.tipo) {
        case 'gol':
          gols++;
          golsPorPartida.set(partidaId, (golsPorPartida.get(partidaId) ?? 0) + 1);
          break;
        case 'amarelo':   amarelos++; break;
        case 'vermelho':  vermelhos++; break;
        case 'azul':      azuis++; break;
        case 'penalti':   gols++; break; // pênalti convertido = gol
        case 'assistencia': assistencias++; break;
      }
    }
    // Jogador também participou se foi creditado como assist em gol de outro.
    if (ev.tipo === 'gol' && ev.assistJogadorId === jogadorId) {
      assistencias++;
      partidasJogadas.add(partidaId);
    }
  }

  const hatTricks = Array.from(golsPorPartida.values()).filter(n => n >= 3).length;

  return {
    jogadorId,
    gols,
    assistencias,
    amarelos,
    vermelhos,
    azuis,
    cartoes: amarelos + vermelhos + azuis,
    jogos: partidasJogadas.size,
    hatTricks,
  };
}

/** Evento possivelmente enriquecido com o id da partida (vem do service). */
type EventoComPartida = RachaEvento & { partidaId?: string };

/** Dupla ofensiva: dois jogadores que combinaram em gols (gol + assistência). */
export interface DuplaGol {
  aId: string;
  bId: string;
  /** Quantos gols a dupla combinou (um assistiu o outro), em qualquer direção. */
  gols: number;
}

/** Companheiros de time: dois jogadores que jogaram juntos (mesmo time/partida). */
export interface DuplaJunta {
  aId: string;
  bId: string;
  /** Em quantas partidas apareceram juntos no mesmo time. */
  partidas: number;
}

/** Chave canônica (não-ordenada) pra um par de jogadores. */
function chavePar(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Duplas de GOL — pares de jogadores em que um assistiu o gol do outro.
 * Conta na direção combinada (par não-ordenado). Ordenado por gols desc.
 * Sinal mais confiável de "parça" porque não depende de escalação completa.
 */
export function computarDuplasGol(eventos: EventoComPartida[]): DuplaGol[] {
  const mapa = new Map<string, number>();
  for (const ev of eventos) {
    if (ev.tipo !== 'gol') continue;
    const goleador = ev.jogadorId;
    const assist = ev.assistJogadorId;
    if (!goleador || !assist || goleador === assist) continue;
    const k = chavePar(goleador, assist);
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return Array.from(mapa.entries())
    .map(([k, gols]) => {
      const [aId, bId] = k.split('|');
      return { aId, bId, gols } as DuplaGol;
    })
    .sort((a, b) => b.gols - a.gols);
}

/**
 * Companheiros de time — pares que apareceram juntos no MESMO time numa
 * partida. Agrupa eventos por (partida, time) e conta os pares. Só usa
 * eventos com `timeId` definido (pra não parear adversários). Ordenado desc.
 */
export function computarCompanheiros(eventos: EventoComPartida[]): DuplaJunta[] {
  // (partidaId#timeId) → set de jogadorIds daquele time naquela partida
  const grupos = new Map<string, Set<string>>();
  for (const ev of eventos) {
    if (!ev.timeId || !ev.jogadorId) continue;
    const key = `${ev.partidaId ?? ''}#${ev.timeId}`;
    let set = grupos.get(key);
    if (!set) { set = new Set<string>(); grupos.set(key, set); }
    set.add(ev.jogadorId);
    // O assistente também estava nesse time naquela partida.
    if (ev.assistJogadorId) set.add(ev.assistJogadorId);
  }
  const pares = new Map<string, number>();
  for (const set of grupos.values()) {
    const ids = Array.from(set);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = chavePar(ids[i], ids[j]);
        pares.set(k, (pares.get(k) ?? 0) + 1);
      }
    }
  }
  return Array.from(pares.entries())
    .map(([k, partidas]) => {
      const [aId, bId] = k.split('|');
      return { aId, bId, partidas } as DuplaJunta;
    })
    .sort((a, b) => b.partidas - a.partidas);
}

/**
 * Stats vazias — usado quando o jogador ainda não tem eventos registrados.
 * Mantém shape consistente pros consumidores não precisarem de null-check.
 */
export function statsZero(jogadorId: string): StatsJogador {
  return {
    jogadorId,
    gols: 0,
    assistencias: 0,
    amarelos: 0,
    vermelhos: 0,
    azuis: 0,
    cartoes: 0,
    jogos: 0,
    hatTricks: 0,
  };
}
