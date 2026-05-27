/**
 * Cloud Function pra geração de tokens LiveKit.
 *
 * Por que precisa de uma Cloud Function:
 *  - Tokens LiveKit são JWTs assinados com `API_SECRET`. Esse secret JAMAIS
 *    pode ir pro bundle frontend (qualquer um pegaria e geraria token de
 *    broadcaster).
 *  - Aqui no servidor, validamos: usuário logado? é owner/moderador do
 *    campeonato? Só aí emitimos token de PUBLISHER (broadcaster).
 *  - Espectadores (público) pegam token de SUBSCRIBER (só assistir, não
 *    pode publicar). Não precisam estar logados.
 *
 * Setup:
 *   firebase functions:secrets:set LIVEKIT_API_KEY
 *   firebase functions:secrets:set LIVEKIT_API_SECRET
 *   (paste os valores que vêm do painel cloud.livekit.io → Settings → Keys)
 *
 * Cliente chama com:
 *   const fn = httpsCallable(functions, 'gerarTokenLiveKit');
 *   const { token, url } = await fn({ jogoId, papel: 'broadcaster' | 'viewer' });
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { AccessToken } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = defineSecret('LIVEKIT_API_KEY');
const LIVEKIT_API_SECRET = defineSecret('LIVEKIT_API_SECRET');

interface GerarTokenInput {
  /** ID do jogo (Firestore) — usado pra montar o nome da sala (room). */
  jogoId?: string;
  /** Papel do participante: 'broadcaster' (publica vídeo) ou 'viewer' (só assiste). */
  papel?: 'broadcaster' | 'viewer';
  /** ID do campeonato — pra checar permissão de broadcaster. */
  campeonatoId?: string;
  /** ID da categoria — pra checar permissão de moderador granular. */
  categoriaId?: string;
}

export const gerarTokenLiveKit = onCall(
  {
    secrets: [LIVEKIT_API_KEY, LIVEKIT_API_SECRET],
    cors: [
      /localhost:\d+$/,
      'https://placapro-d276d.web.app',
      'https://placapro-d276d.firebaseapp.com',
      // Domínio customizado — manter sincronizado com os outros endpoints
      // (index.ts) pra que browsers do user usem qualquer um sem CORS.
      'https://placarproapp.com',
      'https://www.placarproapp.com',
    ],
  },
  async (request) => {
    const {
      jogoId,
      papel,
      campeonatoId,
      categoriaId,
    } = (request.data ?? {}) as GerarTokenInput;

    if (!jogoId || !papel) {
      throw new HttpsError('invalid-argument', 'jogoId e papel são obrigatórios.');
    }
    if (papel !== 'broadcaster' && papel !== 'viewer') {
      throw new HttpsError('invalid-argument', `Papel inválido: ${papel}`);
    }

    // Nome da sala = "jogo-<jogoId>". Determinístico → broadcaster e viewer
    // entram na mesma sala sem precisar coordenar nada via Firestore.
    const roomName = `jogo-${jogoId}`;

    // ============ AUTORIZAÇÃO ============
    let identity = '';
    let nome = '';

    if (papel === 'broadcaster') {
      // Broadcaster PRECISA estar logado E ser owner/moderador.
      if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Login obrigatório pra transmitir.');
      }
      if (!campeonatoId) {
        throw new HttpsError('invalid-argument', 'campeonatoId obrigatório pra broadcaster.');
      }

      const uid = request.auth.uid;
      const podeTransmitir = await checarPermissaoBroadcaster(uid, campeonatoId, categoriaId);
      if (!podeTransmitir) {
        throw new HttpsError('permission-denied',
          'Você não tem permissão pra transmitir este jogo. Só o dono do campeonato ' +
          'ou moderadores podem iniciar transmissão.');
      }

      identity = uid;
      nome = (request.auth.token?.name as string | undefined)
        || request.auth.token?.email
        || 'Transmissão';
    } else {
      // Viewer SEMPRE recebe identity ÚNICA — mesmo se logado.
      //
      // Por que: se o usuário logado for o BROADCASTER e também abrir a
      // página como viewer (cenário comum durante teste/preview), os dois
      // tokens teriam `identity = uid`. LiveKit trata identity igual como
      // MESMO participante e DESCONECTA o primeiro — quebrando o broadcast.
      //
      // Solução: prefixo `viewer-` + sufixo aleatório garante que cada
      // viewer é único, mesmo quando o usuário logado já está publicando
      // como broadcaster no mesmo room. Identidade real do user fica em
      // `nome` (pro painel admin do LiveKit ver quem é).
      const sufixoAleatorio = Math.random().toString(36).slice(2, 8);
      const baseId = request.auth?.uid || 'anon';
      identity = `viewer-${baseId}-${Date.now()}-${sufixoAleatorio}`;
      nome = (request.auth?.token?.name as string | undefined)
        || request.auth?.token?.email
        || 'Espectador';
    }

    // ============ GERAÇÃO DO JWT ============
    const at = new AccessToken(
      LIVEKIT_API_KEY.value(),
      LIVEKIT_API_SECRET.value(),
      {
        identity,
        name: nome,
        // Token válido por 4h — tempo razoável pra uma partida + intervalo.
        // Depois o cliente pede um token novo se quiser continuar.
        ttl: '4h',
      },
    );

    at.addGrant({
      roomJoin: true,
      room: roomName,
      // Broadcaster: pode PUBLICAR (vídeo + áudio).
      // Viewer: SÓ pode subscrever (assistir).
      canPublish: papel === 'broadcaster',
      canPublishData: papel === 'broadcaster',
      canSubscribe: true,
      // Hide do painel do LiveKit pra moderadores — só nomes reais.
      hidden: false,
    });

    const token = await at.toJwt();

    logger.info('[gerarTokenLiveKit] token gerado', {
      jogoId, papel, identity, roomName, uidAuth: request.auth?.uid ?? '(anon)',
    });

    return {
      ok: true,
      token,
      roomName,
      papel,
      identity,
    };
  },
);

