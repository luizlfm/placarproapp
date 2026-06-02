/**
 * Rate limiting simples para Cloud Functions, baseado em Firestore.
 *
 * Sem dependência externa (Redis etc.) — usa uma transação atômica sobre um
 * doc por "bucket" (`rateLimits/{escopo}__{chave}`). Janela FIXA: conta quantas
 * chamadas ocorreram na janela atual; ao estourar `max`, rejeita.
 *
 * Não é um limitador distribuído perfeito (janela fixa pode permitir picos na
 * virada), mas é mais que suficiente como ANTI-ABUSO de endpoints sensíveis
 * (geração de token, criação de cobrança) — barra scripts/brute force.
 *
 * Uso:
 *   await assertRateLimit({ escopo: 'token', chave: uid ?? ip, max: 30, janelaSeg: 60 });
 */
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

interface RateLimitOpts {
  /** Identificador do endpoint (ex.: 'token', 'pagamento'). */
  escopo: string;
  /** Chave do chamador — UID se logado, senão IP. */
  chave: string;
  /** Máximo de chamadas permitidas na janela. */
  max: number;
  /** Tamanho da janela em segundos. */
  janelaSeg: number;
}

/**
 * Lança `HttpsError('resource-exhausted')` quando a chave excede o limite.
 * Fail-open: se a leitura/escrita do contador falhar (ex.: erro transitório
 * do Firestore), NÃO bloqueia a chamada — segurança não deve derrubar o
 * serviço por um erro de infraestrutura do próprio limitador.
 */
export async function assertRateLimit(opts: RateLimitOpts): Promise<void> {
  const { escopo, chave, max, janelaSeg } = opts;
  if (!chave) return; // sem chave identificável, não dá pra limitar

  const db = admin.firestore();
  // Sanitiza a chave pra um id de documento válido.
  const chaveSegura = chave.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
  const ref = db.collection('rateLimits').doc(`${escopo}__${chaveSegura}`);
  const agoraMs = Date.now();
  const janelaMs = janelaSeg * 1000;

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as { inicioMs?: number; contagem?: number } | undefined;

      // Janela expirada (ou inexistente) → começa nova janela.
      if (!data || !data.inicioMs || (agoraMs - data.inicioMs) >= janelaMs) {
        tx.set(ref, { inicioMs: agoraMs, contagem: 1 });
        return;
      }

      // Dentro da janela: estourou o limite?
      if ((data.contagem ?? 0) >= max) {
        throw new HttpsError(
          'resource-exhausted',
          'Muitas requisições em pouco tempo. Tente novamente em instantes.',
        );
      }
      tx.update(ref, { contagem: admin.firestore.FieldValue.increment(1) });
    });
  } catch (err) {
    // Repropaga SÓ o erro de limite; engole erros de infra (fail-open).
    if (err instanceof HttpsError && err.code === 'resource-exhausted') {
      throw err;
    }
    logger.warn('[rateLimit] falha no limitador (fail-open)', { escopo, erro: String(err) });
  }
}

/** Extrai uma chave de chamador a partir do request (uid logado ou IP). */
export function chaveDoChamador(request: {
  auth?: { uid?: string } | null;
  rawRequest?: { ip?: string; headers?: Record<string, unknown> };
}): string {
  const uid = request.auth?.uid;
  if (uid) return `uid:${uid}`;
  const fwd = request.rawRequest?.headers?.['x-forwarded-for'];
  const ip = (Array.isArray(fwd) ? fwd[0] : (fwd as string | undefined))
    ?? request.rawRequest?.ip
    ?? 'anon';
  return `ip:${String(ip).split(',')[0].trim()}`;
}
