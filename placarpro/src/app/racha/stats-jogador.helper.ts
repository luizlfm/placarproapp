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
