import { Timestamp } from '@angular/fire/firestore';

/**
 * Dia da semana padrão do racha (recorrente). Valor `null/undefined` = não definido.
 */
export type DiaSemana = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';

/**
 * Tipo de campo onde o racha acontece — usado em filtros e em estatísticas
 * por superfície (gramado/society/quadra dá rendimentos diferentes).
 */
export type TipoCampo = 'gramado' | 'society' | 'salao' | 'areia' | 'outro';

/**
 * Plano do racha. Vide tela `/racha/:id/upgrade` pra detalhes:
 *  - `gratis`: limites mensais (50 voz, 2 listas, R$1k financeiro)
 *  - `premium`: ilimitado em voz/listas/financeiro
 *  - `pro`: tudo do premium + WhatsApp + Ao Vivo + Mercado de Notas + Conquistas
 */
export type PlanoRacha = 'gratis' | 'premium' | 'pro';

/**
 * RACHA — Pickup soccer game / pelada (informal weekly game).
 * Diferente de Campeonato: não tem fases, tabela, súmula formal.
 *
 * Foco em:
 *  - Lista de presença (quem confirma vem)
 *  - Sorteio de times (algoritmo balanceado)
 *  - Ranking rápido (gols, assistências, MVP)
 *  - Convite via link público
 *  - Financeiro do racha (entradas/saídas/saldo)
 *
 * Documento Firestore: `rachas/{rachaId}`.
 */
export interface Racha {
  /** Doc id — preenchido após gravar. */
  id?: string;
  /** UID do dono (criador do racha). */
  ownerId: string;
  /** Nome do racha (ex: "Racha dos Tesouras", "Pelada do Castelão"). */
  nome: string;

  // ============ Configuração de partida ============

  /** Quantidade de times que rolam em cada sessão (2, 3, 4...). */
  qtdTimes: number;
  /** Quantidade fixa de jogadores por time (5 = fut7 reduzido, 7 = society). */
  jogadoresPorTime: number;
  /**
   * Capacidade total derivada (qtdTimes × jogadoresPorTime). Salvo aqui
   * pra evitar recálculo em listagens. Atualizar quando qtdTimes ou
   * jogadoresPorTime mudarem.
   */
  capacidadeTotal: number;
  /** Duração da partida em minutos (default 10). */
  tempoPartidaMin?: number;

  // ============ Quando / Onde ============

  /** Dia da semana padrão (recorrente). */
  diaSemana?: DiaSemana;
  /** Horário de início no formato `HH:mm` (ex: "20:00"). */
  horarioInicio?: string;
  /** Descrição livre do horário (compat — preferimos diaSemana + horarioInicio). */
  horario?: string;
  /** Localização do racha (texto livre — ex: "Castelão Society"). */
  local?: string;
  /** Tipo da superfície do campo. */
  tipoCampo?: TipoCampo;
  /** UF (sigla, ex: 'MG', 'SP'). */
  estado?: string;
  /** Município (nome). */
  municipio?: string;
  /** Rua/logradouro (sem número). */
  endereco?: string;
  /** Número do imóvel (separado pra autocomplete via OSM). */
  numero?: string;

  // ============ Mídia ============

  /** URL da capa do racha (Storage). 16:9 banner. */
  capaUrl?: string;
  /** URL do logo do racha (Storage). Quadrado. */
  logoUrl?: string;

  // ============ Convite ============

  /** Código de convite curto (5 chars A-Z + 0-9). Único por racha. */
  codigoConvite?: string;
  /** Token mais longo do convite público (URL: `/racha/c/{token}`). */
  conviteToken?: string;
  /** Código de indicação opcional (quem indicou o organizador). */
  codigoIndicacao?: string;

  // ============ Integrações ============

  /** Link de convite do grupo WhatsApp (`https://chat.whatsapp.com/XXX`).
   *  Usado na tela `/whatsapp` pra abrir o grupo direto e pra gerar
   *  atalhos `wa.me` com mensagens pré-formatadas (lista de presença,
   *  sorteio, próximo jogo). NÃO é integração com bot — bot real exige
   *  WhatsApp Business API (paga + Meta approval). */
  whatsappGrupoLink?: string;
  /** Chave PIX do racha (pra cobranças automáticas nas mensagens). */
  chavePix?: string;

  // ============ Financeiro (custos fixos do evento) ============

