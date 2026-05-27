import { Timestamp } from '@angular/fire/firestore';

/** Grupo de uma fase (ex: "Grupo A"). */
export interface Grupo {
  id?: string;
  campeonatoId: string;
  categoriaId: string;
  /** Ordem visual ("A" = 0, "B" = 1...). */
  ordem: number;
  /** Nome exibido. Default: "Grupo A". */
  nome: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}
