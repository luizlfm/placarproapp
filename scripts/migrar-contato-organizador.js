/* eslint-disable no-console */
/**
 * MIGRAÇÃO DE PII DE CONTATO DO ORGANIZADOR (LGPD)
 * ===================================================================
 * Move `email`, `telefone` e `redes.whatsapp` do doc público `users/{uid}`
 * para a subcoleção PRIVADA `users/{uid}/privado/contato` — e os REMOVE do
 * doc raiz (que é legível por qualquer um).
 *
 * Por padrão (privacy-by-default), NÃO publica o contato: o organizador
 * passa a ter que optar (toggle "Exibir contato na página pública"). Como
 * antes esses dados JÁ eram públicos, você pode preservar o comportamento
 * atual de quem já tinha contato preenchido passando `--publicar-existentes`
 * — aí o script também grava `users/{uid}/publico/contato` e seta o flag
 * `contatoPublico: true`.
 *
 * COMO RODAR (precisa de credenciais Admin — ver migrar-pii-jogadores.js):
 *   # dry-run primeiro (não escreve nada):
 *   node scripts/migrar-contato-organizador.js --project=placapro-d276d --dry-run
 *
 *   # privacy-by-default (contato vira privado; some da página pública):
 *   node scripts/migrar-contato-organizador.js --project=placapro-d276d
 *
 *   # OU preservando o que já era público:
 *   node scripts/migrar-contato-organizador.js --project=placapro-d276d --publicar-existentes
 *
 * IDEMPOTENTE: jogadores/organizadores já migrados (sem email/telefone no
 * doc raiz) são pulados.
 */
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PUBLICAR = args.includes('--publicar-existentes');
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : undefined;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  console.log(`\n=== Migração contato organizador ${DRY_RUN ? '(DRY-RUN)' : '(EXECUÇÃO REAL)'} ===`);
  console.log(`Projeto: ${projectId || '(default)'}`);
  console.log(`Modo publicação: ${PUBLICAR ? 'PUBLICAR existentes (preserva atual)' : 'PRIVADO por padrão (some da pág. pública)'}\n`);

  const snap = await db.collection('users').get();
  console.log(`Usuários encontrados: ${snap.size}`);

  let comContato = 0;
  let migrados = 0;
  let pulados = 0;
  let erros = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const email = data.email;
    const telefone = data.telefone;
    const whatsapp = data.redes && data.redes.whatsapp;

    const temContatoNoRaiz =
      (email !== undefined && email !== null && email !== '') ||
      (telefone !== undefined && telefone !== null && telefone !== '');

    if (!temContatoNoRaiz) { pulados++; continue; }
    comContato++;

    const contato = {};
    if (email) contato.email = email;
    if (telefone) contato.telefone = telefone;
    if (whatsapp) contato.whatsapp = whatsapp;

    if (DRY_RUN) {
      console.log(`  [dry] users/${doc.id} → priv: ${Object.keys(contato).join(', ')}${PUBLICAR ? ' (+público)' : ''}`);
      continue;
    }

    try {
      const batch = db.batch();
      // 1) Grava contato no subdoc privado.
      batch.set(doc.ref.collection('privado').doc('contato'), {
        ...contato,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 2) Remove email/telefone do doc raiz (público).
      batch.update(doc.ref, {
        email: admin.firestore.FieldValue.delete(),
        telefone: admin.firestore.FieldValue.delete(),
      });

      // 3) Opcional: preserva o que já era público.
      if (PUBLICAR) {
        batch.set(doc.ref.collection('publico').doc('contato'), {
          ...contato,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.update(doc.ref, { contatoPublico: true });
      }

      await batch.commit();
      migrados++;
      if (migrados % 50 === 0) console.log(`  ... ${migrados} migrados`);
    } catch (err) {
      erros++;
      console.error(`  ERRO em users/${doc.id}:`, err.message);
    }
  }

  console.log('\n=== Resumo ===');
  console.log(`Total usuários.........: ${snap.size}`);
  console.log(`Com contato (alvo).....: ${comContato}`);
  console.log(`Sem contato (pulados)..: ${pulados}`);
  if (!DRY_RUN) {
    console.log(`Migrados com sucesso...: ${migrados}`);
    console.log(`Erros..................: ${erros}`);
  } else {
    console.log('\nDRY-RUN: nada foi escrito.');
  }
  process.exit(erros > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Falha geral:', err);
  process.exit(1);
});