/**
 * Verifica se um UID tem permissão pra transmitir num campeonato/categoria.
 *
 * Regras (mesma lógica de outras Cloud Functions / Firestore Rules):
 *  - Dono do campeonato: SEMPRE pode.
 *  - Admin master: SEMPRE pode.
 *  - Moderador do campeonato OU da categoria (campo `moderadorUids[]`):
 *    pode SE tiver permissão `editarResultados` ou `enviarMidias`
 *    (transmitir é equivalente a "enviar mídia em tempo real").
 */
async function checarPermissaoBroadcaster(
  uid: string,
  campeonatoId: string,
  categoriaId?: string,
): Promise<boolean> {
  const db = admin.firestore();

  // 1) Dono do campeonato
  const campSnap = await db.collection('campeonatos').doc(campeonatoId).get();
  if (!campSnap.exists) {
    logger.warn('[checarPermissaoBroadcaster] campeonato não existe', { campeonatoId });
    return false;
  }
  const camp = campSnap.data()!;
  if (camp.ownerId === uid) return true;

  // 2) Admin master (campo isMaster em users/{uid})
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists && userSnap.data()?.isMaster === true) {
    return true;
  }

  // 3) Moderador do campeonato com permissão enviarMidias ou editarResultados
  const moderadores: Array<{ id: string; permissoes?: Record<string, boolean> }> =
    Array.isArray(camp.moderadores) ? camp.moderadores : [];
  const modCamp = moderadores.find(m => m?.id === uid);
  if (modCamp && (modCamp.permissoes?.enviarMidias || modCamp.permissoes?.editarResultados)) {
    return true;
  }

  // 4) Moderador da categoria específica
  if (categoriaId) {
    const catSnap = await db.collection('campeonatos').doc(campeonatoId)
      .collection('categorias').doc(categoriaId).get();
    if (catSnap.exists) {
      const cat = catSnap.data()!;
      const modsCategoria: Array<{ id: string; permissoes?: Record<string, boolean> }> =
        Array.isArray(cat.moderadores) ? cat.moderadores : [];
      const modCat = modsCategoria.find(m => m?.id === uid);
      if (modCat && (modCat.permissoes?.enviarMidias || modCat.permissoes?.editarResultados)) {
        return true;
      }
    }
  }

  return false;
}
