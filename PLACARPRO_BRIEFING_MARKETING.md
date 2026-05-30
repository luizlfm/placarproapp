# 🎨 PlacarPro — Briefing de Marketing + Prompts pra Criativos

> Cole esse arquivo no ChatGPT/Claude/Midjourney/DALL-E pra gerar imagens, vídeos, textos e carrosséis pro Instagram.

---

## 📋 RESUMO EXECUTIVO

**PlacarPro** é uma plataforma PWA (web + mobile) pra **organizar campeonatos amadores** de futebol, futsal, society, vôlei e outros esportes coletivos.

**Quem usa:**
- Organizadores de torneios / ligas / copas amadoras
- Clubes que gerenciam categorias de base
- Empresas/condomínios que fazem campeonatos internos
- Grupos de pelada (módulo "Racha")
- Torcedores/atletas que acompanham campeonatos públicos

**Identidade visual:**
- 🎨 Paleta: **PRETO (#000000)** + **VERDE LIME (#7CC61D)** + branco
- ⚽ Logo: escudo de troféu com bola, estrelas e raio verde
- 🅰️ Tipografia: clean sans-serif (Inter), tudo em CAIXA ALTA em listas
- 💫 Tom: profissional, moderno, "ESPN/CBF amador"

---

## ✅ FUNCIONALIDADES (lista completa pra criativos)

### Gestão do Campeonato
- ✅ Criar campeonato com nome, logo, capa, regras, cores
- ✅ Múltiplas categorias (Sub-15, Sub-17, 40+, 50+, etc.)
- ✅ Grupos e fases (mata-mata, grupos, eliminatórias)
- ✅ Tabela de jogos com **geração automática** (todos contra todos / fases)
- ✅ Reordenar rodadas, transferir equipes entre grupos
- ✅ Critérios de desempate customizáveis (saldo, confronto direto, sorteio, etc.)

### Equipes & Jogadores
- ✅ Cadastro com escudo, técnico, cidade
- ✅ Plantel ilimitado de jogadores (nome, foto, RG, CPF, posição, nº camisa, nascimento)
- ✅ **🆕 OCR de documento (RG/CNH/CPF)** — escaneia e preenche automático
- ✅ **🆕 OCR de ficha de inscrição** — importa equipe inteira de uma vez (30 jogadores)
- ✅ Suspensões e cartões acumulados
- ✅ Estatísticas (gols, assistências, cartões, jogos)
- ✅ Comissão técnica (técnico, auxiliar, preparador físico, etc.)
- ✅ Transferência de jogador entre equipes
- ✅ Importação em massa via Excel/CSV
- ✅ Cadastro público de equipe (link de convite p/ representante preencher)

### Jogos & Resultados
- ✅ Tabela completa de partidas (mandante x visitante, data, local, árbitros)
- ✅ Edição de placar ao vivo
- ✅ Eventos detalhados: gols, cartões, substituições, faltas
- ✅ Pontos extras manuais
- ✅ **🆕 Transmissão ao vivo** (LiveKit — câmera do celular vira broadcast)
- ✅ Súmula digital A4 (gera PDF pronto pra imprimir/assinar)
- ✅ Arte do jogo (post pronto pro Instagram com placar)
- ✅ Status: agendado / em andamento / encerrado / W.O. / cancelado

### Classificação & Rankings
- ✅ Classificação em tempo real (P, J, V, E, D, GP, GC, SG, %)
- ✅ Posições do pódio destacadas (🥇🥈🥉)
- ✅ Rankings: artilharia, cartões amarelos, vermelhos, jogos disputados
- ✅ Quadro de medalhas (olímpico — por equipe, por categoria)
- ✅ Votações da torcida (Gol mais bonito, Melhor jogador, etc.)

### Relatórios & Impressão
- ✅ Carteirinhas de jogadores (PDF A4 — frente + verso, com foto)
- ✅ Súmulas (várias por folha)
- ✅ Tabela de jogos imprimível
- ✅ Classificação imprimível
- ✅ Termo de autorização de menor
- ✅ Exportação CSV de jogadores e classificação

### Página Pública (torcida)
- ✅ URL própria pra cada campeonato (`/comeu-campeonato`)
- ✅ Layout responsivo (PWA instalável)
- ✅ Torcida acompanha sem login: classificação, jogos, escalação, fotos, vídeos
- ✅ Botão "Seguir" — recebe notificações
- ✅ Comentários e enquetes
- ✅ Página do organizador com todos os seus campeonatos
- ✅ Apoios e patrocinadores em destaque

### Mídia & Engajamento
- ✅ Galeria de fotos, vídeos, notícias e links externos
- ✅ Upload de mídia pelos torcedores (com moderação)
- ✅ Notícias com capa, título, subtítulo, corpo
- ✅ Integração YouTube
- ✅ Banner de patrocinadores no header de cada página

### Para Equipes (Módulo Racha)
- ✅ Gestão de pelada/racha semanal
- ✅ Lista de presença, sorteio de times balanceados
- ✅ Mercado de jogadores (compra/venda virtual)
- ✅ Ranking mundial entre rachas
- ✅ Conquistas e avaliações
- ✅ Financeiro do racha
- ✅ Integração WhatsApp pra confirmação

---

## 🎯 PERSONAS / PÚBLICO-ALVO

### 1. **Carlos — Organizador de torneio amador (50 anos)**
- Organiza a "Copa do Bairro" há 10 anos
- Antes usava planilha Excel + WhatsApp
- Cansado de calcular classificação na mão
- Quer dar profissionalismo pro torneio dele

### 2. **Mariana — Coordenadora de base (35 anos)**
- Gerencia 5 categorias (Sub-13 ao Sub-20) de um clube
- Precisa de carteirinhas, fichas de inscrição, súmulas oficiais
- Pais cobram resultados em tempo real

### 3. **João — Atleta amador / torcedor (28 anos)**
- Joga em 2 campeonatos diferentes na cidade
- Quer ver no celular: próximo jogo, classificação, artilharia
- Compartilha posts do PlacarPro nas redes

### 4. **Empresa "FutBora" — Liga de empresas (RH)**
- Campeonato interno entre departamentos
- Precisa de transparência total (todos veem mesma info)
- Quer fotos pra usar no comunicado interno

---

## 🎨 PROMPTS PARA GERADORES DE IMAGEM IA

### Cover/Capa Instagram (1080×1080)

**Prompt 1 — Mockup de celular com o app:**
```
A modern smartphone mockup showing a sports tournament management app interface
with black background and lime green (#7CC61D) accents. The screen displays a
soccer match scoreboard with team logos, players list, and live statistics.
Behind the phone: a dramatic stadium photo at night with lights. Top-left corner:
"PlacarPro" logo in white. Style: clean, professional, sports broadcast,
SportsCenter ESPN aesthetic. 1080x1080 square, high quality, photorealistic.
```

**Prompt 2 — Cena de futebol amador com overlay:**
```
A vibrant soccer field at dusk with amateur players in action, motion blur on
the ball. Foreground: a transparent UI overlay showing a Brazilian Portuguese
championship table with team names, points, wins, losses. Color scheme: deep
black with lime green highlights (#7CC61D). Text overlay top: "GERENCIE SEU
CAMPEONATO COM PROFISSIONALISMO". Cinematic lighting, vertical 1080x1350
Instagram post format.
```

**Prompt 3 — Trophy + tech (logo PlacarPro):**
```
A 3D rendered golden soccer trophy with a glowing lime-green star on top,
floating against a pitch-black background with subtle green grid pattern.
Lightning bolts of green energy around it. Style: premium e-sports tournament,
modern, polished. No text. Square 1080x1080.
```

**Prompt 4 — Antes/depois (planilha vs app):**
```
Split-screen image. LEFT: a frustrated person with a messy paper spreadsheet
covered in scribbles, calculating soccer standings manually, warm tungsten
lighting. RIGHT: the same person smiling, holding a smartphone showing a
clean black-themed sports app with green accents, modern cool lighting.
Center divider: a green lightning bolt. Tagline space at top. 1080x1080.
```

### Stories (1080×1920)

**Prompt 5 — Vertical hero:**
```
Vertical mobile story format. Top half: amateur soccer player celebrating goal
with arms raised, stadium lights. Bottom half: dark gradient transitioning to
solid black with PlacarPro app interface visible on a phone screen showing
real-time standings table. Centered text: "DO PLACAR ÀS REDES SOCIAIS"
in bold uppercase white with green accent. Modern sports broadcast style.
1080x1920.
```

### Carrossel (1080×1080 — cards sequenciais)

**Card 1 — Capa:**
> Background preto. Centro: troféu verde luminoso. Texto: "**5 FUNCIONALIDADES**
> que vão revolucionar seu campeonato amador". Logo PlacarPro no topo.

**Card 2 — Cadastro OCR:**
> Mockup de celular escaneando uma CNH. Texto: "**📷 Escaneie o documento**
> e cadastre seus jogadores em segundos." Subtexto: "OCR inteligente preenche
> nome, CPF, RG e foto sozinho."

**Card 3 — Classificação ao vivo:**
> Mockup mobile mostrando tabela com 10 equipes. Texto: "**📊 Classificação
> em tempo real**". Subtexto: "Toda gol entra na conta automaticamente."

**Card 4 — Súmulas digitais:**
> Mockup de uma súmula A4 impressa. Texto: "**📄 Súmulas profissionais**".
> Subtexto: "Geração automática + PDF pronto pra imprimir e assinar."

**Card 5 — Página pública:**
> Tela de celular mostrando a página pública do campeonato. Texto:
> "**🌐 Torcida acompanha tudo**". Subtexto: "Sem login, sem download.
> Link único compartilhável."

**Card 6 — CTA final:**
> Background preto + verde gradient. Texto grande: "**COMECE GRÁTIS HOJE**".
> Subtexto: "placarpro.app" + setinha. Botão verde "TESTAR AGORA".

---

## 📝 ROTEIROS / TEXTOS PRONTOS

### Post simples (foto + caption)

**📸 Caption 1 — Apresentação:**
```
Cansou de gerenciar campeonato na planilha?

PlacarPro é a plataforma que profissionaliza torneios amadores:
⚽ Tabela automática
📊 Classificação em tempo real
📷 OCR pra cadastrar jogadores por foto do RG
📄 Súmulas em PDF
🌐 Página pública pra torcida

Tudo grátis. Tudo no celular.

👉 placarpro.app

#FutebolAmador #CampeonatoAmador #FutSociety #FutsalAmador
```

**📸 Caption 2 — Foco no OCR (novidade):**
```
Cadastrar 30 jogadores em 1 MINUTO 🤯

Nossa nova função de OCR escaneia a ficha de inscrição da equipe e
importa TODOS os jogadores automaticamente:
✅ Nome completo
✅ CPF e RG
✅ Data de nascimento
✅ Foto do documento

Funciona com foto OU PDF da ficha. Adeus, digitação manual.

Teste grátis em placarpro.app

#TecnologiaNoFutebol #CampeonatoAmador #InovacaoEsportiva
```

**📸 Caption 3 — Página pública / torcida:**
```
Sabe aquele primo que sempre pergunta "qual foi o resultado de ontem"?

Manda o LINK do PlacarPro pra ele 📲

A página pública do seu campeonato tem:
⚽ Próximos jogos com data e local
📊 Classificação atualizada em tempo real
🏆 Artilharia e rankings
📸 Fotos e vídeos dos jogos
📺 Transmissão ao vivo (quando rolar)

Sem login. Sem cadastro. Só compartilhar o link.

🔗 placarpro.app
```

### Reels / TikTok (script de 15-30s)

**🎬 Reel 1 — "Antes vs Depois":**
- 0-3s: Pessoa frustrada com papel cheio de rabiscos
- 3-6s: Voz: "Calcular classificação assim?"
- 6-10s: Mostra celular abrindo PlacarPro, classificação aparece pronta
- 10-13s: "Em segundos. Profissional."
- 13-15s: Logo + "placarpro.app"

**🎬 Reel 2 — "OCR Mágico":**
- 0-2s: Mostra uma CNH em close
- 2-5s: Tirando foto com o app
- 5-8s: Tela "Confiança: 100%" + campos preenchidos
- 8-12s: Toca "Importar" → jogador criado
- 12-15s: "OCR. Sem digitar. PlacarPro."

**🎬 Reel 3 — "30 jogadores em 1 minuto":**
- 0-3s: Foto da ficha completa de inscrição
- 3-8s: Timelapse do app processando (cascata de engines OCR)
- 8-12s: Lista com 30 jogadores aparecendo
- 12-15s: "Cadastro de equipe inteira em 1 minuto. PlacarPro."

---

## 🏷️ HASHTAGS RECOMENDADAS

```
#PlacarPro #CampeonatoAmador #FutebolAmador #FutSociety
#FutsalAmador #GestaoDeCampeonato #TabelaFutebol #SumulaDigital
#OrganizadorDeTorneio #Liga #LigaAmadora #CampeonatoInterno
#EmpresaFutebol #CopaDoBairro #PeladaDeDomingo #FutBora
#TecnologiaNoFutebol #InovacaoEsportiva #FootballTech
#GestaoEsportiva #BrasilFutebol
```

---

## 🌈 GUIA DE CORES (HEX)

| Uso | Cor | Hex |
|---|---|---|
| Primary (fundo escuro, headers) | Preto puro | `#000000` |
| Secondary / acento (botões, highlights) | Verde lime | `#7CC61D` |
| Verde escuro (hover, shade) | Verde escuro | `#4a7e0e` |
| Verde claro (tint) | Verde claro | `#95d63f` |
| Sucesso | Verde lime | `#7CC61D` |
| Erro / danger | Vermelho | `#eb4747` |
| Aviso / warning | Amarelo | `#ffc409` |
| Texto principal | Cinza-escuro | `#1F2937` |
| Texto secundário | Cinza médio | `#6B7280` |
| Background claro | Branco | `#FFFFFF` |

---

## 💡 IDEIAS DE POSTS (CALENDÁRIO 30 DIAS)

| Dia | Tema | Formato |
|---|---|---|
| Seg | "Bom dia, gestor" + dica rápida | Foto + caption |
| Ter | Tutorial em vídeo (1 feature) | Reel 30s |
| Qua | Depoimento de cliente | Foto + quote |
| Qui | Antes vs Depois | Carrossel 2 cards |
| Sex | Resultado de campeonato real | Foto + tag do cliente |
| Sáb | Bastidores / dev / atualização | Story |
| Dom | Foto de jogo + tagline inspiracional | Foto |

---

## 🚀 CTA PADRÃO

- **Link bio:** `placarpro.app`
- **Botão principal:** "Comece grátis" ou "Crie seu campeonato"
- **WhatsApp:** +55 37 99956-2903
- **E-mail:** placarproapp@gmail.com

---

*Última atualização: maio 2026*
*Use à vontade — esse arquivo é seu kit pessoal de marketing.*