  /** Aluguel do campo em R$ — usado em lançamentos automáticos. */
  aluguelCampoRs?: number;
  /** Custo de arbitragem em R$. */
  arbitragemRs?: number;
  /** Custo do app (rateio entre jogadores). */
  custoAppRs?: number;
  /** Valor padrão do mensalista (cobrado quando ativa badge na fila). */
  mensalistaPadraoRs?: number;

  // ============ Avaliação de jogadores (feature opcional) ============

  /**
   * Configuração da avaliação peer-to-peer. Quando `ativa=true`, jogadores
   * podem avaliar uns aos outros após cada evento.
   */
  avaliacao?: {
    ativa: boolean;
    /** "Bola Murcha": destaca pior jogador do evento. */
    bolaMurcha: boolean;
    /** Prazo em horas pra avaliar após o evento (default 48). */
    prazoHoras: number;
    /** Peso da avaliação (peer) no cálculo do "Craque da Rodada" — 0-100. */
    pesoAvaliacao: number;
    /** Peso das estatísticas (gols/assists) — 0-100. Soma com pesoAvaliacao = 100. */
    pesoEstatisticas: number;
  };

  /** Exibir notas atribuídas aos jogadores publicamente. */
  exibirNotas?: boolean;

  // ============ Status / Visibilidade ============

  /**
   * Status do racha:
   *  - `rascunho`: criado mas wizard de ativação não terminou ainda
   *  - `ativo`: pronto pra uso (jogos rolando)
   *  - `pausado`: temporariamente parado pelo dono
   *  - `encerrado`: arquivado, somente leitura
   */
  status?: 'rascunho' | 'ativo' | 'pausado' | 'encerrado';

  /** Wizard de ativação 3 passos concluído. */
  ativado?: boolean;

  /** Visibilidade pública (descoberta em busca) ou privada (só por link). */
  visibilidade?: 'publico' | 'privado';

  /** Plano atual do racha (`gratis` padrão). */
  plano?: PlanoRacha;

  /** Slug amigável pra URL pública (`/racha/{slug}`). */
  slug?: string;

  /** Quantidade de seguidores (jogadores fixos do racha). */
  seguidores?: number;

