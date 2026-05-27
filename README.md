# PlacarPro

PWA para organizar campeonatos esportivos — inspirado em copafacil.com.

🌐 **Produção:** [placarproapp.com](https://placarproapp.com) · [placapro-d276d.web.app](https://placapro-d276d.web.app)

## Stack

- **Frontend:** Ionic 8 + Angular 20 (standalone: false)
- **Backend:** Firebase (Auth, Firestore, Functions v2, Hosting, Storage)
- **Transmissão ao vivo:** LiveKit Cloud
- **Pagamento:** Mercado Pago (PIX, boleto, cartão)
- **PWA:** Service Worker (`@angular/service-worker`) com auto-update

## Estrutura

```
placarPro/
├── placarpro/              # App principal Ionic + Angular
│   ├── src/
│   │   ├── app/
│   │   │   ├── pages/      # Páginas (admin + público)
│   │   │   ├── shared/     # Componentes/services compartilhados
│   │   │   ├── campeonatos/  # Models + services Firestore
│   │   │   ├── users/      # Auth + perfis + planos
│   │   │   └── shell/      # Sidebar + layout do app
│   │   ├── environments/   # Config Firebase + LiveKit URL
│   │   └── global.scss     # Tema global
│   └── ...
│
├── functions/              # Cloud Functions (Node 22)
│   └── src/
│       ├── index.ts                # Mercado Pago + convites moderador
│       ├── livekit.ts              # Geração de token LiveKit
│       └── transmissoesCreditos.ts # Abate de crédito quando 2h30 de live
│
├── firestore.rules         # Regras de segurança Firestore
├── firestore.indexes.json  # Índices compostos
├── storage.rules           # Regras Storage
└── firebase.json           # Config Firebase Hosting + emulators
```

## Comandos principais

```bash
# Dev local (app principal)
cd placarpro
npm install
npm start              # http://localhost:4200

# Build produção
npm run build:prod

# Deploy Hosting
firebase deploy --only hosting

# Deploy Cloud Functions
cd ../functions
npm install
npm run build
firebase deploy --only functions

# Deploy Firestore Rules + Indexes
firebase deploy --only firestore:rules,firestore:indexes
```

## Variáveis de ambiente

- `placarpro/src/environments/environment.ts` — Firebase config (web). As API keys são públicas por design — segurança está nas Firestore Rules.
- **Cloud Functions secrets** (configurados via `firebase functions:secrets:set`, NÃO ficam no código):
  - `MP_ACCESS_TOKEN` — token do Mercado Pago
  - `MP_WEBHOOK_SECRET` — secret de validação do webhook MP
  - `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` — para gerar tokens LiveKit

## Modelo de negócio (créditos de transmissão)

- 1 crédito = 1 jogo com até **2h30** de transmissão ao vivo
- Se o broadcaster cair e reconectar, o tempo **soma** (não reseta)
- Cobra apenas UMA vez por jogo — depois de ultrapassar 2h30, o tempo extra é grátis (idempotente via flag `descontou`)
- Cloud Function `onTransmissaoHeartbeat` faz a contabilidade transacional

## Domínio customizado

- DNS: A record → `199.36.158.100` + TXT `hosting-site=placapro-d276d`
- Verificação ACME pelo Firebase Console em **Hosting → Domínios personalizados**
- `authDomain` (Firebase Auth) **mantido** em `placapro-d276d.web.app` para não quebrar Google/Apple login no Safari (ITP)

## Licença

Privado — todos os direitos reservados.
