/**
 * Script de migração ÚNICO — corrige o moderador "Moderado" que aceitou
 * o convite quando a CF aceitarConviteModerador ainda estava bugada.
 *
 * Como rodar:
 *   cd functions
 *   node scripts/fix-moderador.js
 *
 * Usa o access_token OAuth do `firebase login` armazenado em
 * ~/.config/configstore/firebase-tools.json — não requer service account
 * nem gcloud CLI.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ─── Dados do caso ──────────────────────────────────────────────────
const PROJECT_ID = 'placapro-d276d';
const CAMPEONATO_ID = 'iGJP8l5Zaw27OEw4aaRR';
// UID atual gravado no array do campeonato (errado — vem das migrações
// anteriores onde lemos o UID errado do screenshot do console).
const MOD_ID_PLACEHOLDER = 'E5N417QqudXK8h1G7QgGutbPidL2';
// UID REAL do moderador (confirmado via query users/moderadorValidado=true:
// o doc com tipo=moderador e nome=Moderador). Cuidado com `l` (L minúsculo)
// na posição 5 e `O` (O maiúsculo) na posição 18 — fácil de confundir
// com `1` e `Q` em screenshots de fontes monoespaçadas.
const UID_REAL = 'E5N4l7QqudXK8h1G7OgGutbPidL2';
const NOME = 'Moderado';
const EMAIL = 'moderador@placarproapp.com';
// UIDs criados por engano nas tentativas anteriores — vamos limpar
// `moderadorValidado` deles pra não ficarem com flag inerte.
const UIDS_PARA_LIMPAR = [
  '6HBorn05JYZdwvwKyQn7CiXpXDF3',
  'E5N417QqudXK8h1G7QgGutbPidL2',
];
// ────────────────────────────────────────────────────────────────────

// ─── Refresh-token client (firebase-tools OAuth client) ─────────────
const FIREBASE_CLIENT_ID =
  '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FIREBASE_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
// ────────────────────────────────────────────────────────────────────

function readFirebaseConfig() {
  const candidates = [
    path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
    path.join(
      process.env.APPDATA || '',
      'configstore',
      'firebase-tools.json',
    ),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error(
    'firebase-tools.json não encontrado. Rode `firebase login` primeiro.',
  );
}

function postForm(host, pathStr, formObj) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(formObj)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const req = https.request(
      {
        host,
        path: pathStr,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`${res.statusCode}: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function reqJson(method, urlStr, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(
      {
        host: u.host,
        path: u.pathname + u.search,
        method,
        headers,
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            reject(new Error(`${method} ${urlStr} → ${res.statusCode}: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getFreshAccessToken() {
  const cfg = readFirebaseConfig();
  if (!cfg.tokens || !cfg.tokens.refresh_token) {
    throw new Error('refresh_token ausente no firebase-tools.json');
  }
  // Tenta usar o access_token existente se ainda for válido
  if (
    cfg.tokens.access_token &&
    cfg.tokens.expires_at &&
    cfg.tokens.expires_at > Date.now() + 60_000
  ) {
    return cfg.tokens.access_token;
  }
  // Faz refresh
  const resp = await postForm('oauth2.googleapis.com', '/token', {
    client_id: FIREBASE_CLIENT_ID,
    client_secret: FIREBASE_CLIENT_SECRET,
    refresh_token: cfg.tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  return resp.access_token;
}

// ─── Firestore REST: conversor de valores ──────────────────────────
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFs) } };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFs(v[k]);
    return { mapValue: { fields } };
  }
  throw new Error(`Tipo não suportado: ${typeof v}`);
}
function fromFs(val) {
  if (!val || typeof val !== 'object') return val;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFs);
  }
  if ('mapValue' in val) {
    const out = {};
    const f = val.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fromFs(f[k]);
    return out;
  }
  return val;
}
function fieldsToObject(fields) {
  if (!fields) return {};
  const out = {};
  for (const k of Object.keys(fields)) out[k] = fromFs(fields[k]);
  return out;
}
function objectToFields(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = toFs(obj[k]);
  return out;
}
// ────────────────────────────────────────────────────────────────────

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function getDoc(token, col, id) {
  try {
    const doc = await reqJson('GET', `${BASE}/${col}/${id}`, token);
    return fieldsToObject(doc.fields);
  } catch (e) {
    if (String(e.message).startsWith('GET') && /404/.test(e.message)) {
      return null;
    }
    throw e;
  }
}

async function patchDoc(token, col, id, partialObj, createIfMissing = false) {
  const fieldPaths = Object.keys(partialObj);
  const params = new URLSearchParams();
  for (const f of fieldPaths) params.append('updateMask.fieldPaths', f);
  if (!createIfMissing) params.append('currentDocument.exists', 'true');
  const url = `${BASE}/${col}/${id}?${params.toString()}`;
  await reqJson('PATCH', url, token, { fields: objectToFields(partialObj) });
}

async function main() {
  console.log('→ Buscando access_token via firebase-tools…');
  const token = await getFreshAccessToken();
  console.log('✓ Token obtido');

  console.log(`→ Lendo campeonatos/${CAMPEONATO_ID}…`);
  const camp = await getDoc(token, 'campeonatos', CAMPEONATO_ID);
  if (!camp) {
    console.error(`Campeonato ${CAMPEONATO_ID} não encontrado.`);
    process.exit(1);
  }
  const moderadores = Array.isArray(camp.moderadores)
    ? [...camp.moderadores]
    : [];

  // 1) Atualiza o item placeholder
  let alteracoes = 0;
  for (let i = 0; i < moderadores.length; i++) {
    const m = moderadores[i];
    if (m && m.id === MOD_ID_PLACEHOLDER) {
      moderadores[i] = { ...m, id: UID_REAL, nome: NOME, email: EMAIL };
      alteracoes++;
      console.log(
        `✓ moderadores[${i}]: ${MOD_ID_PLACEHOLDER} → ${UID_REAL}, nome="${NOME}"`,
      );
    }
  }
  if (alteracoes === 0) {
    console.warn(
      `Nenhum item com id=${MOD_ID_PLACEHOLDER}. Doc pode já estar atualizado.`,
    );
    console.log('Moderadores atuais:', JSON.stringify(moderadores, null, 2));
  }

  // 2) Recalcula listas planas DO ZERO baseado no array `moderadores`
  //    atualizado. Não preservamos o `moderadorUids` antigo do doc — se
  //    ele tinha um UID que não está mais no array, deve sumir das listas.
  const moderadorUids = [];
  const editarCampeonatoUids = [];
  const gerenciarEquipesUids = [];
  const editarResultadosUids = [];
  const enviarMidiasUids = [];
  const gerenciarEnquetesUids = [];
  for (const m of moderadores) {
    if (!m || !m.id) continue;
    if (m.id.startsWith('mod-') || m.id.startsWith('mod_')) continue;
    moderadorUids.push(m.id);
    const p = m.permissoes || {};
    if (p.editarCampeonato) editarCampeonatoUids.push(m.id);
    if (p.gerenciarEquipes) gerenciarEquipesUids.push(m.id);
    if (p.editarResultados) editarResultadosUids.push(m.id);
    if (p.enviarMidias) enviarMidiasUids.push(m.id);
    if (p.gerenciarEnquetes) gerenciarEnquetesUids.push(m.id);
  }

  console.log('→ Patch campeonato…');
  await patchDoc(token, 'campeonatos', CAMPEONATO_ID, {
    moderadores,
    moderadorUids,
    editarCampeonatoUids,
    gerenciarEquipesUids,
    editarResultadosUids,
    enviarMidiasUids,
    gerenciarEnquetesUids,
  });
  console.log('✓ Campeonato atualizado:');
  console.log(`  moderadorUids: ${moderadorUids.join(', ')}`);
  console.log(`  editarCampeonatoUids: ${editarCampeonatoUids.join(', ') || '(vazio)'}`);
  console.log(`  gerenciarEquipesUids: ${gerenciarEquipesUids.join(', ') || '(vazio)'}`);
  console.log(`  editarResultadosUids: ${editarResultadosUids.join(', ') || '(vazio)'}`);
  console.log(`  enviarMidiasUids: ${enviarMidiasUids.join(', ') || '(vazio)'}`);
  console.log(`  gerenciarEnquetesUids: ${gerenciarEnquetesUids.join(', ') || '(vazio)'}`);

  // 3) Seta moderadorValidado: true no user
  console.log(`→ Patch users/${UID_REAL}…`);
  await patchDoc(
    token,
    'users',
    UID_REAL,
    { moderadorValidado: true },
    true,
  );
  console.log(`✓ users/${UID_REAL}.moderadorValidado = true`);

  // 4) Limpa moderadorValidado dos UIDs criados por engano
  for (const uid of UIDS_PARA_LIMPAR) {
    if (uid === UID_REAL) continue;
    try {
      console.log(`→ Limpando users/${uid}.moderadorValidado…`);
      await patchDoc(token, 'users', uid, { moderadorValidado: false }, true);
      console.log(`✓ users/${uid}.moderadorValidado = false`);
    } catch (e) {
      console.warn(`  (skip ${uid}: ${e.message})`);
    }
  }

  console.log(
    '\n✅ Migração concluída. Faça hard refresh no app do moderador.',
  );
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
