import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const REGION = 'southamerica-east1';

/**
 * Registra UMA visita ao site.
 *
 * Chamada pelo app no boot, 1x por sessão (ver VisitasService no front),
 * inclusive por visitantes NÃO logados — `onCall` aceita chamada anônima.
 *
 * Incrementa:
 *   - `estatisticas/visitas.total`            (total geral, lifetime)
 *   - `estatisticas/visitas/dias/{YYYY-MM-DD}.count`  (por dia, fuso SP)
 *
 * Escreve via Admin SDK → bypassa as Security Rules. As Rules só liberam
 * LEITURA pra admin master e bloqueiam qualquer escrita do cliente.
 */
export const registrarVisita = onCall({ region: REGION }, async () => {
  try {
    const db = admin.firestore();

    // Data local (São Paulo) no formato YYYY-MM-DD pra agrupar por dia.
    const hoje = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const batch = db.batch();
    batch.set(
      db.doc('estatisticas/visitas'),
      { total: FieldValue.increment(1), atualizadoEm: FieldValue.serverTimestamp() },
      { merge: true },
    );
    batch.set(
      db.doc(`estatisticas/visitas/dias/${hoje}`),
      { data: hoje, count: FieldValue.increment(1) },
      { merge: true },
    );
    await batch.commit();

    return { ok: true };
  } catch (err) {
    logger.error('[registrarVisita] erro', err);
    return { ok: false };
  }
});
