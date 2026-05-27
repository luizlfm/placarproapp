/**
 * Constantes de negócio do sistema de transmissão ao vivo.
 *
 * Centralizadas pra que o client (Angular) e a Cloud Function (Node)
 * usem o MESMO threshold — qualquer mudança aqui exige redeploy de
 * ambos pra não dessincronizar.
 *
 * (A Cloud Function declara as mesmas constantes em
 *  `functions/src/transmissoesCreditos.ts` por enquanto, já que não
 *  temos path mapping entre os 2 projetos. Manter os 2 lugares iguais!)
 */

/**
 * Tempo TOTAL acumulado (em segundos) de uma transmissão por jogo
 * para abater 1 crédito. 2h30 = 9000s.
 *
 * Regra de negócio: o broadcaster pode iniciar/parar/cair/reconectar
 * livremente — a Cloud Function soma o tempo de TODAS as transmissões
 * do mesmo jogo. Quando o total cruza 9000s, decrementa 1 crédito do
 * owner do campeonato. A partir daí, qualquer tempo adicional NÃO custa
 * mais nada (1 crédito = 1 jogo, mesmo que dure 3h).
 */
export const SEGUNDOS_PARA_CONSUMIR_CREDITO = 9000;

/**
 * Intervalo entre heartbeats do broadcaster pro Firestore. O modal
 * envia `duracaoSegundos` a cada 30s. Se o broadcaster cair, os 30s
 * "perdidos" são desprezíveis (~0,3% de erro num jogo de 2h30).
 *
 * Menor que isto custa muitos writes (R$ + latência); maior aumenta
 * a perda em caso de queda.
 */
export const INTERVALO_HEARTBEAT_MS = 30_000;
