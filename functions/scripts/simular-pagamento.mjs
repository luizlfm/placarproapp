/**
 * Script de teste: simula o webhook do Mercado Pago marcando uma cobrança
 * como paga e ativando o plano do usuário — exatamente como faria a função
 * `webhookMercadoPago` quando recebe a notificação do MP.
 *
 * Uso:
 *   node scripts/simular-pagamento.mjs <cobrancaId>
 *
 * Autentica via Firestore REST API + token do cache do `firebase login`.
 * Esse script é APENAS pra dev/test em sandbox.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const PROJECT = 'placapro-d276d';

const configPath = path.join(homedir(), '.config', 'configstore', 'firebase-tools.json');
let token;
try {
  const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  token = cfg.tokens?.access_token;
  if (!token) throw new Error('tokens.access_token ausente');
} catch (e) {
  console.error('Não consegui ler o cache do firebase-tools:', e.message);
  console.error('Rode `firebase login` primeiro.');
  process.exit(1);
}

const cobrancaId = process.argv[2];
if (!cobrancaId) {
  console.error('Uso: node scripts/simular-pagamento.mjs <cobrancaId>');
  process.exit(1);
}

const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

// helper: converte firestore doc para JS plano
function unwrap(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('nullValue' in v) out[k] = null;
  }
  return out;
}

// 1) GET cobrança
console.log(`[simular-pagamento] cobrancaId=${cobrancaId}`);
const doc = await api('GET', `/cobrancas/${cobrancaId}`);
const cobranca = unwrap(doc.fields);
console.log(`  status atual: ${cobranca.status}`);
console.log(`  usuário:       ${cobranca.usuarioId} (${cobranca.usuarioEmail})`);
console.log(`  plano:         ${cobranca.planoId} / ${cobranca.periodicidade}`);
console.log(`  valor:         R$ ${(cobranca.valorCentavos / 100).toFixed(2)}`);

if (cobranca.status === 'pago') {
  console.log('\n⚠️  Cobrança já está paga. Saindo sem fazer nada.');
  process.exit(0);
}

const nowIso = new Date().toISOString();

// 2) PATCH cobrança -> pago
console.log('\n→ marcando cobrança como paga...');
await api(
  'PATCH',
  `/cobrancas/${cobrancaId}?updateMask.fieldPaths=status&updateMask.fieldPaths=pagoEm&updateMask.fieldPaths=atualizadoEm`,
  {
    fields: {
      status: { stringValue: 'pago' },
      pagoEm: { timestampValue: nowIso },
      atualizadoEm: { timestampValue: nowIso },
    },
  },
);
console.log('✓ Cobrança PAGA');

// 3) PATCH user -> ativa plano
console.log('→ ativando plano do usuário...');
await api(
  'PATCH',
  `/users/${cobranca.usuarioId}?updateMask.fieldPaths=plano&updateMask.fieldPaths=atualizadoEm`,
  {
    fields: {
      plano: { stringValue: cobranca.planoId },
      atualizadoEm: { timestampValue: nowIso },
    },
  },
);
console.log(`✓ users/${cobranca.usuarioId}.plano = ${cobranca.planoId}`);

// 4) POST logs (cria doc novo)
console.log('→ registrando log de auditoria...');
await api('POST', `/logs`, {
  fields: {
    acao: { stringValue: 'cobranca_paga' },
    descricao: {
      stringValue: `[SIMULAÇÃO LOCAL] Pagamento confirmado — usuário promovido ao plano ${cobranca.planoId}`,
    },
    usuarioId: { stringValue: cobranca.usuarioId },
    usuarioLabel: { stringValue: cobranca.usuarioNome ?? cobranca.usuarioEmail ?? '' },
    meta: {
      mapValue: {
        fields: {
          cobrancaId: { stringValue: cobrancaId },
          mpId: { stringValue: cobranca.mpId ?? '' },
          planoId: { stringValue: cobranca.planoId },
          simulado: { booleanValue: true },
        },
      },
    },
    criadoEm: { timestampValue: nowIso },
  },
});
console.log('✓ Log criado');

console.log('\n✅ Tudo certo! Recarrega o app — seu plano deve estar ativo.');
