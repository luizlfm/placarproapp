# Testes das Firestore Security Rules (emulador)

Valida os fluxos sensíveis das 5 fases de segurança contra as rules REAIS
(`placarpro/firestore.rules`), rodando no emulador local do Firestore.

Cobre, em especial, o **fluxo crítico de inscrição pública** — criação de
jogador + subdoc PII no MESMO `writeBatch` — que é o caso onde uma rule mal
escrita (get() do doc pai não-commitado) quebraria a inscrição.

## Pré-requisitos

- **Java**: o `firebase-tools` v13 (fixado aqui) roda com **Java 11**. Em
  Windows com JDK 17+, o emulador do Firestore falha ao subir (o selector
  WEPoll usa Unix-domain-sockets pro self-pipe → "Unable to establish
  loopback connection"). **Use o JDK 11** apontando `JAVA_HOME`.
- Node 18+. As deps já estão fixadas no `package.json` (inclui
  `firebase-tools@13`).

## Como rodar

Linux/macOS (Java 11–17 no PATH):
```bash
cd scripts/rules-test
npm install
npm test
```

Windows (forçando o JDK 11 — testado e validado: 14/14 verdes):
```bash
cd scripts/rules-test
npm install
JAVA_HOME="/c/Program Files/Java/jdk-11" PATH="/c/Program Files/Java/jdk-11/bin:$PATH" npm test
```

O `pretest` copia `placarpro/firestore.rules` pra esta pasta (o emulador v13
exige as rules dentro do diretório do projeto; por isso há também o
`emu-config.json` apontando pra cópia local). `npm test` sobe o emulador e
executa `run-tests.mjs`, que injeta o seed com `withSecurityRulesDisabled`,
aplica os contextos (anon/dono/moderador/representante) e checa cada caso.

## O que é verificado

**Fase 3 — PII de jogadores**
- Público NÃO lê `jogadores/{id}/privado/dados` (cpf/rg protegidos).
- Dono LÊ o subdoc privado.
- Público LÊ o doc público do jogador (nome/foto/stats).
- **Inscrição pública cria jogador + subdoc PII no mesmo batch** (o bug do
  get() — deve PASSAR).
- Representante com token errado é BLOQUEADO no subdoc PII.

**Fase 2 — limites de plano**
- GRÁTIS: criar categoria/jogador acima do limite é BLOQUEADO.
- CONTROLE (sem regressão): dono CRIA jogo e evento normalmente (caem no
  catch-all `{deep=**}`, que tem allowlist por tipo).

**Fase 4 — contato do organizador**
- Público lê `users/{uid}/publico/contato`; NÃO lê `privado/contato`.
- Outro usuário não lê meu contato privado.

**Fase 5 — rateLimits**
- Cliente não lê nem escreve `rateLimits/*`.

Status atual: **14/14 verdes**.

## Bugs reais que este teste pegou (e que o `--dry-run` NÃO pegaria)

1. **`isMaster()` lançava** "Property isMaster is undefined" em docs de user
   sem o campo → corrigido com `.data.get('isMaster', false)`.
2. **Catch-all `{deep=**}` vazava PII e burlava limites**: um glob aninhado
   também casa o doc-pai (categoria) e os jogadores. Como o Firestore concede
   acesso se QUALQUER match permite, o glob público anulava a proteção do
   subdoc PII e o limite de categoria/jogador. Corrigido com **allowlist**
   (`pathGlobPermitido`) no WRITE e exclusão de `privado` no READ.

São falhas de SEMÂNTICA de sobreposição de regras — só pegáveis rodando as
rules de verdade num emulador, não na validação de sintaxe.
