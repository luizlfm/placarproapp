// Prod — mesmo projeto Firebase. As credenciais do Web SDK são públicas no bundle;
// segurança vem das Firebase Security Rules + App Check, não de esconder a chave.

export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyAgfVhr8jCwyMuTqQiVHElrZH4qwbslE5c',
    // IMPORTANTE: usar o mesmo origin do app (placapro-d276d.web.app)
    // pra evitar bloqueio do Safari ITP em OAuth redirect. O __/auth/handler
    // é exposto automaticamente nos dois domínios pelo Firebase Hosting.
    authDomain: 'placapro-d276d.web.app',
    projectId: 'placapro-d276d',
    storageBucket: 'placapro-d276d.firebasestorage.app',
    messagingSenderId: '1009050256280',
    appId: '1:1009050256280:web:9b003cb47aa2e6ded2e1ed',
    measurementId: 'G-MMPK5LMZWD',
  },

  /**
   * Códigos válidos para cadastro de organizadores em produção.
   * IMPORTANTE: troque por valores únicos antes de deploy real.
   */
  organizadorInviteCodes: [
    'placarpro-2026-prod',
  ] as string[],

  /** Códigos válidos para cadastro de moderadores em produção. */
  moderadorInviteCodes: [
    'mod-2026-prod',
  ] as string[],

  /**
   * UIDs hardcoded como Admin Master em produção.
   * Espelha o array do `environment.ts` (dev). Acesso garantido ao painel
   * `/app/admin` independente do campo `users/{uid}.isMaster` no Firestore.
   */
  adminMasterUids: [
    'ntGeuckC1udr4p3yPEnRvkLciIE3', // ti.luizmiranda@gmail.com
  ] as string[],

  /**
   * Public Key do Mercado Pago em PRODUÇÃO (APP_USR-...).
   * Pagamentos reais. Pareada com o Access Token de PROD no secret
   * `MP_ACCESS_TOKEN` (Cloud Functions) — os dois precisam ser de produção.
   */
  mercadoPagoPublicKey: 'APP_USR-294460d8-9d90-4e3b-9d3e-ea78358f318f',

  /**
   * LiveKit Cloud em produção — mesma URL do environment.ts.
   * API_KEY / API_SECRET ficam no Firebase Functions via:
   *   `firebase functions:secrets:set LIVEKIT_API_KEY`
   *   `firebase functions:secrets:set LIVEKIT_API_SECRET`
   */
  livekit: {
    url: 'wss://placarproapp-nazuh7an.livekit.cloud',
  },

  /**
   * Dados de pagamento manual (compra de créditos via Pix — v1).
   * Editar aqui troca em todo o app. Pix por telefone = formato +55DDDNNNN.
   */
  contatoPagamento: {
    pixChave: '+5537999562903',
    pixLabel: '(37) 99956-2903',
    whatsapp: '5537999562903',
    whatsappLabel: '(37) 99956-2903',
  },
};
