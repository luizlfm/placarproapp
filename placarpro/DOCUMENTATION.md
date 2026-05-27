# PlacarPro — Documentação do Sistema

> Plataforma PWA Ionic 8 + Angular 20 + Firebase para gerenciar **campeonatos** esportivos e **rachas** (peladas informais).
> Inspirada em copafacil.com (campeonatos) + FutBora.com.br (rachas).

---

## 📋 Sumário

1. [Stack & Arquitetura](#stack--arquitetura)
2. [Tipos de Conta](#tipos-de-conta)
3. [Estrutura de Rotas](#estrutura-de-rotas)
4. [Módulos do Sistema](#módulos-do-sistema)
   - [Home Pública](#1-home-pública-)
   - [Login / Cadastro](#2-login--cadastro-loginsignup)
   - [Espectador](#3-espectador-espectador)
   - [App / Organizador](#4-app--organizador-app)
   - [Racha / Peladas](#5-racha--peladas-racha)
   - [Admin Master](#6-admin-master-appadmin)
5. [Estrutura Firestore](#estrutura-firestore)
6. [Services Principais](#services-principais)
7. [Design System](#design-system)
8. [Features Especiais](#features-especiais)

---

## Stack & Arquitetura

| Camada | Tecnologia |
|---|---|
| Framework | **Angular 20** (não-standalone, usa NgModule) |
| UI | **Ionic 8** + Ionicons |
| Mobile | **Capacitor** (Android + iOS) |
| Backend | **Firebase** (@angular/fire 20) |
| Auth | Firebase Auth (email/senha + Google + Apple OAuth) |
| Banco | Firestore com Security Rules customizadas |
| Storage | Firebase Storage (imagens) |
| PDF | jsPDF + html2canvas (carteirinhas, súmulas) |
| Mapas | Leaflet (picker de local) |
| Linguagem | TypeScript (strict mode) |
| Estilo | SCSS com CSS variables (`--placar-*`) |

**Padrões usados em todo o projeto**:
- `runInInjectionContext(injector, ...)` em todas as chamadas Firestore (mantém Zone.js feliz)
- `host: { class: 'ion-page' }` em todas as pages
- Lazy-loaded NgModules (não standalone)
- Reactive Forms (`FormBuilder` + `Validators`)
- `startWith([])` + `catchError(() => of([]))` em streams resilientes

---

## Tipos de Conta

Definidos em `src/app/users/models/user-profile.model.ts` como `TipoConta`:

| Tipo | Acesso | Cadastro | Destino padrão |
|---|---|---|---|
| **`organizador`** | `/app/*` — cria e gerencia campeonatos | Exige código de convite | `/app/meus-campeonatos` |
| **`moderador`** | `/app/*` — auxiliar de organizador | Exige código de convite OU link mágico | `/app` |
| **`cliente`** (espectador) | `/espectador` — segue campeonatos | Livre | `/espectador` |
| **`racha`** | `/racha/*` — organiza peladas | Livre | `/racha` |

**Admin Master**: flag `isMaster: true` em `users/{uid}` ou UID hardcoded em `environment.adminMasterUids` → acesso total via `/app/admin`.

Validação de tipo no login (`UsersService.ensureTipo`): se o usuário tenta logar como tipo X mas a conta é Y, sai e mostra alert "Tipo de conta diferente".

---

## Estrutura de Rotas

Arquivo: `src/app/app-routing.module.ts`

```
/                            → home pública (landing)
/login                       → tela de login (4 cards de tipo)
/cadastro                    → signup (4 cards de tipo)
/recuperar-senha             → reset password

/app (authGuard)             → shell admin (sidebar /app/*)
  /meus-campeonatos
  /cadastro-equipes
  /cadastro-jogadores
  /organizador               → perfil
  /planos                    → assinatura
  /seguindo                  → campeonatos seguidos
  /arbitragem
  /apoios                    → patrocinadores
  /locais                    → locais de jogo
  /formulario                → form inscrições
  /admin (isMaster)          → painel admin master
  /campeonato/:id            → contexto de campeonato
    /inicio /equipes /jogadores /partidas /classificacao
    /sumulas /carteirinhas /relatorios /enquetes /midia
    /config /moderadores
  /categoria/:id             → contexto de categoria

/espectador                  → painel do espectador
/racha (rachaGuard)          → meus rachas (landing)
  /novo                      → form criar rápido
  /:id/ativar                → wizard 3 passos
  /:id (shell)
    /inicio /visao-geral /meu-racha /times /jogadores
    /sortear /presenca /financeiro /ranking /ranking-mundial
    /upgrade /whatsapp /ao-vivo /partidas /parca

/inscricao/:token            → form público pra preencher equipe
/p/:slug                     → página pública do campeonato (alias)
/:slug                       → página pública do campeonato (canônico)
/pagamento/:cobrancaId       → tela de pagamento
```

---

## Módulos do Sistema

### 1. Home Pública (`/`)

Landing pública estilo moderna. Componente: `HomePublicaPage`.

**Sections**:
- Header glass com logo PlacarPro + nav âncoras (Início, Características, Campeonatos, Pelada, Contato) + "Acessar conta"
- **Hero** dark com mockup de celular animado e 3 CTAs:
  - "Encontrar campeonato" (verde gradient)
  - "Entrar no PlacarPro Pelada" (azul→verde — pra área de racha)
  - "Sou organizador" (ghost)
- **Benefícios** (3 cards): Use Gratuitamente · Classificação e Ranking · Aplicação Flexível
- **Features** com checkmarks + 3 cards mockados
- **"Encontre seu campeonato"**: busca + filtro `[Todos]` / `[Que sigo ❤️ N]` (deslogado mostra cadeado) + grid de campeonatos públicos
- **Pelada/Racha**: seção dedicada com mockup mobile + CTAs "Entrar no PlacarPro" + "Criar racha grátis"
- **CTA Final** "É organizador?"
- **Footer**: marca + nav + contato + redes sociais

**Filtro "Que sigo"**: aparece sempre. Deslogado clica → redireciona `/login?returnUrl=/#campeonatos`.

### 2. Login / Cadastro (`/login`, `/cadastro`)

`LoginPage` / `SignupPage`. Compartilham `auth-styles.scss`.

**Card central com**:
- Logo PlacarPro vertical (clicável → volta `/`)
- Tagline dinâmica baseada em `tipoLogin`
- **Grid 2×2 de cards de tipo**:
  - SOU ORGANIZADOR · SOU MODERADOR
  - SOU RACHA · SOU ESPECTADOR
- Form email/senha + toggle show password
- "Esqueci minha senha" (link)
- Botão **Entrar** primary
- Divisor "ou"
- Botão **Continuar com Google** (outline)
- Botão **Continuar com Apple** (preto)
- Footer com link pro outro fluxo

**Validações**:
- Email format + senha min 6 chars
- Confirmação de senha no signup (validator custom `passwordMatchValidator`)
- **Código de convite** obrigatório se tipo = organizador/moderador (lista hardcoded em `environment.organizadorInviteCodes`)
- Match de tipo: ao logar, valida `ensureTipo(uid, tipoEscolhido)` — se conta existe mas é de outro tipo, signOut + alert

**OAuth**:
- Detecta mobile/Safari/iOS e usa `signInWithRedirect` em vez de popup
- `handleRedirectResult()` no boot do app captura retorno
- OAuth via `/login` força `tipo: cliente` (organizador exige `/signup` com código)

### 3. Espectador (`/espectador`)

Página única `EspectadorPage`. Acessível só por `tipo === 'cliente'` (validado em `authGuard`).

**Seções**:
1. **Minhas equipes** (convites vinculados ao UID)
   - Cards com capa do campeonato + logo + nome + nome da equipe
   - Botão "Ver campeonato" → leva pra `/:slug`
2. **Campeonatos disponíveis** (todos os públicos)
   - Search input
   - Filtros chips: `[Todos]` / `[Que sigo ❤️ N]`
   - Grid de cards com botão de coração pra seguir/parar
   - Toast confirmando "Agora você segue X" / "Deixou de seguir Y"

Header navy fixo no topo com logo PlacarPro + Sair.

### 4. App / Organizador (`/app/*`)

Shell admin com sidebar fixa de 280px navy. Componente: `ShellPage`.

**Modos do shell**:
- `global` — user no topo + menu padrão (Meus campeonatos, Cadastro de equipes, etc.)
- `campeonato` — contexto: logo+nome do campeonato no topo, menu específico, botão "Ver página pública"
- `categoria` — contexto da categoria selecionada

**Menu global**:
- 🏆 Meus campeonatos
- 📋 Cadastro de equipes
- 👥 Cadastro de jogadores
- 🏢 Página do organizador
- 💳 Planos de assinatura
- 👍 Campeonatos seguindo
- 👤 Arbitragem
- 📣 Apoios e Patrocinadores
- 📍 Locais de jogo
- 📄 Formulário
- 🛡 Painel Admin (só se `isMaster`)

**Menu campeonato** (`/app/campeonato/:id`):
- Início, Equipes, Jogadores, Partidas, Classificação
- Súmulas, Carteirinhas, Relatórios, Enquetes, Mídia
- Configurações, Moderadores

**Features principais**:

**Campeonatos**:
- CRUD com banner + logo + fases + categorias
- Visibilidade público/privado (com flag `publico`)
- Slug amigável + shortCode (5 chars)
- Auto-migração: usuário logado pela 1ª vez tem campeonatos legacy promovidos pra `publico: true`

**Equipes**:
- CRUD + cores + logo
- **Link público de inscrição** (`/inscricao/:token`) — dono envia, equipe preenche atletas
- Equipe técnica (modal separado)

**Jogadores**:
- CRUD + foto + posição + número
- Vinculação por UID (espectador pode editar pelo link)

**Partidas**:
- Sistema de fases + chaveamento
- Súmula formal com gols, assists, cartões
- Lances ao vivo
- Geração automática de partidas

**Classificação**:
- Tabela calculada automaticamente
- Saldo de gols, pontos, desempate
- Pública em 2 colunas + detalhe de jogo

**Rankings**:
- Artilharia, Assistência, Cartões
- Export PDF/imagem (jsPDF + html2canvas)

**Mídia**:
- Upload de fotos (galeria)
- Notícias (com título + corpo)
- Vídeos (link YouTube embeddable + link genérico)
- FAB menu pra adicionar

**Carteirinhas**:
- Layout "Credencial do Atleta"
- Preview página dedicada (estilo súmula)
- Geração PDF (página única ou em lote)

**Relatórios**:
- Página separada (não modal)
- Print pages estilo súmula

**Enquetes**:
- Modelo + service
- Modal de criação com alternativas
- Resultado em tempo real

**Patrocinadores**:
- Upload de imagens (com banner + logo)
- Faixa horizontal em todas páginas públicas
- Cards compactos (160px+ grid auto-fill)

**Página pública** (`/:slug` ou `/p/:slug`):
- Shell público com sidebar navy
- Visualização de tudo: classificação, jogos, lances, mídia
- Botão "Seguir" reativo
- Botão "Editar minha equipe" no sidebar (se convite vinculado)
- Tabbar inferior no mobile

### 5. Racha / Peladas (`/racha/*`)

Módulo paralelo ao `/app`, com shell próprio. Acessível só por `tipo === 'racha'` (validado em `rachaGuard`).

**Páginas standalone**:
- `/racha` — Meus rachas (lista de cards)
- `/racha/novo` — Form rápido de criação
- `/racha/:id/ativar` — Wizard 3 passos (Times → Jogadores → Pronto)

**Shell `/racha/:id/*`** com sidebar idêntica ao `/app/*`:
- Logo PlacarPro no topo
- Context header com nome do racha + ícone verde
- Menu flat (sem separadores de seção) com 14+ itens
- User info + Sair no rodapé

**14 telas do shell**:
| Rota | Função |
|---|---|
| `/inicio` | Dashboard com hero + ativação 4 passos + grid atalhos + planos |
| `/visao-geral` | Métricas + tabs Solicitações/Usuários/Eventos |
| `/meu-racha` | Form completo (básicas + regras + avaliação com sliders) |
| `/times` | CRUD com escudos coloridos |
| `/jogadores` | CRUD + tabs Elenco/Convidados/Notas |
| `/sortear` | Algoritmo snake-draft (notas/aleatório/posições) + banco + share |
| `/presenca` | Vou/Não Vou + 4 métricas + admin com accordion |
| `/financeiro` | Entradas/Saídas/Saldo + custos fixos + export CSV |
| `/ranking` | Sidebar 9 categorias (artilheiros, goleiro, xerifão...) + tabela |
| `/ranking-mundial` | Comparação global (placeholder) |
| `/upgrade` | 3 planos (Gratuito / Premium R$19,90 / PRO R$24,90) |
| `/whatsapp` | Integração + mensagens prontas + config PIX/grupo |
| `/ao-vivo` | Estatísticas + ranking + partidas |
| `/partidas` | Lista de partidas + criar + editar placar |
| `/parca` | Análise de duplas/rivais (placeholder) |

**Padrão visual** (idêntico ao `/app/*`):
- Toolbar navy sticky no topo de cada página
- Page header com tag cinza + título navy + subtítulo cinza
- Hero strip verde lime com CTA principal navy
- Chips brancos com métricas
- Cards brancos com conteúdo

**Modal customizado** (`JogadorModalComponent`):
- Header navy com Cancelar/Salvar
- Form com nome, apelido, nota (0-10), telefone (com máscara), posição, mensalista, convidado
- Footer com Arquivar/Remover (em modo edição)

### 6. Admin Master (`/app/admin`)

Painel global. Acessível só com `isMaster: true` ou UID hardcoded.

**Tabs**:
- 📊 Dashboard — métricas globais (total usuários, organizadores, clientes, moderadores, rachas)
- 👥 Usuários — lista completa com promover/rebaixar
- 🏆 Campeonatos — todos do sistema
- 💼 Organizadores
- 📋 Inscrições
- 💳 Planos
- 💰 Cobranças
- 📈 Financeiro
- ⚙ Configurações
- 🕐 Logs / Auditoria

---

## Estrutura Firestore

### Coleções raiz

```
users/{uid}                                    # perfil do usuário
  ├── locais/{localId}                         # locais de jogo
  ├── arbitros/{arbitroId}                     # árbitros cadastrados
  ├── patrocinadores/{patrocinadorId}          # patrocinadores
  ├── seguindo/{campeonatoId}                  # campeonatos seguidos
  └── meusConvites/{token}                     # convites de equipe vinculados

campeonatos/{campeonatoId}                     # campeonato
  ├── categorias/{categoriaId}
  │   ├── equipes/{equipeId}
  │   ├── jogadores/{jogadorId}
  │   ├── equipe-tecnica/{membroId}
  │   ├── partidas/{partidaId}
  │   ├── enquetes/{enqueteId}/votos/{uid}
  │   └── ...
  ├── midias/{midiaId}                         # fotos, vídeos, notícias
  ├── inscricoes/{inscricaoId}                 # pedidos pendentes
  └── seguidores/{uid}                         # espelho dos que seguem

rachas/{rachaId}                               # racha (pelada)
  ├── times/{timeId}                           # times pré-cadastrados
  ├── jogadores/{jogadorId}                    # elenco
  ├── partidas/{partidaId}                     # histórico
  ├── sessoes/{sessaoId}                       # eventos do racha (futuro)
  │   └── presencas/{jogadorId}                # confirmações Vou/Não Vou
  ├── lancamentos/{lancamentoId}               # financeiro
  └── ...

convitesEquipe/{token}                         # tokens públicos de inscrição
cobrancas/{cobrancaId}                         # cobranças PIX/cartão
logs/{logId}                                   # auditoria
config/{docId}                                 # configurações globais
```

### Modelos principais

**`UserProfile`** (`users/{uid}`):
- `tipo: organizador|cliente|moderador|racha`
- `isMaster?` · `nome` · `email` · `slug` · `logoUrl` · `bannerAppUrl` · `bannerSiteUrl`
- `corPrimaria` · `chatAtivo` · `plano` · `redes`

**`Campeonato`** (`campeonatos/{id}`):
- `ownerId` · `titulo` · `subtitulo` · `slug` · `shortCode` · `descricao`
- `publico?` · `seguidores` · `capaUrl` · `bannerUrl` · `logoUrl`
- `modalidade` · `tipoFase` · `regulamento` · `localizacao`

**`Racha`** (`rachas/{id}`):
- `ownerId` · `nome` · `qtdTimes` · `jogadoresPorTime` · `capacidadeTotal`
- `diaSemana` · `horarioInicio` · `local` · `tipoCampo` · `estado` · `municipio` · `endereco`
- `codigoConvite` · `conviteToken` · `codigoIndicacao`
- `aluguelCampoRs` · `arbitragemRs` · `custoAppRs` · `mensalistaPadraoRs`
- `avaliacao: { ativa, bolaMurcha, prazoHoras, pesoAvaliacao, pesoEstatisticas }`
- `status: rascunho|ativo|pausado|encerrado` · `ativado` · `visibilidade`
- `plano: gratis|premium|pro`

**Firestore Rules** (`firestore.rules`):
- `users/{uid}` — read/write só self
- `campeonatos/{id}` — list aberto, get público se `publico`, write só owner ou master
- `rachas/{id}` — list aberto, get aberto, write só owner ou master
- `convitesEquipe/{token}` — get aberto (link conhece o token), write só owner do campeonato
- Helpers: `isAuthed()`, `isMaster()`, `isOwner(id)`, `isCreatingAsSelf()`

---

## Services Principais

| Service | Responsabilidade |
|---|---|
| `AuthService` | Login/logout + OAuth + popup vs redirect detection |
| `UsersService` | Profile CRUD + ensureTipo + isMaster$ + seguindo + locais/árbitros/patrocinadores |
| `CampeonatosService` | CRUD campeonatos + listMeus$ + listPublicos$ + listTodosVisiveis$ |
| `CategoriasService` | CRUD categorias por campeonato |
| `EquipesService` | CRUD equipes + equipe técnica |
| `JogadoresService` | CRUD jogadores + vínculo por UID |
| `PartidasService` | CRUD partidas + lances + súmula |
| `EnquetesService` | CRUD enquetes + votos |
| `MidiaService` | CRUD mídia + upload Storage |
| `SeguidoresService` | Toggle seguir + listas reativas |
| `ConvitesEquipeService` | Tokens públicos + vincular UID |
| `RachaService` | CRUD rachas + times + jogadores + lançamentos + partidas (com `cleanUndefined` helper) |
| `CarteirinhasPdfService` | Geração PDF estilo Credencial do Atleta |
| `ExportRankingsService` | Export rankings PDF + imagem |
| `ThemeService` | Light/dark mode (atualmente fixo em light) |
| `LogsService` | Registra logs de auditoria |
| `NavBackService` | Navegação "voltar" com fallback |

**Padrão**:
```ts
@Injectable({ providedIn: 'root' })
export class XxxService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  listMeus$(): Observable<X[]> {
    return this.auth.user$.pipe(
      switchMap(user => {
        if (!user) return of([] as X[]);
        return runInInjectionContext(this.injector, () => {
          const q = query(this.col, where('ownerId', '==', user.uid));
          return collectionData(q, { idField: 'id' }) as Observable<X[]>;
        });
      }),
    );
  }
}
```

---

## Design System

### Paleta PlacarPro (CSS variables globais)

Definidas em `src/theme/variables.scss` e `src/global.scss`:

| Token | Valor | Uso |
|---|---|---|
| `--ion-color-primary` | `#1C2E3D` | Navy — botões primários, header |
| `--ion-color-secondary` | `#7CC61D` | Lime — accent, CTA, active state |
| `--placar-sidebar-bg` | `#1C2E3D` | Sidebar navy |
| `--placar-sidebar-text` | `#fff` | Texto sidebar |
| `--placar-sidebar-active-bg` | `rgba(124,198,29,0.18)` | Item ativo |
| `--placar-sidebar-active-border` | `#7CC61D` | Border esquerda do item ativo |
| `--placar-accent` | `#7CC61D` | Verde de destaque |
| `--placar-bg` | `#F6F7F9` | Fundo geral |
| `--placar-surface` | `#fff` | Card branco |
| `--placar-border` | `#E5E7EB` | Borda sutil |
| `--rp-navy/lime/amarelo/azul...` | conjunto Racha | Variantes do módulo Racha |

### Padrão visual das páginas

Todas as páginas internas (`/app/*` e `/racha/*`) seguem o mesmo template:

```
┌─ TOOLBAR NAVY ──────────────────────────────────┐
│ Nome da Página (sticky)                          │
└──────────────────────────────────────────────────┘

┌─ PAGE HEAD (tag + título + subtítulo) ──────────┐
│ TAG cinza                                        │
│ Título h1 navy                                   │
│ Subtítulo cinza                                  │
└──────────────────────────────────────────────────┘

┌─ HERO STRIP (faixa verde, opcional) ────────────┐
│        [Botão navy CTA principal]                 │
└──────────────────────────────────────────────────┘

┌─ CHIPS DE MÉTRICAS (opcional) ──────────────────┐
│ [chip 1] [chip 2] [chip 3]                       │
└──────────────────────────────────────────────────┘

(conteúdo da página em cards brancos)
```

### Botões padronizados (módulo Racha)

Definidos em `src/app/racha/styles/_racha-shared.scss`:

| Classe | Cor | Uso |
|---|---|---|
| `.r-btn.r-btn-lime` | Lime | Ação primária |
| `.r-btn.r-btn-navy` | Navy | Ação secundária dark |
| `.r-btn.r-btn-ghost` | Translúcido | Ações em hero dark |
| `.r-btn.r-btn-outline` | Outline lime | Ações secundárias |
| `.r-btn.r-btn-danger` | Vermelho claro | Destrutivas |
| `.r-btn.r-btn-big` | Modificador | Aumenta CTAs principais |

**Dimensões**: `padding: 6px 12px` · `font-size: 11.5px` · `border-radius: 6px` · `ion-icon: 14px`

### Componentes reutilizáveis

- `app-patrocinadores-faixa` — grid de patrocinadores compactos
- `app-mapa-picker-modal` — Leaflet picker com geolocalização
- `app-jogador-modal` (Racha) — modal de criar/editar jogador
- Config modais (`config-modals/`): locais, árbitros, lista simples, info modal, etc.

### Directive de máscara

`MascaraInputDirective` (`src/app/racha/directives/mascara-input.directive.ts`):

```html
<input appMascara="telefone" /> <!-- (00) 00000-0000 -->
<input appMascara="dinheiro" /> <!-- 1.234,56 — grava como Number -->
<input appMascara="codigo" />   <!-- 5 chars A-Z+0-9 uppercase -->
<input appMascara="hora" />     <!-- HH:mm -->
```

Reposiciona cursor após formatar. Sincroniza com FormControl via `setValue({ emitEvent: false })`.

---

## Features Especiais

### Auto-validação de tipo no login

Ao logar, `UsersService.ensureTipo()` valida:
- Doc inexistente → cria com `tipo` selecionado
- Doc legacy (sem `tipo`) → migra com tipo selecionado
- Doc com tipo diferente → signOut + alert "Trocar para X"
- OAuth via `/login` força `cliente` (organizador exige `/signup` com código)

### Convite por link público de inscrição

Fluxo:
1. Dono do campeonato gera token na tela `Equipes` (botão "Gerar link")
2. Doc criado em `convitesEquipe/{token}` com `campeonatoId` + `equipeId`
3. URL pública: `/inscricao/:token`
4. Quem abre o link preenche os atletas (form de 20 linhas + comissão técnica)
5. Se logado, vincula UID via `users/{uid}/meusConvites/{token}` (snapshot)
6. Posteriormente o usuário vê "Editar minha equipe" no sidebar do `/p/:slug`

### Login com OAuth resiliente

`AuthService.oauthSignIn()`:
- Detecta mobile/Safari/iOS/in-app browsers → usa `signInWithRedirect`
- Desktop Chromium/Firefox → tenta popup, fallback pra redirect se popup bloqueado
- `handleRedirectResult()` capturado no boot do app
- Normaliza erros internos do firebase-auth ("Pending promise was never set")

### Sorteio de times com snake-draft

`RachaSortearPage.sortear()`:
- Critério `notas`: ordena por nota desc, distribui em snake-draft (zig-zag) — balanceado
- Critério `aleatorio`: Fisher-Yates shuffle
- Critério `posicoes`: goleiros primeiro, linha depois
- Sobras vão pro banco
- Botão "Compartilhar" gera texto formatado pro WhatsApp

### Financeiro com custos fixos automáticos

`RachaFinanceiroPage`:
- 3 cards de métrica (Entradas / Saídas / Saldo)
- Form de custos fixos (Aluguel, Arbitragem, Mensalista) persiste no doc do racha
- Lançamento manual via alert
- Export CSV
- Resumo formatado pra WhatsApp

### Cores neutras em formulários

Princípio: **lime/verde só pra ação ou estado ativo**, não pra texto neutro.
- Labels: `#4b5563` (cinza-700)
- Hints: `#6b7280` (cinza-500)
- Contadores: `#9ca3af` (cinza-400)
- Títulos: `#1C2E3D` (navy)
- Destaques inline: navy

### Sistema de planos (`/racha/:id/upgrade`)

3 planos com toggle ativando no Firestore (`racha.plano`):
- **Gratuito** (`gratis`) — 50 voz/mês, 2 listas/mês, R$1.000 financeiro
- **Premium** (`premium`) — R$ 19,90/mês — tudo ilimitado exceto WhatsApp/Conquistas
- **PRO** (`pro`) — R$ 24,90/mês — tudo ilimitado + WhatsApp + Menu Ao Vivo + Mercado de Notas + Conquistas

### Helper `cleanUndefined()` no RachaService

Firestore SDK rejeita `undefined`. Helper omite chaves undefined antes de gravar:

```ts
private cleanUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
```

Aplicado em todos os 6 pontos de write do Racha.

---

## Comandos úteis

```bash
# Dev server
npm start

# Build dev
npx ng build --configuration=development

# Build prod
npx ng build --configuration=production

# Deploy Firestore Rules
npx firebase deploy --only firestore:rules

# Deploy hosting
npx firebase deploy --only hosting

# Capacitor (Android)
npx cap sync android
npx cap open android
```

---

## Estrutura de pastas (alto nível)

```
src/
├── app/
│   ├── auth/                      # AuthService + guards (authGuard, rachaGuard, etc.)
│   ├── users/                     # UsersService + models
│   ├── campeonatos/               # CampeonatosService + modelos + helpers
│   ├── home/                      # /home antigo (rederrige p/ /app/meus-campeonatos)
│   ├── pages/
│   │   ├── home-publica/          # / (landing)
│   │   ├── login/ signup/         # auth
│   │   ├── espectador/            # /espectador
│   │   ├── meus-campeonatos/      # /app/meus-campeonatos
│   │   ├── campeonato/            # /app/campeonato/:id
│   │   ├── categoria/             # /app/categoria/:id
│   │   ├── publico/               # /:slug
│   │   ├── admin/                 # /app/admin (master)
│   │   ├── planos/ organizador/ ...
│   ├── racha/                     # módulo Racha completo
│   │   ├── models/                # Racha, RachaTime, RachaJogador, etc.
│   │   ├── racha.service.ts
│   │   ├── racha-shell/           # shell sidebar
│   │   ├── pages/
│   │   │   ├── meus-rachas/       # /racha
│   │   │   ├── criar-racha/       # /racha/novo
│   │   │   ├── ativar-racha/      # /racha/:id/ativar (wizard)
│   │   │   └── shell/             # /racha/:id/* (14 telas)
│   │   ├── modals/                # jogador-modal
│   │   ├── directives/            # mascara-input.directive
│   │   └── styles/                # _racha-shared.scss
│   ├── shell/                     # /app/* shell
│   ├── shared/                    # services + components + modals
│   └── app-routing.module.ts
├── assets/
│   ├── images/                    # logo.png, logo1.png, logo2.png, logo3.png
│   └── icon/                      # favicon
├── environments/                  # configs Firebase + códigos convite
├── theme/                         # variables.scss (CSS vars Ionic)
└── global.scss                    # estilos globais + alert custom
firestore.rules                    # Firestore Security Rules
firebase.json + .firebaserc        # config Firebase
```

---

> **Documento gerado automaticamente** — atualizar sempre que adicionar novo módulo ou feature significativa.
