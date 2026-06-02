/**
 * Testes das Firestore Security Rules contra o emulador.
 *
 * Foco: os fluxos sensíveis introduzidos nas 5 fases de segurança, em
 * especial o fluxo CRÍTICO de inscrição pública (create de jogador + subdoc
 * PII no MESMO batch) — o bug que o get() do pai não-commitado causava.
 *
 * Roda via:  npm test    (que chama `firebase emulators:exec`)
 * Requer Java (emulador) + deps instaladas (npm install nesta pasta).
 *
 * NÃO usa credenciais reais — tudo roda no emulador local, isolado.
 */
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore';

const PROJECT_ID = 'placarpro-rules-test';

// ─── Mini framework de asserção ──────────────────────────────────────────────
let passes = 0;
let fails = 0;
const falhas = [];
async function caso(nome, fn) {
  try {
    await fn();
    passes++;
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    fails++;
    falhas.push(nome);
    console.error(`  ✗ ${nome}\n      ${err?.message ?? err}`);
  }
}

const OWNER = 'owner-uid';
const MOD = 'mod-uid';
const REP = 'rep-uid';      // representante de equipe (espectador logado)
const OUTRO = 'outro-uid';  // usuário sem relação
const CAMP = 'camp1';
const CAT = 'cat1';
const EQUIPE = 'eq1';
const TOKEN = 'TOKENinscricao123456';

