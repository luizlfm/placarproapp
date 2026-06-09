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
  doc, setDoc, getDoc, writeBatch,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // Modo GERENCIADO (firebase emulators:exec): o env injeta
  // FIRESTORE_EMULATOR_HOST e FIREBASE_EMULATOR_HUB. Passamos só o conteúdo
  // das rules e deixamos o SDK descobrir host/hub sozinho — passar host/port
  // manualmente junto com o hub fazia o loadFirestoreRules dar 500.
  let rulesSource;
  try {
    rulesSource = readFileSync(join(__dirname, 'firestore.rules'), 'utf8');
  } catch {
    rulesSource = readFileSync(join(__dirname, '..', '..', 'placarpro', 'firestore.rules'), 'utf8');
  }

  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: rulesSource },
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
    // Subdoc PII SEM token (caso realista: dono cadastrou pelo admin). Anônimo
    // NÃO deve conseguir ler — valida o bloqueio público da PII.
    await setDoc(doc(db, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente', 'privado', 'dados'), {
      cpf: '111',
    });
  });

  const anon = env.unauthenticatedContext().firestore();
  const dono = env.authenticatedContext(OWNER).firestore();
  const rep = env.authenticatedContext(REP).firestore();
  const outro = env.authenticatedContext(OUTRO).firestore();

  console.log('\n=== FASE 3: PII de jogadores ===');

  await caso('público NÃO lê subdoc PII do jogador', async () => {
    try {
      const s = await getDoc(doc(anon, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente', 'privado', 'dados'));
      console.log('  [debug] anon LEU PII:', JSON.stringify(s.data()), '(exists=', s.exists(), ')');
    } catch (e) {
      console.log('  [debug] anon negado (correto):', e.code ?? e.message);
      return;
    }
    throw new Error('Expected request to fail, but it succeeded.');
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

  await caso('GRÁTIS: criar categoria acima do limite é BLOQUEADO', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'campeonatos', CAMP), { totalCategorias: 5 }, { merge: true });
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

  // CONTROLE: o dono DEVE conseguir criar JOGO (cai no glob, sem limite) —
  // garante que a allowlist não quebrou os writes legítimos via catch-all.
  await caso('dono CRIA jogo (glob permite — sem regressão)', async () => {
    await assertSucceeds(setDoc(doc(dono, 'campeonatos', CAMP, 'categorias', CAT, 'jogos', 'jogo1'), {
      mandanteId: 'a', visitanteId: 'b', status: 'agendado',
    }));
  });
  // CONTROLE: criar EVENTO dentro de um jogo (glob, path profundo) também passa.
  await caso('dono CRIA evento em jogo (glob profundo — sem regressão)', async () => {
    await assertSucceeds(setDoc(doc(dono, 'campeonatos', CAMP, 'categorias', CAT, 'jogos', 'jogo1', 'eventos', 'ev1'), {
      tipo: 'gol', minuto: 10,
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

  // ════════════════════════════════════════════════════════════════
  // CAMINHO-FELIZ: uso LEGÍTIMO que NÃO pode quebrar com as rules novas.
  // Espelha os fluxos reais do app (criar/editar/ler) pra garantir que a
  // blindagem de segurança não trancou o uso normal.
  // ════════════════════════════════════════════════════════════════
  console.log('\n=== CAMINHO-FELIZ (uso legítimo não pode quebrar) ===');

  // Reseta contadores pra dentro do limite (plano grátis: 2 cat, 50 jog).
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'campeonatos', CAMP), { totalCategorias: 1 }, { merge: true });
    await setDoc(doc(ctx.firestore(), 'campeonatos', CAMP, 'categorias', CAT), { totalJogadores: 0 }, { merge: true });
  });

  await caso('dono CRIA categoria DENTRO do limite', async () => {
    await assertSucceeds(setDoc(doc(dono, 'campeonatos', CAMP, 'categorias', 'catOk'), {
      campeonatoId: CAMP, titulo: 'Categoria OK',
    }));
  });

  await caso('dono CRIA jogador DENTRO do limite (com PII no batch)', async () => {
    const b = writeBatch(dono);
    const jRef = doc(dono, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jHappy');
    b.set(jRef, { nome: 'FELIZ', equipeId: EQUIPE, campeonatoId: CAMP, categoriaId: CAT });
    b.set(doc(jRef, 'privado', 'dados'), { cpf: '12345678900', rg: 'MG123' });
    await assertSucceeds(b.commit());
  });

  await caso('dono EDITA placar de jogo (update via glob)', async () => {
    await assertSucceeds(setDoc(doc(dono, 'campeonatos', CAMP, 'categorias', CAT, 'jogos', 'jogo1'), {
      golsMandante: 2, golsVisitante: 1, status: 'em-andamento',
    }, { merge: true }));
  });

  await caso('moderador (gerenciarEquipes) CRIA jogador', async () => {
    const modCtx = env.authenticatedContext(MOD).firestore();
    await assertSucceeds(setDoc(doc(modCtx, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jMod'), {
      nome: 'DO MOD', equipeId: EQUIPE, campeonatoId: CAMP, categoriaId: CAT,
    }));
  });

  await caso('público LISTA jogadores (página pública carrega)', async () => {
    const { getDocs, collection } = await import('firebase/firestore');
    await assertSucceeds(getDocs(collection(anon, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores')));
  });

  await caso('público LÊ a categoria (página pública)', async () => {
    await assertSucceeds(getDoc(doc(anon, 'campeonatos', CAMP, 'categorias', CAT)));
  });

  await caso('dono EDITA o próprio perfil (saveProfile)', async () => {
    await assertSucceeds(setDoc(doc(dono, 'users', OWNER), {
      uid: OWNER, nome: 'Dono Editado', cidade: 'BH',
    }, { merge: true }));
  });

  await caso('representante EDITA jogador da própria equipe (token válido)', async () => {
    const repCtx = env.authenticatedContext(REP).firestore();
    await assertSucceeds(setDoc(
      doc(repCtx, 'campeonatos', CAMP, 'categorias', CAT, 'jogadores', 'jExistente'),
      { nome: 'EXISTENTE EDIT', equipeId: EQUIPE, inscricaoToken: TOKEN },
      { merge: true },
    ));
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
