# Runbook de Segurança — Deploy das melhorias de dados

Mudanças implementadas em 3 fases. **Nada foi publicado** — tudo está no working tree.
Siga a ordem abaixo. Cada passo é reversível até o `firebase deploy`.

> Projeto Firebase: `placapro-d276d`

---

## Fase 1 — Hardening (sem migração, baixo risco)

**O que mudou**
- `functions/src/index.ts`: webhook do Mercado Pago agora valida a assinatura
  HMAC `x-signature` (rejeita 401 se inválida). Continua re-buscando o
  pagamento na API do MP como segunda barreira.
- Tokens de convite passaram a usar CSPRNG (`crypto.getRandomValues`) com mais
  entropia: moderador 12→24 chars, equipe/inscrição 8→22 chars. Tokens antigos
  seguem válidos.

**Pré-requisito**
- O secret `MP_WEBHOOK_SECRET` precisa estar configurado, senão a validação
  fica em *fail-open* (só loga, não bloqueia):
  ```
  firebase functions:secrets:set MP_WEBHOOK_SECRET
  ```
  Use o "Assinatura secreta" do painel do Mercado Pago (Webhooks).

**AÇÃO MANUAL — chave de produção do Mercado Pago**
- `placarpro/src/environments/environment.prod.ts` ainda tem
  `mercadoPagoPublicKey` com valor **TEST-...**. Troque pela chave pública de
  produção (`APP_USR-...`) antes do build de produção.

**Deploy**
```
firebase deploy --only functions
```

---

## Fase 2 — Limites de plano server-side (contadores + rules)

**O que mudou**
- `functions/src/contadores.ts` (novo): triggers que mantêm
  `users/{uid}.totalCampeonatos`, `campeonatos/{id}.totalCategorias`,
  `campeonatos/{id}/categorias/{cid}.totalJogadores`.
- `firestore.rules`: `create` de campeonato/categoria/jogador agora exige que o
  contador esteja abaixo do limite do plano do dono (helpers `limiteX` espelham
  `planos.service.ts`).

**Ordem OBRIGATÓRIA** (senão limites ficam zerados pros dados existentes):
```
# 1) Deploy das functions de contador (começam a contar a partir de agora)
firebase deploy --only functions

# 2) Backfill dos contadores pros dados JÁ existentes — dry-run primeiro
node scripts/backfill-contadores.js --project=placapro-d276d --dry-run
node scripts/backfill-contadores.js --project=placapro-d276d

# 3) Só então publique as rules que dependem dos contadores
firebase deploy --only firestore:rules
```

> Se mudar os números de limite no `planos.service.ts`, **espelhe** nos
> helpers `limiteCampeonatos/limiteCategorias/limiteJogadores` do
> `firestore.rules`.

---

## Fase 3 — PII de jogadores (LGPD) — MAIOR cuidado

**O que mudou**
- Campos sensíveis (`cpf`, `rg`, `dataNascimento`, `telefone`, `documento`)
  passam a viver em `jogadores/{id}/privado/dados` (subcoleção privada),
  **nunca** no doc público.
- `jogadores.service.ts`: escrita separa PII automaticamente; leitura admin via
  `getPrivadoOnce` / `enriquecerComPii` (com fallback retrocompatível).
- Telas ajustadas: jogador-modal (edição), carteirinhas, impressão, inscrição
  pública.
- `firestore.rules`: subdoc `privado/{doc}` legível só por dono/moderador ou
  representante com token válido.

**Compatibilidade**: o código tem *fallback* — jogadores ainda NÃO migrados
continuam funcionando (admin lê PII do doc público se o subdoc faltar). Logo,
dá pra publicar o código e migrar em seguida sem downtime.

**Ordem**
```
# 1) Deploy do frontend (código já tolera dados não migrados)
#    (seu processo normal de build/deploy do app)

# 2) Deploy das rules (subdoc privado + bloqueio público da PII)
firebase deploy --only firestore:rules

# 3) Migração da PII existente — dry-run primeiro!
node scripts/migrar-pii-jogadores.js --project=placapro-d276d --dry-run
node scripts/migrar-pii-jogadores.js --project=placapro-d276d
```