  // ============ Timestamps ============

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Time pertencente a um racha — subcoleção `rachas/{rachaId}/times/{timeId}`.
 * No FutBora cada time tem nome + cor do escudo. Aqui mantemos simples.
 */
export interface RachaTime {
  id?: string;
  /** Nome do time (ex: "Time 1", "Vermelhos", "Manga"). */
  nome: string;
  /** Cor do escudo em hex (ex: "#22c55e"). */
  cor?: string;
  /** Time ativo (false = arquivado, mantido pra histórico). */
  ativo?: boolean;
  /** Ordem do time pra renderização (1, 2, 3...). */
  ordem?: number;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Jogador do racha — subcoleção `rachas/{rachaId}/jogadores/{jogadorId}`.
 * Diferente de Jogador de Campeonato porque um racha não tem inscrições formais.
 */
export interface RachaJogador {
  id?: string;
  nome: string;
  /** Apelido pra exibir nas listagens (default = primeiro nome do nome). */
  apelido?: string;
  /** Posição preferida no campo. */
  posicao?: 'goleiro' | 'fixo' | 'ala' | 'pivo' | 'linha';
  /** Nota geral (0-10) — usada como critério de sorteio "Notas". */
  notaGeral?: number;
  /** Telefone (pra contato/convite WhatsApp). */
  telefone?: string;
  /** Indica que é "mensalista" (paga valor fixo independente de presença). */
  mensalista?: boolean;
  /** Marca como convidado (não-fixo do racha). */
  convidado?: boolean;
  /** Ativo (false = arquivado, mantido pra histórico). */
  ativo?: boolean;
  /** UID do usuário PlacarPro vinculado (se houver — pra peer review). */
  uidVinculado?: string;
  /** URL da foto/avatar. */
  fotoUrl?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Lançamento financeiro do racha — subcoleção
 * `rachas/{rachaId}/lancamentos/{lancamentoId}`.
 */
export interface RachaLancamento {
  id?: string;
  tipo: 'entrada' | 'saida';
  descricao: string;
  valorRs: number;
  /** Categoria livre (ex: "Aluguel", "Mensalidade", "Bola"). */
  categoria?: string;
  /** Data do lançamento (default = criadoEm). */
  data?: Timestamp;
  /** Origem automática (true se criado pelo sistema, ex: confirmação de fila). */
  auto?: boolean;
  /** Jogador vinculado (quando aplicável — ex: mensalidade). */
  jogadorId?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Tipo de evento que pode ocorrer numa partida. Influencia stats agregadas
 * de cada jogador (gols, assistências, cartões).
 */
export type RachaEventoTipo = 'gol' | 'assistencia' | 'amarelo' | 'vermelho' | 'azul' | 'penalti';

/**
 * Partida individual dentro do racha — uma "rodada" de X minutos entre
 * dois times. Salvo em `rachas/{rachaId}/partidas/{partidaId}`.
 * Stats agregadas dos jogadores (mercado, conquistas, ranking) são
 * calculadas a partir dos eventos das partidas finalizadas.
 */
export interface RachaPartida {
  id?: string;
  /** Data/hora ISO de início da partida. */
  data: string;
  /** Time A (mandante visualmente). */
  timeAId?: string;
  timeANome: string;
  golsA: number;
  /** Time B (visitante visualmente). */
  timeBId?: string;
  timeBNome: string;
  golsB: number;
  /** Duração em minutos. */
  duracaoMin?: number;
  /** Status: rascunho (sendo registrada) ou final. */
  status?: 'rascunho' | 'finalizada';
  /** Observações livres. */
  observacoes?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Evento individual ocorrido numa partida — gol/assist/cartão por jogador.
 * Salvo em `rachas/{rachaId}/partidas/{partidaId}/eventos/{eventoId}`.
 *
 * Em uma fase futura, agregar via Cloud Function pra denormalizar stats
 * direto no doc do jogador (mais rápido pra UI).
 */
export interface RachaEvento {
  id?: string;
  jogadorId: string;
  /** Time do jogador NA partida (pra calcular gols-contra etc). */
  timeId?: string;
  tipo: RachaEventoTipo;
  /** Minuto do jogo (0-N). Opcional. */
  minuto?: number;
  /** Pra gol: jogador que deu assistência (opcional). */
  assistJogadorId?: string;
  criadoEm?: Timestamp;
}

/**
 * Avaliação peer-to-peer de um jogador. Doc id = `${avaliadorId}_${avaliadoId}`
 * pra impedir avaliações duplicadas do mesmo par e permitir update.
 * Salvo em `rachas/{rachaId}/avaliacoes/{avaliadorId_avaliadoId}`.
 */
export interface RachaAvaliacao {
  id?: string;
  /** UID/jogadorId do avaliador (pode ser uid auth ou id na coleção jogadores). */
  avaliadorId: string;
  /** Jogador avaliado (id na subcoleção jogadores). */
  avaliadoId: string;
  /** Nota 1-5 (estrelas). */
  nota: number;
  /** Comentário opcional. */
  comentario?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Conquista (badge) desbloqueada por um jogador. Calculada dinamicamente
 * a partir das estatísticas — o doc só persiste a primeira data em que
 * o jogador atingiu o critério (pra mostrar "desbloqueada em DD/MM/YY").
 * Salvo em `rachas/{rachaId}/conquistas/{jogadorId_badgeId}`.
 */
export interface RachaConquista {
  id?: string;
  jogadorId: string;
  /** Identificador do badge: 'primeiro-gol', 'hat-trick', '10-jogos', etc. */
  badgeId: string;
  /** Data em que o jogador atingiu o critério pela primeira vez. */
  conquistadaEm?: Timestamp;
}

/**
 * Confirmação na lista de presença — doc por jogador em
 * `rachas/{rachaId}/sessoes/{sessaoId}/presencas/{jogadorId}`.
 *
 * `sessaoId` representa um "evento" — uma data específica do racha.
 */
export interface RachaPresenca {
  /** id = jogadorId — facilita query/update. */
  id?: string;
  jogadorId: string;
  nome: string;
  /**
   * Status:
   *  - `vou`: confirmado dentro da fila
   *  - `nao-vou`: explicitamente não vai
   *  - `espera`: confirmou mas excedeu capacidade (aguarda vaga)
   *  - `cancelado`: confirmou e depois cancelou
   */
  status: 'vou' | 'nao-vou' | 'espera' | 'cancelado';
  /** Ordem de chegada (pra ordenação fifo / mensalista primeiro). */
  ordem?: number;
  /** Indica mensalista (vai pra frente da fila). */
  mensalista?: boolean;
  /** Pagamento PIX confirmado pelo admin. */
  pago?: boolean;
  /** Hora da última atualização. */
  atualizadoEm?: Timestamp;
  /** Hora da primeira confirmação. */
  criadoEm?: Timestamp;
}
