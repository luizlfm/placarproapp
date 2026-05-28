import { Timestamp } from '@angular/fire/firestore';

/**
 * Metadados de uma rodada dentro de uma fase. A rodada em si é representada
 * pelo campo `rodada` (número) em cada Jogo — este doc guarda extras: título
 * customizado, flag de oculta para seguidores, e se permite envio de
 * resultados pelos usuários (publicação após aprovação).
 *
 * Path: campeonatos/{id}/categorias/{catId}/rodadas/{rodadaId}
 * Identificado por `faseNome + numero` (procurar via query — docId é auto).
 */
export interface Rodada {
  id?: string;
  campeonatoId: string;
  categoriaId: string;
  /** Nome da fase (mesmo formato usado em Jogo.fase). */
  faseNome: string;
  /** Número da rodada dentro da fase. */
  numero: number;
  /** Título customizado. Quando vazio, UI exibe "{numero}ª Rodada". */
  titulo?: string;
  /** Esconde os jogos desta rodada para usuários seguidores. */
  oculta?: boolean;
  /** Permite usuários enviarem resultados (publicação só após aprovação). */
  permiteEnvioResultados?: boolean;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}
