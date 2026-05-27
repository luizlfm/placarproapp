import { Timestamp } from '@angular/fire/firestore';

export interface Arbitro {
  id?: string;
  ownerId: string;
  nome: string;
  documento?: string;
  telefone?: string;
  /** Federação/Associação que atua. */
  federacao?: string;
  fotoUrl?: string;
  criadoEm?: Timestamp;
}
