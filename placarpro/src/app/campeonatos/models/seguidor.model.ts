import { Timestamp } from '@angular/fire/firestore';

/**
 * Usuário que segue um campeonato — armazenado em
 * `campeonatos/{campeonatoId}/seguidores/{uid}`.
 *
 * Cada doc usa o `uid` do Firebase Auth como ID, garantindo
 * unicidade (um usuário só segue uma vez).
 */
export interface Seguidor {
  /** Firebase Auth uid (também é o ID do doc). */
  uid: string;
  /** Nome de exibição (`displayName` ou e-mail). */
  nome: string;
  /** E-mail (opcional). */
  email?: string;
  /** Foto/avatar. */
  fotoUrl?: string;
  /** Quando começou a seguir. */
  seguindoDesde?: Timestamp;
}