async function main() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: undefined }, // usa as rules do firebase.json (emuladas)
  });

  // ── SEED com privilégios de admin (ignora rules) ──
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Owner com plano GRÁTIS (limite: 1 camp, 2 cat, 50 jogadores).
    await setDoc(doc(db, 'users', OWNER), { uid: OWNER, plano: 'gratis', nome: 'Dono' });
    await setDoc(doc(db, 'users', MOD), { uid: MOD, nome: 'Mod', moderadorValidado: true });
    await setDoc(doc(db, 'users', REP), { uid: REP, nome: 'Rep' });
    await setDoc(doc(db, 'users', OUTRO), { uid: OUTRO, nome: 'Outro' });

    // Campeonato público do owner, com moderador validado e contadores no limite.
    await setDoc(doc(db, 'campeonatos', CAMP), {
      ownerId: OWNER, publico: true,
      moderadorUids: [MOD],
      gerenciarEquipesUids: [OWNER, MOD],
      editarCampeonatoUids: [OWNER, MOD],
      totalCategorias: 1,
      titulo: 'Camp Teste',
    });
    await setDoc(doc(db, 'campeonatos', CAMP, 'categorias', CAT), {
      campeonatoId: CAMP, titulo: 'Cat', totalJogadores: 0,
    });
    await setDoc(doc(db, 'campeonatos', CAMP, 'categorias', CAT, 'equipes', EQUIPE), {
      nome: 'Equipe 1',
    });
    // Convite de inscrição válido pra equipe.
    await setDoc(doc(db, 'convitesEquipe', TOKEN), {
      campeonatoId: CAMP, categoriaId: CAT, equipeId: EQUIPE,
    });
    // Jogador já existente (pra testes de update e leitura de PII).
    await setDoc(doc(db, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente'), {
      nome: 'EXISTENTE', equipeId: EQUIPE, campeonatoId: CAMP, categoriaId: CAT,
    });
    await setDoc(doc(db, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente', 'privado', 'dados'), {
      cpf: '111', inscricaoToken: TOKEN, equipeId: EQUIPE,
    });
  });

  const anon = env.unauthenticatedContext().firestore();
  const dono = env.authenticatedContext(OWNER).firestore();
  const rep = env.authenticatedContext(REP).firestore();
  const outro = env.authenticatedContext(OUTRO).firestore();

  console.log('\n=== FASE 3: PII de jogadores ===');

  await caso('público NÃO lê subdoc PII do jogador', async () => {
    await assertFails(getDoc(doc(anon, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente', 'privado', 'dados')));
  });

  await caso('dono LÊ subdoc PII do jogador', async () => {
    await assertSucceeds(getDoc(doc(dono, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente', 'privado', 'dados')));
  });

  await caso('público LÊ doc público do jogador (nome/foto)', async () => {
    await assertSucceeds(getDoc(doc(anon, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente')));
  });

  await caso('BUG 1: inscrição pública cria jogador + subdoc PII no MESMO batch', async () => {
    const b = writeBatch(rep);
    const jRef = doc(rep, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jNovo');
    // Doc público do jogador (sem PII) — com token+equipeId pra rule de create.
    b.set(jRef, { nome: 'NOVO', equipeId: EQUIPE, inscricaoToken: TOKEN, campeonatoId: CAMP, categoriaId: CAT });
    // Subdoc PII no mesmo batch — token+equipeId no payload (caminho A da rule).
    b.set(doc(jRef, 'privado', 'dados'), { documento: '999', inscricaoToken: TOKEN, equipeId: EQUIPE });
    await assertSucceeds(b.commit());
  });

  await caso('representante COM token errado é BLOQUEADO no subdoc PII', async () => {
    const jRef = doc(rep, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jBloq');
    const b = writeBatch(rep);
    b.set(jRef, { nome: 'X', equipeId: EQUIPE, inscricaoToken: 'TOKEN-ERRADO', campeonatoId: CAMP, categoriaId: CAT });
    b.set(doc(jRef, 'privado', 'dados'), { documento: '1', inscricaoToken: 'TOKEN-ERRADO', equipeId: EQUIPE });
    await assertFails(b.commit());
  });

  console.log('\n=== FASE 2: limites de plano ===');

  await caso('GRÁTIS: criar 2ª categoria é BLOQUEADO (limite 2, já tem 1... testa no limite)', async () => {
    // Sobe o contador pro limite (2) e tenta criar a 3ª.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'campeonatos', CAMP), { totalCategorias: 2 }, { merge: true });
    });
    await assertFails(setDoc(doc(dono, 'campeonatos', CAMP, 'categorias', 'catNova'), {
      campeonatoId: CAMP, titulo: 'Nova',
    }));
  });

  await caso('GRÁTIS: criar jogador acima de 50 é BLOQUEADO', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'campeonatos', CAMP, 'categorias', CAT), { totalJogadores: 50 }, { merge: true });
    });
    await assertFails(setDoc(doc(dono, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jLimite'), {
      nome: 'LIMITE', equipeId: EQUIPE, campeonatoId: CAMP, categoriaId: CAT,
    }));
  });

  console.log('\n=== FASE 4: contato do organizador ===');

  await caso('público LÊ users/{uid}/publico/contato', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'publico', 'contato'), { email: 'pub@x.com' });
    });
    await assertSucceeds(getDoc(doc(anon, 'users', OWNER, 'publico', 'contato')));
  });

  await caso('público NÃO lê users/{uid}/privado/contato', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', OWNER, 'privado', 'contato'), { email: 'priv@x.com' });
    });
    await assertFails(getDoc(doc(anon, 'users', OWNER, 'privado', 'contato')));
  });

  await caso('outro usuário NÃO lê meu contato privado', async () => {
    await assertFails(getDoc(doc(outro, 'users', OWNER, 'privado', 'contato')));
  });

  console.log('\n=== FASE 5: rateLimits inacessível ===');

  await caso('cliente NÃO lê rateLimits', async () => {
    await assertFails(getDoc(doc(dono, 'rateLimits', 'x')));
  });
  await caso('cliente NÃO escreve rateLimits', async () => {
    await assertFails(setDoc(doc(dono, 'rateLimits', 'x'), { contagem: 0 }));
  });

  await env.cleanup();

  console.log(`\n=== Resultado: ${passes} passou, ${fails} falhou ===`);
  if (fails > 0) {
    console.error('Falhas:', falhas.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
