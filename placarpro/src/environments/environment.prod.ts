// Prod — projeto Firebase de PRODUÇÃO: placarproapp-ed05a (banco zerado).
// O projeto antigo placapro-d276d virou ambiente de TESTE (ver environment.ts).
// As credenciais do Web SDK são públicas no bundle; segurança vem das
// Firebase Security Rules, não de esconder a chave.

export const environment = {
  production: true,
  firebase: {
    apiKey: 'AIzaSyAl699rlARG0XuRPeedmC1moOTgRkk0xbA',
    // authDomain TEMPORÁRIO no domínio padrão do projeto (sempre serve o
    // __/auth/handler). Quando placarproapp.com for movido pra ESTE projeto
    // (Hosting → domínio customizado) e o OAuth client reconfigurado, trocar
    // para authDomain: 'placarproapp.com' — aí a tela do Google exibe o domínio
    // bonito e o fluxo fica same-site (melhor pro Safari ITP).
    authDomain: 'placarproapp-ed05a.firebaseapp.com',
    projectId: 'placarproapp-ed05a',
    storageBucket: 'placarproapp-ed05a.firebasestorage.app',
    messagingSenderId: '15254232138',
    appId: '1:15254232138:web:1736cfc6140ccbedb59ab3',
    measurementId: 'G-1NTXEZQQ4M',
  },

  /**
   * Liga/desliga o botão "Entrar/Cadastrar com Apple" nas telas de login/signup.
   * Desligado porque o Sign in with Apple exige um Services ID configurado em
   * uma conta do Apple Developer Program (paga). Quando o domínio
   * `placarproapp.com` estiver verificado no Services ID + Return URL
   * `https://placarproapp.com/__/auth/handler`, basta voltar pra `true`.
   */
  appleLoginEnabled: false,

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
    // UID no projeto de PRODUÇÃO placarproapp-ed05a (Auth zerado tem UID
    // diferente do projeto antigo). ti.luizmiranda@gmail.com.
    'qSZ4Jtf681UjK8OQEnaEcCOwKfc2', // ti.luizmiranda@gmail.com
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
