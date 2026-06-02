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
  /** Campo LEGADO — antes guardava "CPF / RG" combinados. Mantido pra
   *  retrocompatibilidade com docs antigos do Firestore. Novos cadastros
   *  preferem `cpf` e `rg` separados. Pode ser preenchido a partir
   *  desses dois pra retro-compat em listagens. */
  documento?: string;
  /** CPF formatado: `123.456.789-00`. */
  cpf?: string;
  /** RG / DOC. IDENTIDADE. Aceita formato CNH ("MG14967119 SSP MG"). */
  rg?: string;
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
      'apelido' | 'posicao' | 'numeroCamisa' | 'documento' | 'cpf' | 'rg' |
      'dataNascimento' | 'telefone' | 'fotoUrl'
    >
  >;

/**
 * Campos PII (dados pessoais sensíveis) do jogador, armazenados numa
 * subcoleção PRIVADA `jogadores/{id}/privado/dados` — legível só por
 * dono/moderador autenticado, NUNCA público. Isso evita vazar CPF/RG de
 * terceiros em campeonatos públicos (LGPD).
 *
 * O documento PÚBLICO `jogadores/{id}` mantém só dados não-sensíveis
 * (nome, apelido, posição, número, foto, estatísticas).
 */
export interface JogadorPrivado {
  cpf?: string;
  rg?: string;
  dataNascimento?: string;
  telefone?: string;
  /** Campo legado combinado "CPF / RG". */
  documento?: string;
  atualizadoEm?: Timestamp;
}

/** Lista das chaves PII — fonte única de verdade pra separar público/privado. */
export const CAMPOS_PII_JOGADOR = [
  'cpf', 'rg', 'dataNascimento', 'telefone', 'documento',
] as const;
