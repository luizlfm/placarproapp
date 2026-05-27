import { Timestamp } from '@angular/fire/firestore';

/** Tipo estrutural da fase. */
export type FaseTipo =
  | 'pontos-corridos'
  | 'pontos-corridos-grupos'
  | 'eliminatorias';

/** Critérios de desempate ordenados (do mais importante para o menos). */
export type CriterioId =
  // Núcleo (já usados nos cálculos principais)
  | 'pontos'
  | 'vitorias'
  | 'saldo-gols'
  | 'gols-pro'
  | 'gols-contra'
  | 'confronto-direto'
  | 'cartoes-vermelhos'
  | 'cartoes-amarelos'
  | 'sorteio'
  // Adicionais
  | 'aproveitamento'
  | 'empates'
  | 'derrotas'
  | 'cartoes-totais'
  | 'saldo-confronto-direto'
  | 'vitorias-fora'
  | 'gols-fora'
  | 'jogos-disputados'
  | 'menor-idade-media'
  | 'maior-idade-media'
  | 'criterio-tecnico';

/** Destaque visual (cor) para uma posição na tabela. */
export interface PosicaoDestaque {
  /** Posição inicial (1-based). */
  de: number;
  /** Posição final inclusiva (1-based). */
  ate: number;
  /** Cor em hex. */
  cor: string;
  /** Legenda opcional (ex: "Classificados", "Rebaixamento"). */
  label?: string;
}

/** Fase do campeonato (1ª fase, semifinal, final, etc.). */
export interface Fase {
  id?: string;
  campeonatoId: string;
  categoriaId: string;
  /** Ordem de exibição (0 = primeira). */
  ordem: number;
  /** Nome exibido. Ex: "1ª Fase", "Semifinal". */
  nome: string;
  /** Estrutura da fase. */
  tipo: FaseTipo;
  /** 1 = ida; 2 = ida e volta. */
  turnos: 1 | 2;
  /** Critérios de desempate em ordem. */
  criterios?: CriterioId[];
  /** Pontos por vitória (default 3). */
  pontosVitoria?: number;
  /** Pontos por empate (default 1). */
  pontosEmpate?: number;
  /** Pontos por derrota (default 0). */
  pontosDerrota?: number;
  /** Para eliminatórias: se conta para a tabela geral de classificação. */
  classificacaoAtiva?: boolean;
  /** Faixas coloridas (zona de classificação, rebaixamento, etc.). */
  destaques?: PosicaoDestaque[];
  /** Equipes selecionadas pra disputar essa fase (vazio = todas da categoria). */
  equipesSelecionadas?: string[];
  /** ID da fase anterior cujos resultados servem de base ("continuar tabela"). */
  continuarDeFaseId?: string;
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type NovaFaseInput = Pick<Fase, 'nome' | 'tipo'> & Partial<Fase>;

export const CRITERIO_LABEL: Record<CriterioId, string> = {
  'pontos': 'Pontos',
  'vitorias': 'Vitórias',
  'saldo-gols': 'Saldo de gols',
  'gols-pro': 'Gols pró',
  'gols-contra': 'Gols contra (menos)',
  'confronto-direto': 'Confronto direto',
  'cartoes-vermelhos': 'Menos cartões vermelhos',
  'cartoes-amarelos': 'Menos cartões amarelos',
  'sorteio': 'Sorteio',
  // Adicionais
  'aproveitamento': 'Aproveitamento (%)',
  'empates': 'Menos empates',
  'derrotas': 'Menos derrotas',
  'cartoes-totais': 'Menos cartões totais',
  'saldo-confronto-direto': 'Saldo no confronto direto',
  'vitorias-fora': 'Vitórias como visitante',
  'gols-fora': 'Gols como visitante',
  'jogos-disputados': 'Mais jogos disputados',
  'menor-idade-media': 'Menor idade média da equipe',
  'maior-idade-media': 'Maior idade média da equipe',
  'criterio-tecnico': 'Critério técnico (organização)',
};

export const CRITERIOS_PADRAO: CriterioId[] = [
  'pontos',
  'vitorias',
  'saldo-gols',
  'gols-pro',
  'confronto-direto',
];

/** Cores predefinidas para destaque de posição. */
export const DESTAQUE_CORES = [
  { cor: '#7CC61D', label: 'Classificados' },
  { cor: '#4DABF7', label: 'Mata-mata' },
  { cor: '#FFB020', label: 'Repescagem' },
  { cor: '#FF6B6B', label: 'Zona neutra' },
  { cor: '#EB445A', label: 'Rebaixamento' },
];

/** Rótulo legível pra cada tipo. */
export const FASE_TIPO_LABEL: Record<FaseTipo, string> = {
  'pontos-corridos': 'Pontos corridos',
  'pontos-corridos-grupos': 'Pontos corridos por grupos',
  'eliminatorias': 'Eliminatórias',
};