**Verificação pós-migração**
- Abrir um campeonato público numa aba ANÔNIMA e confirmar (via DevTools →
  Network/Firestore) que os docs de jogador **não** contêm mais cpf/rg.
- Telas admin (editar jogador, carteirinhas, impressão) devem exibir os dados
  normalmente (agora vindos do subdoc privado).
- Inscrição pública: representante reabre a ficha e vê documento/nascimento.

---

## Fase 4 — PII do perfil do organizador (email/telefone/whatsapp)

**O que mudou**
- `users/{uid}` deixa de guardar `email`/`telefone` no doc público. A PII de
  contato vai pra subcoleções:
  - `users/{uid}/privado/contato` → sempre (só self/admin lê).
  - `users/{uid}/publico/contato` → só quando o organizador liga o toggle
    **"Exibir contato na página pública"** (`contatoPublico`). Privacy-by-default.
- `users.service.ts`: `saveProfile` separa o contato; novos métodos
  `getContatoPrivadoOnce`/`contatoPrivado$`/`contatoPublico$`.
- Tela de edição (`pages/organizador`): toggle de opt-in + carrega contato do
  subdoc privado.
- Página pública (`pages/publico-organizador`): aba "Contatos" lê do subdoc
  público; sem opt-in mostra só redes sociais + formulário "Fale Conosco".
- `firestore.rules`: `users/{uid}/privado/**` só self/admin; `publico/**`
  leitura pública.

**Compatibilidade**: há fallback — orgs não migrados ainda exibem o contato
que estava no doc raiz. Logo, dá pra deployar o código e migrar depois.

**Ordem**
```
# 1) Deploy do frontend (tolera dados não migrados)
# 2) Deploy das rules
firebase deploy --only firestore:rules

# 3) Migração — dry-run primeiro!
node scripts/migrar-contato-organizador.js --project=placapro-d276d --dry-run

#    Opção A (recomendada p/ LGPD): contato vira PRIVADO; some da página
#    pública até o organizador reativar o toggle.
node scripts/migrar-contato-organizador.js --project=placapro-d276d

#    Opção B: preserva o comportamento atual (contato continua público)
#    pra quem já tinha preenchido — seta contatoPublico=true.
node scripts/migrar-contato-organizador.js --project=placapro-d276d --publicar-existentes
```

> DECISÃO DE NEGÓCIO: a Opção A é mais segura (LGPD), mas "esconde" o contato
> de organizadores que hoje o exibem — eles precisarão religar o toggle. A
> Opção B mantém tudo como está. Escolha conforme sua política.

**Verificação**
- Aba anônima → `/org/:slug` → aba Contatos: sem opt-in, NÃO mostra email/tel.
- DevTools → ler `users/{uid}` direto: não deve conter email/telefone.
- Editar perfil → ligar toggle → salvar → contato reaparece na página pública.

---

## Fase 5 — Rate limiting (anti-abuso) nas Cloud Functions

**O que mudou**
- `functions/src/rateLimit.ts` (novo): limitador por janela fixa baseado em
  Firestore (`rateLimits/{escopo}__{chave}`), com transação atômica. Fail-open
  (erro de infra não derruba a chamada). Chave = uid (logado) ou IP (anônimo).
- Aplicado em:
  - `gerarTokenLiveKit` → 60/min por chamador.
  - `criarPagamentoMP` → 15/min por usuário (anti brute-force de cartão).
  - `resolverConviteModerador` → 20/min (anti varredura de tokens de convite).
- `firestore.rules`: coleção `rateLimits` com `read, write: if false` — só as
  Functions (Admin SDK) tocam; cliente não pode ler/zerar o próprio contador.

**Deploy**
```
firebase deploy --only functions
firebase deploy --only firestore:rules
```
Não requer migração nem ação manual. Os limites são propositalmente folgados
pra não atrapalhar uso real; ajuste os números em cada `assertRateLimit(...)`
se necessário.

