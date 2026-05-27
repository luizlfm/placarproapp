/**
 * Cloud Functions do PlacarPro.
 *
 * Funções exportadas:
 *  - criarPagamentoMP   — gera cobrança no Mercado Pago e atualiza Firestore
 *  - webhookMercadoPago — recebe notificação do MP quando o pagamento muda
 *
 * Configuração (rodar uma vez):
 *   firebase functions:secrets:set MP_ACCESS_TOKEN
 *   firebase functions:secrets:set MP_WEBHOOK_SECRET
 *
 * Deploy:
 *   firebase deploy --only functions
 */

import * as admin from 'firebase-admin';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

admin.initializeApp();

// Região default — São Paulo (latência menor pra usuários BR)
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

// Secrets — configurados via `firebase functions:secrets:set NOME`.
// NÃO ficam no código nem no .env — Firebase guarda criptografado.
const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');
const MP_WEBHOOK_SECRET = defineSecret('MP_WEBHOOK_SECRET');

import { criarPagamentoMercadoPago } from './mercadopago';

// Re-export da função de tokens LiveKit (ver `./livekit.ts` pra detalhes).
// Mantida em arquivo separado pra isolar a lógica de tokens de pagamento.
export { gerarTokenLiveKit } from './livekit';

// Re-export do trigger Firestore que abate crédito quando a transmissão
// de um jogo atinge 2h30 acumulado (ver `./transmissoesCreditos.ts`).
export { onTransmissaoHeartbeat } from './transmissoesCreditos';

// ============ EXPORT 1: criarPagamentoMP ============
/**
 * Cloud Function chamada pelo cliente quando o usuário aperta "Pagar com X"
 * na tela /pagamento/{cobrancaId}. Recebe `cobrancaId` + `metodo` (pix,
 * boleto, cartao) e cria a cobrança no Mercado Pago via API.
 *
 * Retorna os dados pra renderizar o pagamento (QR Code PIX, código de
 * barras do boleto, etc) e atualiza o doc `cobrancas/{id}` no Firestore.
 */
