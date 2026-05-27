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
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

/**
 * Limite (em segundos) que dispara o desconto de 1 crédito.
 * 9000s = 2h30. MANTER IGUAL ao client (placarpro/.../transmissao.constants.ts).
 */
const SEGUNDOS_PARA_CONSUMIR_CREDITO = 9000;

/**
 * Listener que dispara em CADA update do doc transmissoes/{tId} — incluindo
 * heartbeats a cada 30s. Faz a lógica de abate quando aplicável.
 *
 * Path do trigger:
 *   campeonatos/{cId}/categorias/{catId}/jogos/{jId}/transmissoes/{tId}
 */
export const onTransmissaoHeartbeat = onDocumentUpdated(
  {
    document: 'campeonatos/{campeonatoId}/categorias/{categoriaId}/jogos/{jogoId}/transmissoes/{transmissaoId}',
    region: 'southamerica-east1',
  },
  async (event) => {
    const after = event.data?.after.data();
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

    // ── 2. Soma o tempo total acumulado deste jogo ──
    const totalSegundos = todasSnap.docs.reduce(
      (acc, d) => acc + (Number(d.data().duracaoSegundos) || 0),
      0,
    );

    logger.info('[creditos] heartbeat processado', {
      jogoId, transmissaoId, totalSegundos, threshold: SEGUNDOS_PARA_CONSUMIR_CREDITO,
    });

    // Ainda não bateu 2h30 — nada a fazer agora.
    if (totalSegundos < SEGUNDOS_PARA_CONSUMIR_CREDITO) return;

    // ── 3. Cruzou o threshold — abate 1 crédito em transação ──
    //     Transação garante atomicidade: ou ambos os writes funcionam
    //     (decrementa user + marca transmissão), ou nenhum acontece.
    //     Idempotência via re-leitura dentro da transação: se outro
    //     trigger já marcou `descontou: true` antes da gente, aborta.
    const userRef = db.collection('users').doc(ownerId);
    const txRef = transmissoesRef.doc(transmissaoId);

    try {
      await db.runTransaction(async (tx) => {
        const txSnap = await tx.get(txRef);
        if (txSnap.data()?.descontou === true) {
          // Outro processo concurrentement abateu — sai sem fazer nada.
          return;
        }

        // Re-checa o total dentro da transação (snapshots fora podem ter
        // ficado estagnados se o broadcaster mandou múltiplos heartbeats
        // rápidos). Se ficou abaixo de 9000 por algum motivo, aborta.
        // (Em prática nunca vai acontecer porque heartbeat só cresce.)
        const txAllSnap = await transmissoesRef.get();
        const totalAtomic = txAllSnap.docs.reduce(
          (acc, d) => acc + (Number(d.data().duracaoSegundos) || 0),
          0,
        );
        if (totalAtomic < SEGUNDOS_PARA_CONSUMIR_CREDITO) return;

        // OK — desconta 1 crédito do owner E marca a transmissão atual.
        tx.update(userRef, {
          transmissoesExtras: admin.firestore.FieldValue.increment(-1),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.update(txRef, {
          descontou: true,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      logger.info('[creditos] 1 crédito abatido', {
        ownerId, jogoId, transmissaoId, totalSegundos,
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
