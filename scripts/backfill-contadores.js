/* eslint-disable no-console */
/**
 * BACKFILL DOS CONTADORES DE LIMITE DE PLANO
 * ===================================================================
 * As Cloud Functions em `functions/src/contadores.ts` só atualizam os
 * contadores a partir de NOVOS create/delete. Os dados JÁ EXISTENTES não
 * têm os campos. Este script calcula e grava os valores iniciais:
 *
 *   - users/{uid}.totalCampeonatos
 *   - campeonatos/{id}.totalCategorias
 *   - campeonatos/{id}/categorias/{cid}.totalJogadores
 *
 * As Firestore Rules de limite comparam contra esses contadores — então
 * RODE ESTE BACKFILL antes (ou junto) de publicar as novas rules, senão
 * os contadores ficam zerados e o limite não reflete o que já existe.
 *
 * COMO RODAR (mesmas credenciais da migração de PII):
 *   node scripts/backfill-contadores.js --project=placapro-d276d --dry-run
 *   node scripts/backfill-contadores.js --project=placapro-d276d
 *
 * IDEMPOTENTE: recalcula do zero a cada execução (set, não increment).
 */
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : undefined;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  console.log(`\n=== Backfill contadores ${DRY_RUN ? '(DRY-RUN)' : '(EXECUÇÃO REAL)'} ===`);
  console.log(`Projeto: ${projectId || '(default)'}\n`);

  // 1) Campeonatos por dono
  const campsSnap = await db.collection('campeonatos').get();
  const porDono = {};
  for (const c of campsSnap.docs) {
    const ownerId = c.data().ownerId;
    if (ownerId) porDono[ownerId] = (porDono[ownerId] || 0) + 1;
  }
  console.log(`Campeonatos: ${campsSnap.size} | Donos distintos: ${Object.keys(porDono).length}`);

  if (!DRY_RUN) {
    for (const [uid, total] of Object.entries(porDono)) {
      await db.doc(`users/${uid}`).set({ totalCampeonatos: total }, { merge: true });
    }
  }

  // 2) Categorias por campeonato + 3) Jogadores por categoria
  let totalCats = 0;
  let totalJogs = 0;
  for (const c of campsSnap.docs) {
    const catsSnap = await c.ref.collection('categorias').get();
    totalCats += catsSnap.size;
    if (!DRY_RUN) {
      await c.ref.set({ totalCategorias: catsSnap.size }, { merge: true });
    }
    for (const cat of catsSnap.docs) {
      const jogsSnap = await cat.ref.collection('jogadores').get();
      totalJogs += jogsSnap.size;
      if (!DRY_RUN) {
        await cat.ref.set({ totalJogadores: jogsSnap.size }, { merge: true });
      }
    }
  }

  console.log(`Categorias totais: ${totalCats}`);
  console.log(`Jogadores totais.: ${totalJogs}`);
  console.log(DRY_RUN
    ? '\nDRY-RUN: nada gravado. Rode sem --dry-run pra aplicar.'
    : '\nBackfill concluído.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Falha no backfill:', err);
  process.exit(1);
});
