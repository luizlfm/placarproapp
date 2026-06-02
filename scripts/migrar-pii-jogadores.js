/* eslint-disable no-console */
/**
 * MIGRAÇÃO DE PII DOS JOGADORES (LGPD)
 * ===================================================================
 * Move os campos sensíveis (cpf, rg, dataNascimento, telefone, documento)
 * de cada `campeonatos/{c}/categorias/{cat}/jogadores/{j}` para a subcoleção
 * PRIVADA `.../jogadores/{j}/privado/dados` — e os REMOVE do doc público.
 *
 * Depois desta migração, esses dados deixam de ser legíveis em campeonatos
 * públicos (fechando o vazamento). As telas admin leem do subdoc privado.
 *
 * COMO RODAR (precisa de credenciais Admin — NÃO roda no navegador):
 *
 *   1. Tenha as credenciais do projeto. Duas opções:
 *      a) Service account JSON:
 *         set GOOGLE_APPLICATION_CREDENTIALS=C:\caminho\service-account.json   (Windows)
 *         export GOOGLE_APPLICATION_CREDENTIALS=/caminho/service-account.json  (Linux/Mac)
 *      b) gcloud ADC:  gcloud auth application-default login
 *
 *   2. Instale a dep (na raiz do repo ou em functions/, que já tem):
 *         npm i firebase-admin
 *
 *   3. SEMPRE rode primeiro o dry-run pra ver o impacto SEM escrever nada:
 *         node scripts/migrar-pii-jogadores.js --project=placapro-d276d --dry-run
 *
 *   4. Confira a contagem e então execute de verdade:
 *         node scripts/migrar-pii-jogadores.js --project=placapro-d276d
 *
 * É IDEMPOTENTE: rodar duas vezes não duplica nem corrompe — jogadores já
 * migrados (sem PII no doc público) são pulados.
 *
 * RECOMENDADO: rode a migração ANTES de publicar as novas Firestore Rules,
 * ou logo após. Enquanto não migrar, as telas admin continuam funcionando
 * pelo fallback retrocompatível (leem PII do doc público se o subdoc faltar).
 */
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : undefined;

const CAMPOS_PII = ['cpf', 'rg', 'dataNascimento', 'telefone', 'documento'];

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  console.log(`\n=== Migração PII jogadores ${DRY_RUN ? '(DRY-RUN — nada será escrito)' : '(EXECUÇÃO REAL)'} ===`);
  console.log(`Projeto: ${projectId || '(default do ambiente)'}\n`);

  // collectionGroup pega TODAS as subcoleções `jogadores` de uma vez.
  const snap = await db.collectionGroup('jogadores').get();
  console.log(`Jogadores encontrados: ${snap.size}`);

  let comPii = 0;
  let migrados = 0;
  let pulados = 0;
  let erros = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const pii = {};
    let temPii = false;
    for (const campo of CAMPOS_PII) {
      if (data[campo] !== undefined && data[campo] !== null && data[campo] !== '') {
        pii[campo] = data[campo];
        temPii = true;
      }
    }
    if (!temPii) { pulados++; continue; }
    comPii++;

    if (DRY_RUN) {
      console.log(`  [dry] ${doc.ref.path} → moveria: ${Object.keys(pii).join(', ')}`);
      continue;
    }

    try {
      const privadoRef = doc.ref.collection('privado').doc('dados');
      const limpeza = {};
      for (const campo of Object.keys(pii)) {
        limpeza[campo] = admin.firestore.FieldValue.delete();
      }
      const batch = db.batch();
      batch.set(privadoRef, {
        ...pii,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.update(doc.ref, limpeza);
      await batch.commit();
      migrados++;
      if (migrados % 50 === 0) console.log(`  ... ${migrados} migrados`);
    } catch (err) {
      erros++;
      console.error(`  ERRO em ${doc.ref.path}:`, err.message);
    }
  }

  console.log('\n=== Resumo ===');
  console.log(`Total jogadores........: ${snap.size}`);
  console.log(`Com PII (alvo).........: ${comPii}`);
  console.log(`Sem PII (pulados)......: ${pulados}`);
  if (!DRY_RUN) {
    console.log(`Migrados com sucesso...: ${migrados}`);
    console.log(`Erros..................: ${erros}`);
  } else {
    console.log('\nDRY-RUN: nada foi escrito. Rode sem --dry-run pra aplicar.');
  }
  process.exit(erros > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Falha geral na migração:', err);
  process.exit(1);
});
