import { Timestamp } from '@angular/fire/firestore';

export interface EnqueteAlternativa {
  id: string;
  texto: string;
  /** Total de votos (denormalizado). */
  votos?: number;
}

/** Enquete da categoria (`campeonatos/{id}/categorias/{catId}/enquetes/{enqId}`). */
export interface Enquete {
  id?: string;
  campeonatoId: string;
  categoriaId: string;
  pergunta: string;
  alternativas: EnqueteAlternativa[];

  /** Visível na visualização pública. */
  visivel: boolean;
  /** Mostrar resultado pros votantes. */
  mostrarResultado: boolean;
  /** Aceita votos. */
  votacaoAberta: boolean;
  /** Permitir mais de uma alternativa. */
  multiplaEscolha: boolean;

  /** Total de votos (denormalizado). */
  totalVotos?: number;

  ownerId?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type NovaEnqueteInput = Pick<Enquete, 'pergunta' | 'alternativas'> &
  Partial<Pick<Enquete, 'visivel' | 'mostrarResultado' | 'votacaoAberta' | 'multiplaEscolha'>>;

/** Voto de um usuário numa enquete. Doc id = uid (1 voto por usuário). */
export interface VotoEnquete {
  /** IDs das alternativas escolhidas. */
  alternativaIds: string[];
  criadoEm?: Timestamp;
}