> Opcional: criar um TTL policy no Firestore pra coleção `rateLimits` (campo
> `inicioMs` não é Timestamp, então use uma limpeza por cron se quiser; os docs
> são pequenos e poucos, não é urgente).

---

## Pendências conhecidas (não implementadas — decisão consciente)

- **Custom claims para admin master.** Hoje o admin é um UID hardcoded em
  `environment.ts` + `firestore.rules` (`isHardcodedMaster`). Custom claims
  seriam "mais elegantes", mas: (a) a checagem atual já é segura — não dá pra
  forjar um UID; (b) migrar exige setar a claim via Admin SDK, reescrever
  `isMaster()` nas rules e no guard, e lidar com o delay de propagação do token
  (até o refresh/1h). **Alto risco de auth, ganho marginal.** Recomendação:
  manter como está, a menos que o nº de super-admins cresça. Se for migrar,
  fazer em janela controlada com rollback pronto.

---

## Checklist de testes manuais (pós-deploy)

Marque cada item. Faça em **aba anônima** os testes "público" e logado os "admin".

### Fase 1 — Webhook + tokens
- [ ] Pagamento real (PIX) gera cobrança e, ao pagar, o plano ativa (webhook ok).
- [ ] Logs da function `webhookMercadoPago` mostram "assinatura ok" (não 401).
  Se aparecer "MP_WEBHOOK_SECRET ausente", configure o secret.
- [ ] Criar convite de moderador → o link gerado tem ~24 chars.
- [ ] Criar convite de inscrição de equipe → link com ~22 chars.

### Fase 2 — Limites de plano
- [ ] Conta GRÁTIS: criar 1 campeonato OK; tentar o 2º → bloqueado com aviso.
- [ ] Categoria: estourar o limite do plano → bloqueado.
- [ ] Jogador: estourar `maxJogadoresPorCategoria` → bloqueado (UI mostra "faça upgrade").
- [ ] Admin master cria sem limite.
- [ ] (Após backfill) `users/{uid}.totalCampeonatos`, `campeonatos/{id}.totalCategorias`
      e `.../categorias/{cid}.totalJogadores` batem com a contagem real.

### Fase 3 — PII de jogadores
- [ ] Admin cria jogador com CPF/RG → salva OK; doc público `jogadores/{id}`
      NÃO contém cpf/rg (confira no console/DevTools); subdoc `privado/dados` contém.
- [ ] Editar jogador → CPF/RG aparecem preenchidos (vêm do subdoc privado).
- [ ] Carteirinhas e Impressão (admin) → CPF/RG/nascimento aparecem.
- [ ] **Inscrição pública** (link /inscricao/:token): representante CRIA atleta
      com documento + data nascimento → salva SEM erro de permissão. *(este era
      o bug do batch — testar com atenção)*
- [ ] Inscrição pública: reabrir a ficha → documento/nascimento reaparecem.
- [ ] Aba anônima em campeonato público: ler `jogadores/{id}` direto NÃO traz cpf/rg.

### Fase 4 — Contato do organizador
- [ ] Editar perfil com toggle "Exibir contato" DESLIGADO → salvar →
      aba anônima `/org/:slug` Contatos NÃO mostra email/telefone/whatsapp.
- [ ] Ler `users/{uid}` direto (anônimo): sem email, sem telefone, sem `redes.whatsapp`.
- [ ] Ligar o toggle → salvar → contato reaparece na página pública.
- [ ] Formulário "Fale Conosco" só aparece quando há contato público.

### Fase 5 — Rate limiting
- [ ] Uso normal de transmissão/pagamento NÃO é bloqueado.
- [ ] (Opcional) Disparar `gerarTokenLiveKit` >60x/min → recebe erro
      "Muitas requisições" (resource-exhausted).
- [ ] Cliente NÃO consegue ler `rateLimits/*` (permission denied).

---

## Rollback rápido

- Rules: `firebase deploy --only firestore:rules` com a versão anterior (git).
- Functions: `firebase deploy --only functions` com a versão anterior.
- A migração de PII é só-pra-frente; se precisar reverter, os dados estão no
  subdoc `privado/dados` (não foram perdidos) — bastaria um script inverso.
