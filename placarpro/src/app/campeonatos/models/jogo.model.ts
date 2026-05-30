import { Timestamp } from '@angular/fire/firestore';

export type JogoStatus = 'agendado' | 'em-andamento' | 'encerrado' | 'cancelado' | 'wo';

export type EventoTipo =
  | 'gol'
  | 'gol-contra'
  | 'amarelo'
  | 'vermelho'
  | 'azul'
  | 'falta'
  | 'defesa'
  | 'sub-entrou'
  | 'sub-saiu'
  /** Cobranças de pênalti na DECISÃO (não confundir com pênalti durante
   *  o jogo, que vira `gol` com observação). Cada cobrança gera um
   *  evento separado pra montar o histórico (1ª cobrança Mand → Vis,
   *  2ª Mand → Vis, ...) usado no painel de pênaltis. */
  | 'pen-convertido'
  | 'pen-perdido'
  | 'pen-defendido';

/** Evento da partida (gols, cartões, substituições). */
export interface EventoJogo {
  id?: string;
  tipo: EventoTipo;
  equipeId: string;
  jogadorId?: string;
  /** Para gols: jogador que deu a assistência. */
  assistenteId?: string;
  /** Quantidade do mesmo evento (default 1). Útil pra gols múltiplos do mesmo jogador. */
  quantidade?: number;
  minuto?: number;
  /**
   * Tempo (período) da partida em que o lance ocorreu — 1ºT, 2ºT,
   * prorrogação, pênaltis etc. Auto-preenchido a partir de
   * `jogo.tempoAtual` quando o lance é criado durante a partida.
   * Permite exibir "1ºT · 23'" nos cards e timeline.
   */
  tempo?: TempoJogoNome;
  /** Texto livre (descrição/observação). */
  observacao?: string;
  /** URLs de mídias (fotos/vídeos) anexadas ao lance. */
  midiaUrls?: string[];
  criadoEm?: Timestamp;
}

/** Função do árbitro no jogo. */
export type FuncaoArbitro =
  | 'principal'
  | 'auxiliar-1'
  | 'auxiliar-2'
  | 'quarto-arbitro'
  | 'mesario'
  | 'cronometrista';

/** Árbitro vinculado a um jogo específico. */
export interface ArbitroJogo {
  /** ID do árbitro cadastrado em `arbitros` do usuário. Pode ser ausente se for nome manual. */
  arbitroId?: string;
  /** Nome (denormalizado pra exibição rápida). */
  nome: string;
  /** Função desempenhada nesta partida. */
  funcao: FuncaoArbitro;
}

/** Anexo do jogo (link/foto da súmula, ata, regulamento). */
export interface AnexoJogo {
  id: string;
  /** Rótulo exibido. */
  titulo: string;
  /** URL — pode ser http(s) ou Storage URL. */
  url: string;
  /** Tipo do anexo (icone + tratamento de download). */
  tipo?: 'link' | 'pdf' | 'imagem' | 'outro';
  /** Timestamp epoch ms de criação. */
  criadoEm?: number;
}

/** Patrocinador vinculado a uma partida específica (logo + nome).
 *  Exibido na esteira de banners da tela de transmissão,
 *  junto com os patrocinadores globais do organizador. */
export interface PatrocinadorJogo {
  nome: string;
  logoUrl?: string;
  /** Path no Storage pra deleção posterior. */
  logoPath?: string;
}

/** Ajuste manual de pontos (bônus ou penalidade) aplicado por partida. */
export interface PontosExtras {
  /** Pontos extras pra equipe mandante (positivo = bônus, negativo = penalidade). */
  mandante?: number;
  /** Pontos extras pra equipe visitante. */
  visitante?: number;
  /** Motivo (opcional, livre). */
  motivo?: string;
}

/** Partida entre duas equipes. */
export interface Jogo {
  id?: string;
  campeonatoId: string;
  categoriaId: string;

  /** Fase (1ª, oitavas, quartas…). Texto livre por enquanto. */
  fase?: string;
  /** Rodada da fase (1, 2, 3…). */
  rodada?: number;
  /** Grupo, se aplicável. */
  grupoId?: string;

  mandanteId: string;
  visitanteId: string;

  /** Placar — null quando ainda não jogou. */
  golsMandante?: number | null;
  golsVisitante?: number | null;
  /** Pênaltis (se houver decisão). */
  penaltisMandante?: number | null;
  penaltisVisitante?: number | null;

  status: JogoStatus;
  /** YYYY-MM-DD HH:mm ou ISO. */
  dataHora?: string;
  local?: string;

  /** Título customizado (ex.: "Decisão do título"). */
  titulo?: string;
  /** Aviso/recado livre exibido na partida. */
  aviso?: string;

  /** Árbitros da partida. */
  arbitros?: ArbitroJogo[];
  /** Anexos (links/arquivos) ligados ao jogo. */
  anexos?: AnexoJogo[];
  /** Ajustes manuais de pontuação por equipe. */
  pontosExtras?: PontosExtras;

