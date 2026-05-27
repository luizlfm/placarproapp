import { Timestamp } from '@angular/fire/firestore';

/** Estatísticas manuais do jogador no campeonato. Valores podem ser
 *  recalculados a partir dos eventos dos jogos no futuro — por enquanto
 *  são editados manualmente na tela de jogador. */
export interface JogadorEstatisticas {
  gols?: number;
  jogos?: number;
  cartoesAmarelos?: number;
  cartoesVermelhos?: number;
  cartoesAzuis?: number;
  faltas?: number;
  assistencias?: number;
  /** Se true, o jogador é goleiro — exibe campo extra de gols tomados. */
  goleiro?: boolean;
  golsTomados?: number;
  /** Nota livre (ex.: "8.5" ou "Excelente"). */
  avaliacao?: string;
}

/** Período de suspensão de um jogador (datas em ISO YYYY-MM-DD). */
export interface JogadorSuspensao {
  inicio: string;
  fim?: string;
}

/** Jogador vinculado a uma equipe dentro de uma categoria. */
export interface Jogador {
  id?: string;
  campeonatoId: string;
  categoriaId: string;
  equipeId: string;
  nome: string;
  apelido?: string;
  /** Goleiro, Zagueiro, Meia, Atacante... livre. */
  posicao?: string;
  /** Número da camisa ou registro de inscrição. */
  numeroCamisa?: string;
  /** RG/CPF. */
  documento?: string;
  /** YYYY-MM-DD (ISO). */
  dataNascimento?: string;
  telefone?: string;
  fotoUrl?: string;
  /** Estatísticas (manuais) do jogador. */
  estatisticas?: JogadorEstatisticas;
  /** Suspensão ativa do jogador. */
  suspensao?: JogadorSuspensao;
  cadastradoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type NovoJogadorInput = Pick<Jogador, 'nome' | 'equipeId'> &
  Partial<
    Pick<
      Jogador,
      'apelido' | 'posicao' | 'numeroCamisa' | 'documento' | 'dataNascimento' | 'telefone' | 'fotoUrl'
    >
  >;
