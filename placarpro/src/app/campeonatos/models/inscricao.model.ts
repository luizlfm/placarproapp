import { Timestamp } from '@angular/fire/firestore';

export type InscricaoStatus = 'pendente' | 'aprovada' | 'rejeitada';
export type InscricaoTipo = 'equipe' | 'jogador';

/** Jogador proposto numa inscrição de equipe. */
export interface InscricaoJogador {
  nome: string;
  apelido?: string;
  numeroCamisa?: string;
  posicao?: string;
  documento?: string;
  dataNascimento?: string;
}

/** Pedido de inscrição de uma equipe ou jogador num campeonato/categoria. */
export interface Inscricao {
  id?: string;
  campeonatoId: string;
  /** Categoria desejada — opcional, o admin pode designar depois. */
  categoriaId?: string;

  /** Tipo: inscrição de equipe completa ou jogador avulso. */
  tipo?: InscricaoTipo;

  /** Nome do time (se equipe) ou do jogador (se jogador individual). */
  nomeEquipe: string;
  /** Pessoa responsável (técnico/administrador). */
  responsavel: string;
  email?: string;
  telefone?: string;
  cidade?: string;

  /** Quantos jogadores planeja inscrever. */
  totalJogadores?: number;

  /** Lista de jogadores propostos (para inscrição de equipe). */
  jogadores?: InscricaoJogador[];

  /** Respostas dos campos customizados do formulário (chave = campoId). */
  respostas?: Record<string, string | string[] | number | boolean>;

  /** Texto livre / observações. */
  observacao?: string;

  status: InscricaoStatus;
  /** Mensagem de rejeição (se aplicável). */
  motivoRejeicao?: string;

  /** uid de quem criou o pedido (se foi pelo link público logado). */
  ownerId?: string;

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type NovaInscricaoInput = Omit<Inscricao, 'id' | 'status' | 'criadoEm' | 'atualizadoEm'>;
