import { Timestamp } from '@angular/fire/firestore';

/** Equipe inscrita em uma categoria. */
export interface Equipe {
  id?: string;
  campeonatoId: string;
  categoriaId: string;
  nome: string;
  /** Cidade/UF apresentado entre parênteses no nome. Ex: "(ARCOS/MG)". */
  cidade?: string;
  /** URL do escudo no Firebase Storage. */
  logoUrl?: string;
  /** Nome do técnico (exibição rápida; entidades em equipeTecnica/). */
  tecnico?: string;
  /** Telefone ou e-mail de contato preenchido na ficha de inscrição pública. */
  contato?: string;
  /** Nome do representante legal da equipe (assinatura). */
  representanteNome?: string;
  /** RG do representante legal da equipe. */
  representanteRg?: string;
  /** ID do grupo onde a equipe está. */
  grupoId?: string;
  /** Cor primária (para badges, customização). */
  cor?: string;
  totalJogadores?: number;
  /** Pontos descontados por punição. Subtraídos do total na classificação (coluna PE). */
  penalizacao?: number;
  /** Quando "Reordenar manual" está ativo, esse índice sobrescreve a ordem natural. */
  posicaoManual?: number;
  /** Token do convite público de inscrição (mais recente) associado à equipe.
   *  Permite ao admin "reabrir" a ficha pra edição sem precisar listar a
   *  coleção `convitesEquipe` (que tem `list: false` nas rules). */
  inscricaoToken?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type NovaEquipeInput = Pick<Equipe, 'nome'> &
  Partial<Pick<Equipe, 'cidade' | 'logoUrl' | 'tecnico' | 'grupoId' | 'cor'>>;
