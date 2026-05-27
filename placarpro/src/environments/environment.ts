// Dev environment — projeto Firebase: placaPro (placapro-d276d)
// Console: https://console.firebase.google.com/project/placapro-d276d

export const environment = {
  production: false,
  firebase: {
    apiKey: 'AIzaSyAgfVhr8jCwyMuTqQiVHElrZH4qwbslE5c',
    // Em prod, o authDomain aponta pro mesmo origin (web.app) pra evitar Safari ITP.
    // Em dev (localhost) qualquer um dos dois funciona. Mantemos web.app pra consistência.
    authDomain: 'placapro-d276d.web.app',
    projectId: 'placapro-d276d',
    storageBucket: 'placapro-d276d.firebasestorage.app',
    messagingSenderId: '1009050256280',
    appId: '1:1009050256280:web:9b003cb47aa2e6ded2e1ed',
    measurementId: 'G-MMPK5LMZWD',
  },

  /**
   * Lista de códigos válidos para cadastro de novos ORGANIZADORES.
   * Reutilizáveis (não são "consumidos") — qualquer pessoa com o código vale.
   * Comparação case-insensitive, espaços nas pontas são removidos.
   *
   * Para adicionar um novo organizador: inclui uma string aqui e faz redeploy.
   * Em produção, mantenha valores únicos e difíceis de adivinhar.
   */
  organizadorInviteCodes: [
    'placarpro-2026',
    // ATENÇÃO: NÃO inclua 'admin-master' aqui. Esse código fazia
    // qualquer organizador virar admin master no signup, e estava
    // vazando privilégios. Hoje admin master é controlado:
    //   1) Hardcoded em `adminMasterUids` abaixo (super-admin permanente)
    //   2) Toggle via painel admin (`usersSrv.toggleUserIsMaster`)
  ] as string[],

  /**
   * Códigos válidos para cadastro de MODERADORES globais. Listas separadas
   * propositalmente — moderador costuma ter código diferente do organizador.
   * Moderadores também podem entrar via link mágico `/m/{linkToken}` sem
   * precisar de código (esse fluxo é por-campeonato, controlado pelo organizador).
   */
  moderadorInviteCodes: [
    'mod-2026',
  ] as string[],

  /**
   * UIDs hardcoded como Admin Master (super-admins).
   * Esses usuários SEMPRE têm acesso ao painel `/app/admin`,
   * independente do que está em `users/{uid}.isMaster` no Firestore.
   *
   * Use para o "root" do sistema (você) — assim não precisa mexer no
   * Firestore Console e nunca corre risco de perder acesso por engano.
   * Para promover outros usuários a admin, edite `isMaster: true` no
   * doc users/{uid} no Firestore.
   */
  adminMasterUids: [
    'ntGeuckC1udr4p3yPEnRvkLciIE3', // ti.luizmiranda@gmail.com
  ] as string[],

  /**
   * Public Key do Mercado Pago — usada pelo SDK frontend pra tokenizar
   * cartões e iniciar checkout transparente. É segura pra ficar exposta
   * no bundle (design do MP — sem o Access Token correspondente, ela
   * sozinha não autoriza cobranças).
   *
   * Pra alternar entre teste e produção, basta trocar essa chave.
   * Em DEV, usa a Public Key de TEST (sandbox).
   */
  mercadoPagoPublicKey: 'TEST-3f3cadcd-23bc-4f48-8ef1-9e6ebf6d722e',

  /**
   * Configuração do LiveKit Cloud — usado pra transmissão ao vivo das partidas.
   *
   * ⚠️ ANTES DE USAR EM PRODUÇÃO:
   *  1. Crie projeto grátis em https://cloud.livekit.io
   *  2. Em Settings → Keys, copie a URL (wss://...) e cole abaixo
   *  3. A API_KEY e API_SECRET vão pra Firebase Functions (NÃO no frontend):
   *     `firebase functions:secrets:set LIVEKIT_API_KEY`
   *     `firebase functions:secrets:set LIVEKIT_API_SECRET`
   *
   * URL pública pode ficar no bundle frontend (não dá pra autenticar sem
   * o secret). O secret SÓ é usado server-side pra assinar tokens JWT.
   */
  livekit: {
    /** wss://<seu-projeto>.livekit.cloud — URL do projeto LiveKit Cloud. */
    url: 'wss://placarproapp-nazuh7an.livekit.cloud',
  },
};

// Para debug do zone.js, descomente em dev:
// import 'zone.js/plugins/zone-error';
