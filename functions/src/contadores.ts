/**
 * Contadores denormalizados para enforce de limites de plano nas Rules.
 *
 * Firestore Security Rules NÃO conseguem fazer `count()` de uma coleção.
 * Pra impedir (server-side) que um usuário burle os limites do plano
 * escrevendo direto no banco, mantemos contadores atualizados por triggers:
 *
 *   - users/{uid}.totalCampeonatos              ← nº de campeonatos do dono
 *   - campeonatos/{id}.totalCategorias          ← nº de categorias
 *   - campeonatos/{id}/categorias/{cid}.totalJogadores  ← nº de jogadores
 *
 * As Rules comparam o contador atual contra `maxX` do plano e bloqueiam o
 * create quando já está no limite. Como o trigger roda DEPOIS do create, o
 * contador reflete o estado anterior — exatamente o que a rule precisa pra
 * decidir "ainda cabe mais um?".
 *
 * NOTA: `onDocumentWritten` é idempotente o suficiente — recalcula o delta
 * (+1 no create, -1 no delete) com base na existência de before/after.
 */
import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

const REGION = 'southamerica-east1';

// ─── Campeonatos por usuário ────────────────────────────────────────────────
export const onCampeonatoCriado = onDocumentCreated(
  { region: REGION, document: 'campeonatos/{campId}' },
  async (event) => {
    const ownerId = event.data?.data()?.ownerId as string | undefined;
    if (!ownerId) return;
    try {
      await admin.firestore().doc(`users/${ownerId}`).set(
        { totalCampeonatos: FieldValue.increment(1) },
        { merge: true },
      );
    } catch (err) {
      logger.error('[contadores] onCampeonatoCriado', err);
    }
  },
);

export const onCampeonatoRemovido = onDocumentDeleted(
  { region: REGION, document: 'campeonatos/{campId}' },
  async (event) => {
    const ownerId = event.data?.data()?.ownerId as string | undefined;
    if (!ownerId) return;
    try {
      await admin.firestore().doc(`users/${ownerId}`).set(
        { totalCampeonatos: FieldValue.increment(-1) },
        { merge: true },
      );
    } catch (err) {
      logger.error('[contadores] onCampeonatoRemovido', err);
    }
  },
);

// ─── Categorias por campeonato ──────────────────────────────────────────────
export const onCategoriaCriada = onDocumentCreated(
  { region: REGION, document: 'campeonatos/{campId}/categorias/{catId}' },
  async (event) => {
    try {
      await admin.firestore().doc(`campeonatos/${event.params.campId}`).set(
        { totalCategorias: FieldValue.increment(1) },
        { merge: true },
      );
    } catch (err) {
      logger.error('[contadores] onCategoriaCriada', err);
    }
  },
);

export const onCategoriaRemovida = onDocumentDeleted(
  { region: REGION, document: 'campeonatos/{campId}/categorias/{catId}' },
  async (event) => {
    try {
      await admin.firestore().doc(`campeonatos/${event.params.campId}`).set(
        { totalCategorias: FieldValue.increment(-1) },
        { merge: true },
      );
    } catch (err) {
      logger.error('[contadores] onCategoriaRemovida', err);
    }
  },
);

// ─── Jogadores por categoria ────────────────────────────────────────────────
export const onJogadorCriado = onDocumentCreated(
  { region: REGION, document: 'campeonatos/{campId}/categorias/{catId}/jogadores/{jogId}' },
  async (event) => {
    try {
      await admin.firestore()
        .doc(`campeonatos/${event.params.campId}/categorias/${event.params.catId}`)
        .set({ totalJogadores: FieldValue.increment(1) }, { merge: true });
    } catch (err) {
      logger.error('[contadores] onJogadorCriado', err);
    }
  },
);

export const onJogadorRemovido = onDocumentDeleted(
  { region: REGION, document: 'campeonatos/{campId}/categorias/{catId}/jogadores/{jogId}' },
  async (event) => {
    try {
      await admin.firestore()
        .doc(`campeonatos/${event.params.campId}/categorias/${event.params.catId}`)
        .set({ totalJogadores: FieldValue.increment(-1) }, { merge: true });
    } catch (err) {
      logger.error('[contadores] onJogadorRemovido', err);
    }
  },
);
