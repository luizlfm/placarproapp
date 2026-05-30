import { Timestamp } from '@angular/fire/firestore';

/**
 * Patrocínio de partida — anúncio pago do organizador pra exibir logos
 * de patrocinadores durante a transmissão de UM jogo específico.
 *
 * Existem 2 tipos:
 *  - `'normal'`  → banner pequeno rotativo no canto do vídeo (R$ 50/cred)
 *  - `'premium'` → intersticial vertical 9:16 ocupando lateral direita
 *                  durante 6s, a cada 7min de transmissão (R$ 70/cred)
 *
 * Localização: subcoleção do jogo
 *   campeonatos/{id}/categorias/{catId}/jogos/{jogoId}/patrocinios/{patroId}
 */
export interface PatrocinioJogo {
  id?: string;

  /** Tipo do patrocínio — determina preço, formato visual e duração. */
  tipo?: 'normal' | 'premium';

  /** UID do organizador (ownerId do campeonato) que está pagando. */
  ownerId: string;

  /** Anunciantes incluídos neste patrocínio.
   *  - Normal: 1 ou 2 (máx por crédito)
   *  - Premium: 1 (sempre — banner exclusivo dele) */
  patrocinadores: Array<{
    nome: string;
    /** URL da mídia (Storage). Se `tipoMidia === 'video'`, é um vídeo
     *  curto (até 6s) que toca em loop muted no banner premium. */
    logoUrl: string;
    /** Tipo da mídia. Default 'imagem' (compat com docs antigos). */
    tipoMidia?: 'imagem' | 'video';
    /** Opcional — clique no logo abre essa URL na transmissão. */
    linkUrl?: string;
  }>;

  /** Quantos créditos foram debitados. Normal/Premium fixo em 1. */
  creditosUsados: number;

  /** Duração em minutos a partir do início da transmissão.
   *  - Normal: 60min (banner fica aceso o tempo todo)
   *  - Premium: igual à duração da transmissão (ele aparece em janelas
   *    de 6s a cada 7min até o `expiraEm`). Como não sabemos a duração
   *    total da partida ao ativar, usamos um teto grande (180min = 3h)
   *    e a esteira/Cloud Function encerra quando a transmissão termina. */
  duracaoMin: number;

  /** Quando a transmissão começou — preenchido por Cloud Function ou
   *  manualmente quando a transmissão liga. Enquanto `null`, o patrocínio
   *  fica em fila aguardando. */
  inicioReal?: Timestamp | null;

  /** = inicioReal + duracaoMin. Cliente filtra por `now < expiraEm`. */
  expiraEm?: Timestamp | null;

  /**
   * Estado do patrocínio:
   *  - 'agendado'  : pago, esperando transmissão começar
   *  - 'ativo'     : transmissão rolando + dentro da duração
   *  - 'expirado'  : duração esgotada
   *  - 'cancelado' : organizador cancelou antes de começar (créditos estornados)
   */
  status: 'agendado' | 'ativo' | 'expirado' | 'cancelado';

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/**
 * Regras fixas do tipo NORMAL.
 *  - 1 crédito = R$ 50
 *  - Até 2 patrocinadores por crédito
 *  - Banner pequeno rotativo no canto, aceso por 60min
 */
export const CREDITO_PATROCINIO = {
  precoBase: 50,
  logosPorCredito: 2,
  duracaoMin: 60,
} as const;

/**
 * Regras fixas do tipo PREMIUM (intersticial vertical 9:16).
 *  - 1 crédito = R$ 70
 *  - 1 patrocinador por crédito
 *  - Aparece em "janelas" de 6s a cada 7min, a partir do 7º minuto da
 *    transmissão
 *  - Até 3 patrocínios premium podem coexistir num mesmo jogo (rotação
 *    round-robin nas janelas)
 *  - Imagem em proporção 9:16 (1080×1920), recomendado 360×640
 *  - Cobre o jogo inteiro (duração 180min como teto)
 *
 * Quando uma janela está ativa:
 *  - Banner vertical ocupa ~28% lateral direita
 *  - Vídeo recolhe pra ~70% à esquerda
 *  - Esteira normal (banner pequeno) some
 *  - Scoreboard sobreposto some
 */
export const PREMIUM_PATROCINIO = {
  precoBase: 70,
  logosPorCredito: 1,
  duracaoMin: 180,
  /** Em segundos — quanto tempo dura cada "janela" visível. */
  janelaDuracaoSeg: 6,
  /** Em minutos — quanto tempo entre o INÍCIO de uma janela e o
   *  início da próxima. Primeira janela aos 7min de transmissão. */
  intervaloMin: 7,
  /** Máximo de patrocínios premium ativos simultaneamente por jogo. */
  maxPorJogo: 3,
  /** Largura em pixels da imagem final (após resize). */
  imagemLargura: 1080,
  /** Altura em pixels da imagem final (após resize) — proporção 9:16. */
  imagemAltura: 1920,
} as const;
