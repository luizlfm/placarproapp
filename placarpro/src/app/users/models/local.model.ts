import { Timestamp } from '@angular/fire/firestore';

export interface Local {
  id?: string;
  ownerId: string;
  nome: string;
  endereco?: string;
  cidade?: string;
  capacidade?: number;
  observacoes?: string;
  criadoEm?: Timestamp;
}
