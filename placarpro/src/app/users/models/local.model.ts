import { Timestamp } from '@angular/fire/firestore';

export interface Local {
  id?: string;
  ownerId: string;
  nome: string;
  /** Rua/Logradouro (sem número). */
  endereco?: string;
  /** Número do imóvel (separado pra preencher pelo autocomplete OSM). */
  numero?: string;
  cidade?: string;
  capacidade?: number;
  observacoes?: string;
  /** Foto do local (URL pública do Firebase Storage). */
  fotoUrl?: string;
  criadoEm?: Timestamp;
}
