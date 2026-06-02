/**
 * Cloud Function que monitora heartbeats de transmissão e abate 1 crédito
 * do owner do campeonato quando a soma do tempo de TODAS as transmissões
 * do jogo cruza 2h30 (9000 segundos).
 *
 * Modelo de negócio:
 *  - 1 crédito = 1 jogo com até 2h30 de transmissão ao vivo.
 *  - Se o broadcaster cair e reconectar, o tempo SOMA (não reseta).
 *  - Cobra apenas UMA vez por jogo — depois de ultrapassar 2h30, o tempo
 *    extra (ex: prorrogação) é grátis (idempotência via flag `descontou`).
 *
 * Trigger:
 *  - `onDocumentUpdated` em `transmissoes/{tId}` — dispara a cada heartbeat
 *    (cliente atualiza `duracaoSegundos` a cada 30s).
 *  - Quando o total do jogo passa de 9000s e nenhuma transmissão deste
 *    jogo ainda tem `descontou: true`, faz transação atômica:
 *      1. Decrementa `users/{ownerId}.transmissoesExtras` em -1
 *      2. Marca esta transmissão com `descontou: true`
 *
 * Por que Cloud Function (e não cliente):
 *  - Cliente é manipulável: user malicioso pode setar `descontou: true`
 *    sem pagar OU não decrementar transmissoesExtras.
 *  - Cloud Function roda com Admin SDK, ignora rules — fonte de verdade.
 *
 * IMPORTANTE: Mantenha `SEGUNDOS_PARA_CONSUMIR_CREDITO` igual à constante
 * declarada em `placarpro/src/app/shared/constants/transmissao.constants.ts`.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

/**
 * Listener que dispara na CRIAÇÃO do doc transmissoes/{tId} — ou seja, no
 * instante em que a transmissão começa. Abate 1 crédito do dono ali mesmo.
 *
 * Modelo de cobrança: 1 crédito = 1 jogo (nada é grátis). A cobrança acontece
 * no INÍCIO e SÓ UMA VEZ por jogo — independente da duração. Reconexões /
 * sessões extras do mesmo jogo NÃO recobram (idempotência via `descontou`).
 *
 * O débito é server-side (Admin SDK ignora rules) porque o cliente não pode
 * escrever `transmissoesExtras` (bloqueado nas Firestore Rules). O cliente só
 * faz o GATE de UX (não deixa iniciar sem saldo).
 *
 * Path do trigger:
 *   campeonatos/{cId}/categorias/{catId}/jogos/{jId}/transmissoes/{tId}
 */
export const onTransmissaoCriada = onDocumentCreated(
  {
    document: 'campeonatos/{campeonatoId}/categorias/{categoriaId}/jogos/{jogoId}/transmissoes/{transmissaoId}',
    region: 'southamerica-east1',
  },
  async (event) => {
    const after = event.data?.data();
    if (!after) return;

    const { campeonatoId, categoriaId, jogoId, transmissaoId } = event.params;
    const ownerId = after.ownerId as string | undefined;
    const jaDescontou = after.descontou === true;

    // Sem ownerId não dá pra cobrar (transmissão criada antes da feature
    // ou doc malformado). Loga e desiste — admin master cuida manualmente.
    if (!ownerId) {
      logger.warn('[creditos] transmissão sem ownerId — pulando', {
        campeonatoId, jogoId, transmissaoId,
      });
      return;
    }
    // Já descontou — não recobra.
    if (jaDescontou) return;

    const db = admin.firestore();

    // ── 1. Verifica se ALGUMA transmissão deste jogo já descontou
    //       (race: 2 sessões concorrentes do mesmo broadcaster).
    //       Se sim, marca esta como `descontou: true` por consistência
    //       e sai — nunca cobra 2x o mesmo jogo. ──
    const transmissoesRef = db
      .collection('campeonatos').doc(campeonatoId)
      .collection('categorias').doc(categoriaId)
      .collection('jogos').doc(jogoId)
      .collection('transmissoes');

    const todasSnap = await transmissoesRef.get();
    const algumaDescontou = todasSnap.docs.some(d => d.data().descontou === true);
    if (algumaDescontou) {
      // Marca esta também (idempotência defensiva — se outra fez o trabalho,
      // não queremos disparar de novo a cada heartbeat).
      await transmissoesRef.doc(transmissaoId).update({ descontou: true })
        .catch(() => { /* ignore — pode ter sido marcada concurrentement */ });
      return;
    }

    // ── 2. Abate 1 crédito JÁ NO INÍCIO (uma vez por jogo) ──
    //     Sem limiar de tempo: a duração não importa. A transação re-lê
    //     TODAS as transmissões do jogo e só abate se NENHUMA tiver
    //     `descontou: true` — isso fecha a corrida de 2 sessões do mesmo
    //     jogo iniciando juntas (Firestore aborta+retenta a transação
    //     conflitante, que na 2ª passada já vê descontou e desiste).
    const userRef = db.collection('users').doc(ownerId);
    const txRef = transmissoesRef.doc(transmissaoId);

    try {
      await db.runTransaction(async (tx) => {
        const allSnap = await tx.get(transmissoesRef);
        const algumDescontou = allSnap.docs.some(d => d.data().descontou === true);
        if (algumDescontou) {
          // Jogo já cobrado — só marca esta sessão por consistência.
          tx.update(txRef, {
            descontou: true,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }

        // Primeira sessão deste jogo — desconta 1 crédito do owner E marca.
        tx.update(userRef, {
          transmissoesExtras: admin.firestore.FieldValue.increment(-1),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.update(txRef, {
          descontou: true,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      logger.info('[creditos] 1 crédito abatido (início do jogo)', {
        ownerId, jogoId, transmissaoId,
      });
    } catch (err) {
      // Se a transação falhar (rede, conflito de versão), loga mas não
      // joga erro — próximo heartbeat tenta de novo. Idempotente.
      logger.error('[creditos] transação de abate falhou — tentará no próximo heartbeat', {
        ownerId, jogoId, transmissaoId, err,
      });
    }
  },
);