export const criarPagamentoMP = onCall(
  {
    secrets: [MP_ACCESS_TOKEN],
    // CORS: libera chamadas do dev (localhost:4200), do Hosting (web.app/firebaseapp.com)
    // e do domínio custom do PlacarPro. Sem isso, o preflight OPTIONS é bloqueado
    // pelo browser antes mesmo da função executar.
    cors: [
      /localhost:\d+$/,
      'https://placapro-d276d.web.app',
      'https://placapro-d276d.firebaseapp.com',
      // Domínio customizado (Firebase Hosting + DNS A records apontando
      // pros IPs do Firebase). Adicionado tanto www quanto raiz porque
      // alguns navegadores tratam como origins diferentes.
      'https://placarproapp.com',
      'https://www.placarproapp.com',
    ],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Login necessário.');
    }

    const {
      cobrancaId, metodo,
      cardToken, installments, cpf, paymentMethodId, issuerId,
    } = request.data as {
      cobrancaId?: string;
      metodo?: 'pix' | 'boleto' | 'cartao_credito' | 'cartao_debito';
      cardToken?: string;
      installments?: number;
      cpf?: string;
      paymentMethodId?: string;
      issuerId?: string;
    };

    if (!cobrancaId || !metodo) {
      throw new HttpsError('invalid-argument', 'cobrancaId e metodo são obrigatórios.');
    }

    // Pra cartão, cardToken + cpf + paymentMethodId são obrigatórios
    if ((metodo === 'cartao_credito' || metodo === 'cartao_debito') &&
        (!cardToken || !cpf || !paymentMethodId)) {
      throw new HttpsError(
        'invalid-argument',
        'cardToken, cpf e paymentMethodId são obrigatórios para pagamento por cartão.',
      );
    }

    // Lê a cobrança do Firestore
    const db = admin.firestore();
    const ref = db.collection('cobrancas').doc(cobrancaId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Cobrança não encontrada.');
    }
    const cobranca = snap.data()!;

    // Só o dono da cobrança pode iniciar o pagamento
    if (cobranca.usuarioId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Você não é o dono desta cobrança.');
    }

    // Se já foi paga, retorna erro
    if (cobranca.status === 'pago') {
      throw new HttpsError('already-exists', 'Esta cobrança já foi paga.');
    }

    try {
      // Chama o Mercado Pago — gera a cobrança
      const resultado = await criarPagamentoMercadoPago({
        accessToken: MP_ACCESS_TOKEN.value(),
        cobrancaId,
        metodo,
        valorCentavos: cobranca.valorCentavos,
        descricao: `Plano ${cobranca.planoId} — ${cobranca.periodicidade}`,
        usuarioEmail: cobranca.usuarioEmail ?? 'sem-email@placarpro.app',
        usuarioNome: cobranca.usuarioNome ?? 'Cliente',
        cardToken,
        installments,
        cpf,
        paymentMethodId,
        issuerId,
      });

      // Mapeia status MP → status local da cobrança
      // Cartão: approved → cobrança paga IMEDIATAMENTE (sem esperar webhook)
      // PIX/Boleto: continua aguardando até o cliente pagar
      const novoStatus = resultado.status === 'approved' ? 'pago' : 'aguardando';

      // Atualiza o doc da cobrança com os dados retornados pelo MP
      const patch: Record<string, unknown> = {
        mpId: resultado.mpId,
        metodoPagamento: metodo,
        status: novoStatus,
        linkPagamento: resultado.linkPagamento ?? null,
        linkBoleto: resultado.linkBoleto ?? null,
        pixCopiaCola: resultado.pixCopiaCola ?? null,
        pixQrCodeBase64: resultado.pixQrCodeBase64 ?? null,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (novoStatus === 'pago') {
        patch.pagoEm = admin.firestore.FieldValue.serverTimestamp();
      }
      await ref.update(patch);

      // Se cartão foi aprovado, ativa plano do usuário automaticamente
      // (mesma lógica do webhook). PIX/Boleto continua dependendo do webhook.
      if (novoStatus === 'pago' && cobranca.usuarioId && cobranca.planoId) {
        await db.collection('users').doc(cobranca.usuarioId).set(
          {
            plano: cobranca.planoId,
            atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        await db.collection('logs').add({
          acao: 'cobranca_paga',
          descricao: `Pagamento por ${metodo} aprovado — usuário promovido ao plano ${cobranca.planoId}`,
          usuarioId: cobranca.usuarioId,
          usuarioLabel: cobranca.usuarioNome ?? cobranca.usuarioEmail,
          meta: { cobrancaId, mpId: resultado.mpId, planoId: cobranca.planoId, metodo },
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      return {
        ok: true,
        mpId: resultado.mpId,
        status: resultado.status,
        statusDetail: resultado.statusDetail,
        linkPagamento: resultado.linkPagamento,
        linkBoleto: resultado.linkBoleto,
        pixCopiaCola: resultado.pixCopiaCola,
        pixQrCodeBase64: resultado.pixQrCodeBase64,
      };
    } catch (err) {
      // Log estrutura completa pra debug — Stringify pega propriedades
      // não-enumerable que `logger.error(err)` perde.
      logger.error('[criarPagamentoMP] erro', err);
      try {
        logger.error('[criarPagamentoMP] err keys', Object.getOwnPropertyNames(err as object));
        logger.error('[criarPagamentoMP] err stringified',
          JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
      } catch { /* ignore */ }

      // Extrai a mensagem real do MP quando disponível.
      // MP SDK pode lançar erro com structure variada — testamos vários caminhos.
      let mensagem = 'Falha ao gerar pagamento.';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (Array.isArray(e?.cause) && e.cause[0]?.description) {
        mensagem = e.cause[0].description;
      } else if (Array.isArray(e?.response?.data?.cause) && e.response.data.cause[0]?.description) {
        mensagem = e.response.data.cause[0].description;
      } else if (e?.error?.message) {
        mensagem = e.error.message;
      } else if (typeof e?.message === 'string' && !e.message.includes('[object')) {
        mensagem = e.message;
      }
      throw new HttpsError('internal', mensagem);
    }
  },
);

// ============ EXPORT 2: webhookMercadoPago ============
/**
 * Webhook chamado pelo Mercado Pago quando o status de um pagamento muda.
 * URL pública: https://southamerica-east1-placapro-d276d.cloudfunctions.net/webhookMercadoPago
 *
 * Configurar no painel MP em "Webhooks" → adicionar essa URL e selecionar
 * o evento "Pagamentos" → topic `payment`.
 */
export const webhookMercadoPago = onRequest(
  { secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET] },
  async (request, response) => {
    // Valida que o método é POST
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed');
      return;
    }

    // Valida o secret (X-Signature header) — se configurado
    // Mercado Pago manda o header `x-signature` com a assinatura HMAC.
    // Por simplicidade, aqui só logamos. Pra produção real, validar
    // crypto-strong igual https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
    const sig = request.headers['x-signature'];
    logger.info('[webhook] payload recebido', { body: request.body, signature: sig });

    const body = request.body as { type?: string; data?: { id?: string } };

    // Só processa eventos de pagamento
    if (body?.type !== 'payment') {
      response.status(200).send('ok (ignorado — type != payment)');
      return;
    }

    const mpPaymentId = body?.data?.id;
    if (!mpPaymentId) {
      response.status(400).send('payment.id missing');
      return;
    }

    try {
      // Busca o pagamento no MP pra confirmar status
      const { buscarPagamentoMP } = await import('./mercadopago');
      const pagamento = await buscarPagamentoMP({
        accessToken: MP_ACCESS_TOKEN.value(),
        mpId: mpPaymentId.toString(),
      });

      // Acha a cobrança correspondente pelo mpId
      const db = admin.firestore();
      const q = await db.collection('cobrancas')
        .where('mpId', '==', mpPaymentId.toString())
        .limit(1)
        .get();

      if (q.empty) {
        logger.warn('[webhook] cobrança não encontrada pra mpId', mpPaymentId);
        response.status(200).send('cobrança não encontrada — ignorando');
        return;
      }

      const cobrancaDoc = q.docs[0];
      const cobranca = cobrancaDoc.data();

      // Mapeia status MP → status local
      const novoStatus = mapearStatusMP(pagamento.status);

      // Atualiza a cobrança
      await cobrancaDoc.ref.update({
        status: novoStatus,
        pagoEm: novoStatus === 'pago' ? admin.firestore.FieldValue.serverTimestamp() : null,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Se foi pago, atualiza o plano do usuário automaticamente
      if (novoStatus === 'pago' && cobranca.usuarioId && cobranca.planoId) {
        await db.collection('users').doc(cobranca.usuarioId).set(
          { plano: cobranca.planoId, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true },
        );
        logger.info('[webhook] plano do usuário atualizado', {
          uid: cobranca.usuarioId, plano: cobranca.planoId,
        });

        // Registra no log de auditoria
        await db.collection('logs').add({
          acao: 'cobranca_paga',
          descricao: `Pagamento confirmado via webhook Mercado Pago — usuário promovido ao plano ${cobranca.planoId}`,
          usuarioId: cobranca.usuarioId,
          usuarioLabel: cobranca.usuarioNome ?? cobranca.usuarioEmail,
          meta: { cobrancaId: cobrancaDoc.id, mpId: mpPaymentId, planoId: cobranca.planoId },
          criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      response.status(200).send('ok');
    } catch (err) {
      logger.error('[webhook] erro processando', err);
      response.status(500).send('erro interno');
    }
  },
);

// ============ EXPORT 3: resolverConviteModerador ============
/**
 * Resolve o link mágico de moderador (`/m/:token`).
 *
 * Primeiro tenta ler `convitesModerador/{token}` (caminho rápido para links
 * criados depois do espelho ter sido implementado). Se não achar, varre
 * todas as categorias via collectionGroup procurando um moderador com esse
 * `linkToken` no array `moderadores` — quando achar, cria o doc espelho
 * retroativamente.
 *
 * Usa privilégios admin (sem rules), então funciona pra qualquer
 * campeonato, mesmo privado.
 *
 * Retorna `{ ok, campeonatoId, categoriaId, moderadorId, nome, email }`
 * ou `{ ok: false, motivo }`.
 */
export const resolverConviteModerador = onCall(
  {
    cors: [/localhost:\d+$/, 'https://placapro-d276d.web.app', 'https://placapro-d276d.firebaseapp.com', 'https://placarproapp.com', 'https://www.placarproapp.com'],
  },
  async (request) => {
    const { token } = request.data as { token?: string };
    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'token é obrigatório.');
    }
    // Sanitiza: só letras/números (remove sufixos colados por engano, ex: "http:")
    const tokenLimpo = token.replace(/[^A-Za-z0-9]/g, '');
    if (!tokenLimpo || tokenLimpo.length < 8) {
      throw new HttpsError('invalid-argument', 'Token inválido.');
    }

    const db = admin.firestore();

    // 1) Caminho rápido — doc espelho
    const espelhoRef = db.collection('convitesModerador').doc(tokenLimpo);
    const espelhoSnap = await espelhoRef.get();
    if (espelhoSnap.exists) {
      const d = espelhoSnap.data()!;
      return {
        ok: true,
        fonte: 'espelho',
        campeonatoId: d.campeonatoId,
        categoriaId: d.categoriaId,
        moderadorId: d.moderadorId,
        nome: d.nome,
        email: d.email,
        aceito: !!d.aceitoEm,
      };
    }

    // 2) Fallback — varre todas categorias procurando o token
    // collectionGroup permite buscar em todas subcoleções 'categorias'
    // de uma vez sem precisar saber quais campeonatos existem.
    logger.info('[resolverConviteModerador] espelho não existe, varrendo categorias', { token: tokenLimpo });
    const todasCats = await db.collectionGroup('categorias').get();
    for (const catDoc of todasCats.docs) {
      const cat = catDoc.data();
      const moderadores = Array.isArray(cat.moderadores) ? cat.moderadores : [];
      for (const m of moderadores) {
        if (typeof m === 'object' && m?.linkToken === tokenLimpo) {
          // Achou! Cria o espelho retroativamente.
          const campRef = catDoc.ref.parent.parent;
          if (!campRef) continue;
          const campSnap = await campRef.get();
          const ownerId = campSnap.data()?.ownerId ?? '';

          const espelho = {
            campeonatoId: campRef.id,
            categoriaId: catDoc.id,
            moderadorId: m.id,
            nome: m.nome ?? null,
            email: m.email ?? null,
            criadoPor: ownerId,
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
          };
          await espelhoRef.set(espelho, { merge: true });
          logger.info('[resolverConviteModerador] espelho retroativo criado', {
            token: tokenLimpo, campeonatoId: campRef.id, categoriaId: catDoc.id,
          });

          return {
            ok: true,
            fonte: 'retroativo',
            campeonatoId: campRef.id,
            categoriaId: catDoc.id,
            moderadorId: m.id,
            nome: m.nome,
            email: m.email,
            aceito: false,
          };
        }
      }
    }

    // 3) Não encontrou
    logger.warn('[resolverConviteModerador] token não encontrado', { token: tokenLimpo });
    return { ok: false, motivo: 'Convite não encontrado.' };
  },
);

// ============ EXPORT 4: aceitarConviteModerador ============
/**
 * Vincula o UID do usuário autenticado ao moderador apontado pelo token.
 *
 * Por que CF (e não write direto do client):
 *  - O client não é dono do campeonato, então as Firestore Rules bloqueiam
 *    qualquer write em `categorias/{catId}.moderadores` ou
 *    `convitesModerador/{token}`. A CF roda com Admin SDK (bypass rules).
 *
 * Fluxo:
 *  1. Valida `request.auth.uid` (logado obrigatório)
 *  2. Resolve o token (espelho ou varre categorias — mesma lógica do
 *     `resolverConviteModerador`)
 *  3. Atualiza o array `moderadores` na categoria (ou no campeonato, se
 *     for moderador a nível de campeonato) trocando o ID antigo
 *     `mod-xxx` pelo UID real do user logado
 *  4. Grava `aceitoEm` + `aceitoPorUid` no doc `convitesModerador/{token}`
 *
 * Retorna `{ ok, campeonatoId, categoriaId }` ou `{ ok: false, motivo }`.
 */
export const aceitarConviteModerador = onCall(
  {
    cors: [/localhost:\d+$/, 'https://placapro-d276d.web.app', 'https://placapro-d276d.firebaseapp.com', 'https://placarproapp.com', 'https://www.placarproapp.com'],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Login é obrigatório pra aceitar convite.');
    }
    const uid = request.auth.uid;
    const email = request.auth.token?.email ?? null;
    const nomeAuth = (request.auth.token?.name as string | undefined) ?? '';

    const { token } = request.data as { token?: string };
    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'token é obrigatório.');
    }
    const tokenLimpo = token.replace(/[^A-Za-z0-9]/g, '');
    if (!tokenLimpo || tokenLimpo.length < 8) {
      throw new HttpsError('invalid-argument', 'Token inválido.');
    }

    const db = admin.firestore();
    const espelhoRef = db.collection('convitesModerador').doc(tokenLimpo);

    // ─────────────────────────────────────────────────────────────────────
    // 1) Resolve o convite (mesma estratégia de `resolverConviteModerador`):
    //    primeiro tenta o doc espelho, depois varre categorias via
    //    collectionGroup como fallback.
    // ─────────────────────────────────────────────────────────────────────
    let campeonatoId = '';
    let categoriaId: string | undefined;
    let moderadorIdAntigo = '';

    const espelhoSnap = await espelhoRef.get();
    if (espelhoSnap.exists) {
      const d = espelhoSnap.data()!;
      campeonatoId = d.campeonatoId;
      categoriaId = d.categoriaId || undefined;
      moderadorIdAntigo = d.moderadorId;
    } else {
      // Fallback — varre categorias procurando o token
      const todasCats = await db.collectionGroup('categorias').get();
      let achado = false;
      for (const catDoc of todasCats.docs) {
        const cat = catDoc.data();
        const moderadores = Array.isArray(cat.moderadores) ? cat.moderadores : [];
        for (const m of moderadores) {
          if (typeof m === 'object' && m?.linkToken === tokenLimpo) {
            const campRef = catDoc.ref.parent.parent;
            if (!campRef) continue;
            campeonatoId = campRef.id;
            categoriaId = catDoc.id;
            moderadorIdAntigo = m.id;
            achado = true;
            break;
          }
        }
        if (achado) break;
      }
      if (!achado) {
        return { ok: false, motivo: 'Convite não encontrado ou expirado.' };
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2) Atualiza o array `moderadores` substituindo o ID antigo pelo UID.
    //    Se for nível de categoria → atualiza categoria; senão → campeonato.
    // ─────────────────────────────────────────────────────────────────────
    const campRef = db.collection('campeonatos').doc(campeonatoId);
    const nomePreferido = nomeAuth || email || 'Moderador';

    if (categoriaId) {
      const catRef = campRef.collection('categorias').doc(categoriaId);
      const catSnap = await catRef.get();
      if (!catSnap.exists) {
        return { ok: false, motivo: 'Categoria não encontrada.' };
      }
      const cat = catSnap.data()!;
      const lista = Array.isArray(cat.moderadores) ? [...cat.moderadores] : [];
      const idx = lista.findIndex(
        (m: unknown) => typeof m === 'object' && m !== null && (m as { id: string }).id === moderadorIdAntigo,
      );
      if (idx >= 0) {
        const atual = lista[idx] as { id: string; nome?: string; email?: string };
        const jaTinhaUid = !atual.id.startsWith('mod-') && !atual.id.startsWith('mod_');
        atual.id = jaTinhaUid ? atual.id : uid;
        if (!atual.nome?.trim()) atual.nome = nomePreferido;
        if (!atual.email && email) atual.email = email;
        lista[idx] = atual;
        await catRef.update({ moderadores: lista });
      } else {
        logger.warn('[aceitarConviteModerador] moderador não está na categoria — talvez removido', {
          campeonatoId, categoriaId, moderadorIdAntigo,
        });
      }
    } else {
      // Moderador a nível de campeonato
      const campSnap = await campRef.get();
      if (!campSnap.exists) {
        return { ok: false, motivo: 'Campeonato não encontrado.' };
      }
      const camp = campSnap.data()!;
      const lista = Array.isArray(camp.moderadores) ? [...camp.moderadores] : [];
      const idx = lista.findIndex(
        (m: unknown) => typeof m === 'object' && m !== null && (m as { id: string }).id === moderadorIdAntigo,
      );
      if (idx >= 0) {
        const atual = lista[idx] as { id: string; nome?: string; email?: string };
        const jaTinhaUid = !atual.id.startsWith('mod-') && !atual.id.startsWith('mod_');
        atual.id = jaTinhaUid ? atual.id : uid;
        if (!atual.nome?.trim()) atual.nome = nomePreferido;
        if (!atual.email && email) atual.email = email;
        lista[idx] = atual;
        await campRef.update({ moderadores: lista });
      } else {
        logger.warn('[aceitarConviteModerador] moderador não está no campeonato', {
          campeonatoId, moderadorIdAntigo,
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3) Denormaliza o UID na lista `moderadorUids` + listas de permissões
    //    granulares (editarCampeonatoUids, gerenciarEquipesUids,
    //    editarResultadosUids, enviarMidiasUids, gerenciarEnquetesUids) do
    //    campeonato. Essas listas planas são usadas pelas Firestore Rules
    //    pra autorização granular SEM precisar iterar arrays de objects
    //    (não suportado em rules).
    //
    //    Releitura do doc atualizado é necessária porque o UID acabou
    //    de ser inserido no array `moderadores` (passo anterior) e
    //    precisamos calcular as listas com o estado pós-aceite.
    // ─────────────────────────────────────────────────────────────────────
    const campSnap = await campRef.get();
    const camp = campSnap.data() ?? {};
    const moderadoresAtual: Array<{ id: string; permissoes?: Record<string, boolean> }> =
      Array.isArray(camp.moderadores) ? camp.moderadores : [];

    const editarCampeonatoUids: string[] = [];
    const gerenciarEquipesUids: string[] = [];
    const editarResultadosUids: string[] = [];
    const enviarMidiasUids: string[] = [];
    const gerenciarEnquetesUids: string[] = [];
    for (const m of moderadoresAtual) {
      if (!m?.id) continue;
      // Placeholder IDs (mod-/mod_) não dão permissão — ainda não tem UID real.
      if (m.id.startsWith('mod-') || m.id.startsWith('mod_')) continue;
      const p = m.permissoes ?? {};
      if (p.editarCampeonato) editarCampeonatoUids.push(m.id);
      if (p.gerenciarEquipes) gerenciarEquipesUids.push(m.id);
      if (p.editarResultados) editarResultadosUids.push(m.id);
      if (p.enviarMidias) enviarMidiasUids.push(m.id);
      if (p.gerenciarEnquetes) gerenciarEnquetesUids.push(m.id);
    }

    await campRef.set(
      {
        moderadorUids: admin.firestore.FieldValue.arrayUnion(uid),
        editarCampeonatoUids,
        gerenciarEquipesUids,
        editarResultadosUids,
        enviarMidiasUids,
        gerenciarEnquetesUids,
      },
      { merge: true },
    );

    // ─────────────────────────────────────────────────────────────────────
    // 4) Marca o user como moderador validado — flag exigido pelas
    //    Firestore Rules (`isModerador` checa esse campo). Sem isso, o
    //    user passa pelo `moderadorUids[]` mas é bloqueado nas rules.
    // ─────────────────────────────────────────────────────────────────────
    const userRef = db.collection('users').doc(uid);
    await userRef.set(
      {
        moderadorValidado: true,
      },
      { merge: true },
    );

    // ─────────────────────────────────────────────────────────────────────
    // 5) Marca o convite como aceito (audit trail).
    // ─────────────────────────────────────────────────────────────────────
    await espelhoRef.set(
      {
        aceitoEm: admin.firestore.FieldValue.serverTimestamp(),
        aceitoPorUid: uid,
      },
      { merge: true },
    );

    logger.info('[aceitarConviteModerador] OK', {
      token: tokenLimpo, uid, campeonatoId, categoriaId, moderadorIdAntigo,
    });

    return {
      ok: true,
      campeonatoId,
      categoriaId,
    };
  },
);

/** Mapeia status do Mercado Pago para o nosso enum local. */
function mapearStatusMP(statusMP: string): 'pago' | 'aguardando' | 'cancelado' | 'atrasado' | 'estornado' {
  switch (statusMP) {
    case 'approved':
      return 'pago';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'aguardando';
    case 'cancelled':
    case 'rejected':
      return 'cancelado';
    case 'refunded':
    case 'charged_back':
      return 'estornado';
    default:
      return 'aguardando';
  }
}
