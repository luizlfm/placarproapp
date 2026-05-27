import { Timestamp } from '@angular/fire/firestore';

export type Visibilidade = 'privado' | 'publico';
export type TipoEvento = 'presencial' | 'internet';

/**
 * Tipo de conta — definido no signup e validado em todo login.
 * - `organizador`: cria/gerencia campeonatos próprios (área `/app/*`).
 * - `cliente`: espectador (segue campeonatos, edita equipe via convite).
 * - `moderador`: auxiliar de organização. Pode entrar pelo link mágico
 *   `/m/{linkToken}` (acesso a um campeonato específico) OU se cadastrar
 *   globalmente com código de convite próprio. Permissões granulares
 *   são definidas pelo organizador via `ModeradorCampeonato.permissoes`.
 * - `racha`: organizador de PELADAS (pickup soccer games). Área separada
 *   `/racha/*` — diferente de campeonato (não tem fase, tabela, súmula).
 *   Foco em sorteio de times, lista de presença, ranking rápido. Cadastro
 *   livre, sem código de convite necessário.
 *
 * Quando ausente em docs legacy, o login atual assume o tipo que o usuário
 * acabou de selecionar (mais conservador que o comportamento antigo).
 */
export type TipoConta = 'organizador' | 'cliente' | 'moderador' | 'racha';

/** Perfil do organizador — documento `users/{uid}`. */
export interface UserProfile {
  uid: string;
  nome: string;
  /** Tipo de conta — usado para gate de acesso entre área admin e espectador. */
  tipo?: TipoConta;
  /** Admin master — vê painel global com tudo do sistema (usuários,
   *  todos os campeonatos, inscrições). Setado automaticamente no signup
   *  quando o código `admin-master` é usado, ou manualmente via Firebase
   *  Console. NÃO é o mesmo que `tipo`. */
  isMaster?: boolean;
  /** Texto curto exibido no cabeçalho do perfil (até 70 char). */
  texto1?: string;
  /** Texto adicional (até 180 char). */
  texto2?: string;
  /** Bio extensa / "Sobre". */
  sobre?: string;
  /** Compat com versão antiga. */
  bio?: string;
  /** URL do logo (Storage). */
  logoUrl?: string;
  /** Mantido para compatibilidade — agora preferimos logoUrl. */
  fotoUrl?: string;
  /** Banner aplicativo (805x453). */
  bannerAppUrl?: string;
  /** Banner jogos (970x90). */
  bannerSiteUrl?: string;
  /** Cor primária do perfil (hex). */
  corPrimaria?: string;
  /** Slug do link: placarpro.app/{slug}. */
  slug?: string;

  visibilidade?: Visibilidade;
  tipoEvento?: TipoEvento;
  idioma?: string;
  sede?: string;
  regiao?: string;
  localizacao?: string;

  telefone?: string;
  email?: string;
  cidade?: string;

  /** Aceita receber chat pelo app. */
  chatAtivo?: boolean;

  /**
   * MODERADOR — flag de aprovação manual pelo admin.
   * - `undefined` ou `false`: cadastrou-se como moderador mas ainda NÃO foi
   *   validado pelo admin master. Conta existe, login funciona, mas o user
   *   não pode exercer ações de moderação até ser aprovado.
   * - `true`: validado pelo admin master via painel `/app/admin`.
   *
   * Fluxo: moderador que se cadastra COM código de convite válido é
   * autoaprovado (legado). Sem código, vira pendente e o admin valida.
   */
  moderadorValidado?: boolean;
  /** Timestamp da validação manual pelo admin. */
  moderadorValidadoEm?: Timestamp;
  /** UID do admin que validou. */
  moderadorValidadoPor?: string;

  /** Conta BLOQUEADA pelo admin master — não pode acessar área autenticada
   *  até ser desbloqueada. Bloqueio é "soft": dados permanecem, mas login
   *  é bloqueado via AuthGuard. Diferente de `banido` (mais severo). */
  bloqueado?: boolean;
  /** Timestamp do bloqueio (apenas pra histórico/auditoria). */
  bloqueadoEm?: Timestamp;
  /** UID do admin que aplicou o bloqueio. */
  bloqueadoPor?: string;

  /** Conta BANIDA — bloqueio permanente com razão registrada. O usuário
   *  é mantido (não excluído) pra evitar recriação de conta com mesmo
   *  email/Google ID e pra registro de auditoria. */
  banido?: boolean;
  /** Razão livre da punição — exibida ao user na tela de login bloqueada. */
  banidoMotivo?: string;
  banidoEm?: Timestamp;
  banidoPor?: string;

  /** Plano atual do usuário (gerenciado em /app/planos).
   *  `gratis` é o padrão pra usuários novos / sem campo definido. */
  plano?: 'gratis' | 'pequeno' | 'medio' | 'grande' | 'profissional';

  /**
   * Transmissões avulsas ainda disponíveis — créditos comprados em
   * /app/planos (R$ 30 cada) que ainda não foram utilizados.
   * Admin adiciona ao confirmar pagamento. Decrementa a cada partida
   * transmitida (quando ativado na lógica de transmissão).
   */
  transmissoesExtras?: number;

  redes?: {
    facebook?: string;
    instagram?: string;
    youtube?: string;
    twitch?: string;
    twitter?: string;
    whatsapp?: string;
    telegram?: string;
    site?: string;
  };

  atualizadoEm?: Timestamp;
}