  /** Patrocinadores específicos desta partida (logo + nome).
   *  Aparecem na esteira de banners da transmissão, junto com os
   *  patrocinadores globais do organizador. Máx. recomendado: 5. */
  patrocinadores?: PatrocinadorJogo[];

  /** Timestamp de quando o admin clicou em "Iniciar partida".
   *  Base pra calcular o tempo decorrido (cronômetro reativo). */
  iniciadoEm?: Timestamp;
  /** Timestamp de quando o admin clicou em "Encerrar partida". Usado
   *  pra parar o cronômetro e mostrar duração total. */
  encerradoEm?: Timestamp;

  /**
   * Tempo atual do jogo (1ºT, intervalo, 2ºT, prorrogação, pênaltis).
   * Setado no `iniciar partida` (= `primeiro`) e atualizado quando o
   * admin clica em "passar de tempo". Drive a UI do painel ao vivo.
   */
  tempoAtual?: TempoJogoNome;
  /**
   * Timestamp de quando o tempo atual começou. O cronômetro do painel
   * ao vivo calcula `agora - tempoAtualIniciadoEm` (NÃO `iniciadoEm`).
   * Isso reseta a cada troca de período pro relógio começar do 00:00.
   */
  tempoAtualIniciadoEm?: Timestamp;
  /** Duração configurada de cada tempo principal (1ºT / 2ºT), em
   *  minutos. Default 45. Aplicado também aos tempos de prorrogação. */
  duracaoPeriodoMin?: number;

  /** Quantidade de cobranças por lado na decisão por pênaltis (regra
   *  "melhor de N"). Default 5. Configurável por jogo (ex.: torneios
   *  juniores podem usar 3, jogos amistosos podem usar 7). Após esgotar
   *  as N cobranças com placar empatado, entra na MORTE SÚBITA. */
  serieMaximaPenaltis?: number;
  /** Minutos de acréscimo já registrados no tempo atual (0, 1, 2, ...).
   *  Exibido como "+N" ao lado do cronômetro. */
  acrescimoAtualMin?: number;

  /**
   * Cronômetro PAUSADO — admin clicou em "Pausar" durante uma parada
   * técnica, atendimento médico, briga, etc. Quando true, o painel ao
   * vivo congela o relógio no valor de `tempoPausadoSegundos`.
   *
   * Despausar grava um novo `tempoAtualIniciadoEm` recuado pra preservar
   * os segundos já decorridos (cronômetro continua de onde parou).
   */
  tempoPausado?: boolean;
  /** Segundos decorridos no momento em que pausou — usado pra congelar
   *  o display E pra calcular o novo `tempoAtualIniciadoEm` ao retomar. */
  tempoPausadoSegundos?: number;

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;

  /**
   * Quantas "horas-crédito" de transmissão já foram pagas/reservadas para
   * ESTE jogo. Cada crédito libera `transmissaoDuracaoMin` minutos de tempo
   * ACUMULADO (somando todas as sessões). O orçamento atual de tempo =
   * `horasTransmissaoPagas × transmissaoDuracaoMin`. Quando o tempo total
   * transmitido atinge o orçamento, é preciso reservar mais 1 (debitar
   * outro crédito) pra continuar. 0/ausente = nada reservado ainda.
   */
  horasTransmissaoPagas?: number;

  /**
   * Tempo acumulado de transmissão (em segundos) no momento em que o
   * PRIMEIRO crédito cronometrado foi reservado para este jogo. Serve de
   * BASELINE: o orçamento (`horasTransmissaoPagas × limite`) conta apenas o
   * tempo transmitido A PARTIR daqui. Assim, tempo transmitido ANTES de
   * existir crédito (legado) não consome o crédito recém-comprado.
   * Setado uma única vez (quando ainda é `undefined`).
   */
  transmissaoSegundosBase?: number;

  /** DEV/TEST — quando admin clica em "Testar banner premium", grava o
   *  timestamp aqui. Todos os componentes que escutam o jogo veem e
   *  disparam a janela local. REMOVER junto com a feature de teste. */
  _testePremiumAt?: Timestamp;
  _testePremiumLogoUrl?: string;
  _testePremiumNome?: string;
}

/**
 * Tempo (período) atual da partida. Cobre os 7 estados que importam:
 *  - primeiro     — 1º tempo
 *  - intervalo    — entre 1º e 2º
 *  - segundo      — 2º tempo
 *  - prorrog-1    — 1º tempo da prorrogação
 *  - prorrog-int  — intervalo da prorrogação
 *  - prorrog-2    — 2º tempo da prorrogação
 *  - penaltis     — disputa de pênaltis
 */
export type TempoJogoNome =
  | 'primeiro'
  | 'intervalo'
  | 'segundo'
  | 'prorrog-1'
  | 'prorrog-int'
  | 'prorrog-2'
  | 'penaltis';

export type NovoJogoInput = Pick<Jogo, 'mandanteId' | 'visitanteId'> &
  Partial<Pick<Jogo, 'fase' | 'rodada' | 'grupoId' | 'dataHora' | 'local'>>;
