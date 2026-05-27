import { Timestamp } from '@angular/fire/firestore';

/** Tipos de ações registradas no log. */
export type LogAcao =
  | 'login'
  | 'logout'
  | 'signup'
  | 'campeonato_criado'
  | 'campeonato_excluido'
  | 'plano_alterado'
  | 'cobranca_criada'
  | 'cobranca_paga'
  | 'config_alterada'
  | 'usuario_promovido'
  | 'outro';

/** Documento em `logs/{id}` no Firestore. */
export interface LogAuditoria {
  id?: string;
  /** Quem fez a ação (uid). Pode ser null se foi um evento do sistema. */
  usuarioId?: string;
  /** Nome ou email do usuário (denormalizado pra busca rápida). */
  usuarioLabel?: string;
  acao: LogAcao;
  /** Descrição livre da ação. */
  descricao: string;
  /** Metadata adicional (ex: { campeonatoId, planoAnterior, planoNovo }). */
  meta?: Record<string, unknown>;
  /** Quando aconteceu. */
  criadoEm?: Timestamp;
}

export const LOG_ACAO_LABEL: Record<LogAcao, string> = {
  login: 'Login',
  logout: 'Logout',
  signup: 'Cadastro',
  campeonato_criado: 'Campeonato criado',
  campeonato_excluido: 'Campeonato excluído',
  plano_alterado: 'Plano alterado',
  cobranca_criada: 'Cobrança criada',
  cobranca_paga: 'Pagamento confirmado',
  config_alterada: 'Configurações alteradas',
  usuario_promovido: 'Usuário promovido (admin)',
  outro: 'Outro',
};

export const LOG_ACAO_COR: Record<LogAcao, string> = {
  login: '#4DABF7',
  logout: '#94A3B8',
  signup: '#7CC61D',
  campeonato_criado: '#F39C12',
  campeonato_excluido: '#E11D48',
  plano_alterado: '#845EF7',
  cobranca_criada: '#1C2E3D',
  cobranca_paga: '#4a7e0e',
  config_alterada: '#0EA5E9',
  usuario_promovido: '#9333EA',
  outro: '#64748b',
};
