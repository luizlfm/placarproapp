/**
 * Parser de OCR de FICHA DE INSCRIÇÃO de equipe.
 *
 * Formato esperado (típico de torneios amadores brasileiros):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Equipe: COUNTRY CLUBE DE FORMIGA   │ Contato: ...       │
 *   ├──────┬─────────────────────────┬───────────┬────────────┤
 *   │ Nº   │ Nome Completo do Atleta │ Nº Doc    │ Nascimento │
 *   ├──────┼─────────────────────────┼───────────┼────────────┤
 *   │ 01   │ JARBAS LEAL             │ M 6675413 │ 02/11/73   │
 *   │ 02   │ JOSUEL DANIS DA SILVA   │ M 8665726 │ 22/11/74   │
 *   │ ...  │ ...                     │ ...       │ ...        │
 *   │ 30   │ MATHEUS BORGES DE ALMEIDA│ M 20516536│ 13/05/2000 │
 *   ├──────┴─────────────────────────┴───────────┴────────────┤
 *   │ COMISSÃO TÉCNICA                                        │
 *   │ Técnico: HELIO ARCHANJO FILHO          │ M 1777548     │
 *   │ Auxiliar: ALEXANDRE DE MORAIS          │ M 6240676     │
 *   │ Assistente: MATEUS CORREIA LIMA        │ MG 21290297   │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Estratégia:
 *   1. Procura "EQUIPE" no texto → próxima linha/resto-da-linha = nome
 *   2. Tokeniza linhas e identifica as que começam com Nº de ordem
 *      (01 a 30) — provavelmente uma linha de jogador
 *   3. Pra cada linha de jogador, separa nome / documento / data via
 *      regex (documento e data têm formato característico)
 *   4. Pega comissão técnica (3 nomes opcionais — técnico, auxiliar,
 *      assistente). Não bloqueante.
 *
 * Tolerante a ruído OCR — campos opcionais retornam undefined em vez
 * de quebrar o parse inteiro.
 */

export interface JogadorFicha {
  /** Nº de ordem na ficha (1-30+). */
  ordem: number;
  /** Nome completo do atleta. */
  nome: string;
  /** Documento (RG, CPF ou nº carteira). Bruto, formato livre. */
  documento?: string;
  /** Data nascimento ISO `YYYY-MM-DD` se conseguiu parsear,
   *  ou string bruta `DD/MM/AA(AA)` se não. */
  dataNascimento?: string;
}

/** Membro da comissão técnica (nome + documento opcional). */
export interface MembroComissaoFicha {
  nome: string;
  documento?: string;
}

export interface FichaEquipe {
  textoOriginal: string;
  /** Nome da equipe (após o label "Equipe:"). */
  nomeEquipe?: string;
  /** Contato (telefone/email após "Contato:"). */
  contato?: string;
  /** Lista de jogadores extraídos da tabela. */
  jogadores: JogadorFicha[];
  /** Técnico (nome + doc opcional). */
  tecnico?: MembroComissaoFicha;
  /** Auxiliar técnico (nome + doc opcional). */
  auxiliarTecnico?: MembroComissaoFicha;
  /** Assistente (nome + doc opcional). */
  assistente?: MembroComissaoFicha;
  /** Nome do representante da equipe (rodapé). */
  representante?: string;
  /** Confiança 0-1 = fração { nomeEquipe + ≥1 jogador }. */
  confianca: number;
}

const RE_ORDEM_INICIO = /^\s*(\d{1,2})\b[\s.\-)|]+/;   // "01 ", "1.", "2)", "3-"
const RE_DATA = /(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/;
// Documento aceita: dígitos com possível UF/letra na frente, separadores
// vários. Aceita formatos: "M 6675413", "MG 18131400", "12.345.678-9",
// "123.456.789-09", "12325995", "23388.2777", "1352 9440", "M2590789".
const RE_DOCUMENTO = /([A-Z]{0,3}\s?[\d.\s-]{5,18}(?:-?\d)?)/;

export function parseFichaEquipe(textoBruto: string): FichaEquipe {
  const texto = normalizar(textoBruto);
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);

  const resultado: FichaEquipe = {
    textoOriginal: textoBruto,
    jogadores: [],
    confianca: 0,
  };

  resultado.nomeEquipe = extrairNomeEquipe(linhas);
  resultado.contato = extrairContato(linhas);

  // Tenta MODO MARKDOWN TABLE primeiro (OCR.space Engine 5 retorna assim):
  //   | 01 | Patrick Leandro Andrade | 6012325.995 | 03/10/1985 | ...
  // Estrutura clara com `|` como separador — mais confiável.
  resultado.jogadores = extrairJogadoresMarkdownTable(linhas);

  // Se markdown não pegou, tenta MODO LINHA (ficha digitada plain text):
  //   "01 NOME M123 02/11/73"
  if (resultado.jogadores.length < 2) {
    const porLinha = extrairJogadores(linhas);
    if (porLinha.length > resultado.jogadores.length) {
      resultado.jogadores = porLinha;
    }
  }

  // Se ainda não pegou, tenta MODO COLUNA (OCR fragmenta verticalmente —
  // típico de manuscrito com Engine 2)
  if (resultado.jogadores.length < 2) {
    const porColuna = extrairJogadoresModoColuna(linhas);
    if (porColuna.length > resultado.jogadores.length) {
      resultado.jogadores = porColuna;
    }
  }

  // Comissão técnica
  const cm = extrairComissaoTecnica(linhas);
  resultado.tecnico = cm.tecnico;
  resultado.auxiliarTecnico = cm.auxiliar;
  resultado.assistente = cm.assistente;
  resultado.representante = extrairRepresentante(linhas);

  // Confiança = ponderada: nomeEquipe presente (40%) + cada jogador conta
  let score = 0;
  if (resultado.nomeEquipe) score += 0.4;
  score += Math.min(0.6, resultado.jogadores.length * 0.05);
  resultado.confianca = Math.min(1, score);

  return resultado;
}

// ──────────────────────────────────────────────────────────────────
// Extratores
// ──────────────────────────────────────────────────────────────────

function extrairNomeEquipe(linhas: string[]): string | undefined {
  // 1) Tenta label "Equipe: NOME" (plain text ou markdown)
  for (const linha of linhas) {
    const m = /\bEQUIPE\b[\s:]*([^|\n]+?)(?:\s+CONTATO|$)/i.exec(linha);
    if (m && m[1].trim().length >= 3 && !/^_+$|^-+$|^contato$/i.test(m[1].trim())) {
      const v = m[1].trim().replace(/[|]+$/, '').trim();
      if (v.length >= 3) return v;
    }
  }

  // 2) Tenta markdown H2 (`## NOME EQUIPE`) — OCR.space Engine 5
  //    frequentemente identifica o nome da equipe como header H2
  //    quando o cabeçalho do torneio está como H1.
  for (const linha of linhas) {
    const m = /^##\s+(.+?)\s*$/.exec(linha);
    if (!m) continue;
    const candidato = m[1].trim();
    if (candidato.length < 3 || candidato.length > 80) continue;
    // Descarta headers de torneio óbvios
    if (/FUTEBOL|SOCIETY|CAMPEONATO|TORNEIO|COMISS[AÃ]O|FICHA/i.test(candidato)) continue;
    return candidato;
  }

  return undefined;
}

function extrairContato(linhas: string[]): string | undefined {
  for (const linha of linhas) {
    const m = /\bCONTATO\b[\s:]*(.+?)$/i.exec(linha);
    if (m && m[1].trim().length >= 3) {
      return m[1].trim();
    }
  }
  return undefined;
}

/**
 * Extrai linhas de jogador da tabela. Cada linha começa com o Nº de
 * ordem (01-30+). Depois do Nº vem o nome, depois o documento, depois
 * a data de nascimento. Coluna "Assinatura" é IGNORADA (não importa).
 */
function extrairJogadores(linhas: string[]): JogadorFicha[] {
  const jogadores: JogadorFicha[] = [];
  for (const linha of linhas) {
    const m = RE_ORDEM_INICIO.exec(linha);
    if (!m) continue;
    const ordem = parseInt(m[1], 10);
    if (ordem < 1 || ordem > 50) continue; // ficha típica vai até 20-30

    const restante = linha.slice(m[0].length).trim();
    if (!restante) continue;

    // Estratégia: localizar a DATA (formato característico) e o
    // DOCUMENTO. O que sobra antes do documento é o nome.
    const dataMatch = RE_DATA.exec(restante);
    let nome = restante;
    let documento: string | undefined;
    let dataNascimento: string | undefined;

    if (dataMatch) {
      dataNascimento = formatarData(dataMatch[1], dataMatch[2], dataMatch[3]);
      // Tudo antes da data é nome + documento
      const antesData = restante.slice(0, dataMatch.index).trim();
      // Tenta separar nome do documento — documento tem padrão de
      // dígitos/letras-UF; nome é só letras e espaços.
      const docMatch = acharDocumentoNaParteFinal(antesData);
      if (docMatch) {
        documento = docMatch.documento;
        nome = docMatch.nome;
      } else {
        nome = antesData;
      }
    } else {
      // Sem data — tenta documento e o que sobrar é nome
      const docMatch = acharDocumentoNaParteFinal(restante);
      if (docMatch) {
        documento = docMatch.documento;
        nome = docMatch.nome;
      }
    }

    nome = limparNome(nome);
    if (!nome || nome.length < 3) continue;
    jogadores.push({ ordem, nome, documento, dataNascimento });
  }
  return jogadores;
}

/**
 * Dado um texto "PAULO CEZAR CLARISMAR M 7791562", tenta separar
 * em { nome: "PAULO CEZAR CLARISMAR", documento: "M 7791562" }.
 *
 * Heurística: procura o ÚLTIMO grupo que parece ser um documento
 * (5+ caracteres alfanuméricos com letras/dígitos) no final da string.
 */
function acharDocumentoNaParteFinal(s: string): { nome: string; documento: string } | null {
  // Tenta padrão claro: 1-3 letras UF + espaço + dígitos
  const reUf = /\s+([A-Z]{1,3})\s+(\d[\d.\s-]{4,})\s*$/;
  const mUf = reUf.exec(s);
  if (mUf) {
    return {
      nome: s.slice(0, mUf.index).trim(),
      documento: `${mUf[1]} ${mUf[2].replace(/\s+/g, '')}`.trim(),
    };
  }

  // Padrão letras coladas: "M6675413", "MG18131400"
  const reUfColado = /\s+([A-Z]{1,3}\d{5,})\s*$/;
  const mUfColado = reUfColado.exec(s);
  if (mUfColado) {
    return {
      nome: s.slice(0, mUfColado.index).trim(),
      documento: mUfColado[1],
    };
  }

  // Padrão só dígitos com possíveis separadores no fim
  const reDig = /\s+([\d][\d.\s-]{4,}[\d])\s*$/;
  const mDig = reDig.exec(s);
  if (mDig) {
    return {
      nome: s.slice(0, mDig.index).trim(),
      documento: mDig[1].replace(/\s+/g, ' ').trim(),
    };
  }

  return null;
}

/**
 * MODO MARKDOWN TABLE: OCR.space Engine 5 (e às vezes Engine 3) retorna
 * a tabela em formato markdown:
 *   | Nº Ordem | Nome Completo | Documento | Data Nascimento | Assinatura |
 *   |---|---|---|---|---|
 *   | 01 | Patrick Leandro Andrade | 6012325.995 | 03/10/1985 | Patrick |
 *   | 02 | Anderson Silva | 12.392.039 | 01/10/1978 | Anderson |
 *
 * Esse é o formato MAIS CONFIÁVEL pq tem separadores explícitos `|`.
 * Algoritmo:
 *   1. Identifica linhas que começam com `|`
 *   2. Pula linhas separadoras (`|---|---|`)
 *   3. Pula linha de header (1ª linha não-separadora)
 *   4. Pra cada linha de dado, split por `|`, trim células
 *   5. Cell[1] = ordem, cell[2] = nome, cell[3] = doc, cell[4] = data
 *      (cell[0] é vazia por causa do `|` inicial; assinatura é ignorada)
 */
function extrairJogadoresMarkdownTable(linhas: string[]): JogadorFicha[] {
  const linhasTabela = linhas.filter(l => l.startsWith('|'));
  if (linhasTabela.length < 3) return []; // sem tabela markdown clara

  const jogadores: JogadorFicha[] = [];
  let pulouHeader = false;

  for (const linha of linhasTabela) {
    // Pula linhas separadoras: |---|---|---|
    if (/^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(linha)) continue;

    // Split por `|` e descarta as bordas vazias (antes do 1º `|` e
    // depois do último). Mantém células intermediárias mesmo vazias
    // pra preservar posição.
    const cellsRaw = linha.split('|').map(c => c.trim());
    // Tira só o 1º e último se vazios (são os "lados" do `|...|...|`)
    if (cellsRaw[0] === '') cellsRaw.shift();
    if (cellsRaw[cellsRaw.length - 1] === '') cellsRaw.pop();
    const cells = cellsRaw;
    if (cells.length < 2) continue;

    // Pula header (1ª linha de tabela não-separadora — sem ordem numérica)
    if (!pulouHeader) {
      pulouHeader = true;
      const primeiroCell = cells[0];
      if (!/^\d{1,2}$/.test(primeiroCell)) continue; // era mesmo header
      // Se já vier numérico, é dado — não pula
    }

    // cells[0] = ordem | cells[1] = nome | cells[2] = doc | cells[3] = data
    const mOrdem = /^(\d{1,2})$/.exec(cells[0] ?? '');
    if (!mOrdem) continue;
    const ordem = parseInt(mOrdem[1], 10);
    if (ordem < 1 || ordem > 50) continue;

    const nome = limparNome(cells[1] ?? '');
    if (!nome || nome.length < 3) continue;

    const documento = (cells[2] ?? '').trim() || undefined;

    let dataNascimento: string | undefined;
    const cellData = (cells[3] ?? '').trim();
    if (cellData) {
      const m = RE_DATA.exec(cellData);
      if (m) dataNascimento = formatarData(m[1], m[2], m[3]);
    }

    jogadores.push({ ordem, nome, documento, dataNascimento });
  }

  return jogadores;
}

/**
 * MODO COLUNA: usado quando o OCR fragmenta o output em colunas verticais
 * (cada célula da tabela vira uma linha solta). É o que acontece com
 * fichas MANUSCRITAS escaneadas — o OCR lê coluna por coluna em vez de
 * linha por linha.
 *
 * Estratégia:
 *   1. Acha sequência de Nº de ordem (01, 02, 03, ...) — define quantos
 *      jogadores existem (N)
 *   2. Após o último Nº de ordem, espera N nomes seguidos (linhas com
 *      maioria de letras)
 *   3. Depois N documentos (linhas com mistura de letras/dígitos)
 *   4. Depois N datas (linhas com padrão DD/MM/YY)
 *   5. Casa por índice
 *
 * Tolerante: se faltar alguma coluna, monta com o que tem.
 */
function extrairJogadoresModoColuna(linhas: string[]): JogadorFicha[] {
  // Encontra sequência de Nº de ordem (linhas que SÃO só "01", "02", ...)
  const ordensIdx: { idx: number; valor: number }[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = /^(\d{1,2})$/.exec(linhas[i]);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 50) ordensIdx.push({ idx: i, valor: n });
    }
  }
  if (ordensIdx.length < 3) return []; // sem coluna de ordem detectável

  // Pega só a maior sequência contígua de ordens crescentes (01, 02, 03, ...)
  const ordens = filtrarSequenciaContigua(ordensIdx);
  if (ordens.length < 3) return [];

  const ultimoOrdemIdx = ordens[ordens.length - 1].idx;
  const apos = linhas.slice(ultimoOrdemIdx + 1);

  // Classifica cada linha após o último Nº de ordem
  const nomes: string[] = [];
  const documentos: string[] = [];
  const datas: string[] = [];
  for (const linha of apos) {
    if (/^[A-ZÀ-Ý\s]{5,}$/i.test(linha) && !/\d/.test(linha)) {
      // Letras puras, 5+ chars → nome
      nomes.push(linha);
    } else if (RE_DATA.test(linha) && linha.length <= 12) {
      // Data isolada
      const m = RE_DATA.exec(linha)!;
      const iso = formatarData(m[1], m[2], m[3]);
      if (iso) datas.push(iso);
    } else if (/^[A-Z\d.\s-]{4,18}$/.test(linha) && /\d/.test(linha)) {
      // Mistura letras/dígitos com 4-18 chars → documento
      documentos.push(linha);
    }
  }

  // Casa por índice — pega o mínimo entre ordens e nomes pra não criar
  // jogadores fantasma. Documento e data são opcionais.
  const n = Math.min(ordens.length, nomes.length);
  const jogadores: JogadorFicha[] = [];
  for (let i = 0; i < n; i++) {
    const nome = limparNome(nomes[i]);
    if (!nome || nome.length < 3) continue;
    jogadores.push({
      ordem: ordens[i].valor,
      nome,
      documento: documentos[i],
      dataNascimento: datas[i],
    });
  }
  return jogadores;
}

/** Filtra pra ficar só a maior sequência contígua/quase-contígua. */
function filtrarSequenciaContigua(
  ordens: { idx: number; valor: number }[],
): { idx: number; valor: number }[] {
  if (ordens.length < 2) return ordens;
  // Agrupa por sequências onde cada valor é = anterior + 1
  const grupos: { idx: number; valor: number }[][] = [[ordens[0]]];
  for (let i = 1; i < ordens.length; i++) {
    const ultGrupo = grupos[grupos.length - 1];
    const ult = ultGrupo[ultGrupo.length - 1];
    if (ordens[i].valor === ult.valor + 1) {
      ultGrupo.push(ordens[i]);
    } else {
      grupos.push([ordens[i]]);
    }
  }
  // Retorna o maior grupo
  return grupos.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Extrai comissão técnica da ficha. Formato típico:
 *
 *   ### COMISSÃO TÉCNICA
 *   | FUNÇÃO     | NOME                  | DOCUMENTO   |
 *   |:-----------|:----------------------|:------------|
 *   | Técnico:   | HELIO ARCHANJO FILHO  | M 1777548   |
 *   | Auxiliar:  | ALEXANDRE DE MORAIS   | M 6240676   |
 *   | Assistente:| MATEUS CORREIA LIMA   | MG 21290297 |
 *
 * Estratégia (robusta a typos de OCR no label):
 *   1. Detecta a seção "COMISSÃO TÉCNICA" (ou variação) no texto
 *   2. A partir daí, pega as próximas 3 linhas de DADOS da tabela
 *      markdown (pulando header e separador)
 *   3. Usa POSIÇÃO em vez de regex no label — funciona mesmo quando
 *      OCR escreveu "Téonico" em vez de "Técnico", "Accistente" em
 *      vez de "Assistente", etc.
 *
 * Fallback: também tenta o método antigo baseado em regex de label
 * pra fichas em plain text (sem markdown).
 */
function extrairComissaoTecnica(linhas: string[]): {
  tecnico?: MembroComissaoFicha;
  auxiliar?: MembroComissaoFicha;
  assistente?: MembroComissaoFicha;
} {
  const r: {
    tecnico?: MembroComissaoFicha;
    auxiliar?: MembroComissaoFicha;
    assistente?: MembroComissaoFicha;
  } = {};

  // ─── ESTRATÉGIA 1: detectar seção + posição na tabela ───
  // Acha header "COMISSÃO TÉCNICA" (tolerante a OCR ruim)
  let idxHeader = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (/COMISS[ÃA]O\s+T[ÉE]CNICA/i.test(linhas[i])) {
      idxHeader = i;
      break;
    }
  }

  if (idxHeader >= 0) {
    // A partir do header, pega as próximas linhas de markdown table
    // (começando com `|`), pula header de coluna + separador, e
    // pega as 3 primeiras linhas de dado: tecnico, auxiliar, assistente.
    const dataLinhas: string[] = [];
    let pulouHeaderColunas = false;
    for (let i = idxHeader + 1; i < Math.min(idxHeader + 10, linhas.length); i++) {
      const linha = linhas[i];
      if (!linha.startsWith('|')) continue;
      // Pula linhas separadoras (|:--|:--|)
      if (/^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(linha)) continue;
      // Primeira linha não-separadora = header de coluna (FUNÇÃO NOME DOC)
      if (!pulouHeaderColunas) {
        pulouHeaderColunas = true;
        const upper = linha.toUpperCase();
        // Se a linha já tem nome de função, NÃO é header — é dado
        if (!/FUN[ÇC][ÃA]O|NOME|DOCUMENTO/.test(upper)) {
          dataLinhas.push(linha);
        }
        continue;
      }
      dataLinhas.push(linha);
      if (dataLinhas.length === 3) break;
    }

    // Extrai cada linha: cells[0]=label (ignora), cells[1]=nome, cells[2]=doc
    const posicoes: Array<keyof typeof r> = ['tecnico', 'auxiliar', 'assistente'];
    dataLinhas.forEach((linha, idx) => {
      if (idx >= posicoes.length) return;
      const cells = linha.split('|').map(c => c.trim());
      // Remove vazios do começo e fim
      if (cells[0] === '') cells.shift();
      if (cells[cells.length - 1] === '') cells.pop();
      // cells[0] = label (Técnico:/Auxiliar:/Assistente: — ignorado)
      // cells[1] = nome | cells[2] = documento
      const membro = montarMembro(cells[1], cells[2]);
      if (membro) r[posicoes[idx]] = membro;
    });
  }

  // ─── ESTRATÉGIA 2: fallback plain text (label + valor mesma linha) ───
  // Roda só pra preencher o que ficou faltando da estratégia 1.
  for (const linha of linhas) {
    const upper = linha.toUpperCase();
    if (!r.tecnico && /\bT[ÉE]CNICO\b/.test(upper) && !/\bAUXILIAR\b/.test(upper)) {
      r.tecnico = extrairMembroDepoisDeRotulo(linha, /T[ÉE]CNICO/i);
    } else if (!r.auxiliar && /\bAUXILIAR\b/.test(upper)) {
      r.auxiliar = extrairMembroDepoisDeRotulo(linha, /AUXILIAR(?:\s+T[ÉE]CNICO)?/i);
    } else if (!r.assistente && /\bASSISTENTE\b/.test(upper)) {
      r.assistente = extrairMembroDepoisDeRotulo(linha, /ASSISTENTE/i);
    }
  }

  return r;
}

/** Monta um MembroComissao a partir de células {nome, doc}, validando o nome. */
function montarMembro(nomeCell?: string, docCell?: string): MembroComissaoFicha | undefined {
  const nome = limparNome(nomeCell ?? '');
  if (!nome || nome.length < 3) return undefined;
  const documento = (docCell ?? '').trim() || undefined;
  return { nome, documento };
}

/** Tira o documento do fim e devolve {nome, documento}. */
function extrairMembroDepoisDeRotulo(linha: string, regexRotulo: RegExp): MembroComissaoFicha | undefined {
  const m = regexRotulo.exec(linha);
  if (!m) return undefined;
  const resto = linha.slice(m.index + m[0].length).replace(/^[\s:.\-/—–]+/, '').trim();
  if (!resto) return undefined;

  // Tenta separar documento (no final) do nome
  const semDoc = acharDocumentoNaParteFinal(resto);
  const nome = limparNome(semDoc ? semDoc.nome : resto);
  if (!nome || nome.length < 3) return undefined;
  return {
    nome,
    documento: semDoc?.documento,
  };
}

function extrairRepresentante(linhas: string[]): string | undefined {
  // Procura "Nome do representante" e pega linha próxima com nome
  for (let i = 0; i < linhas.length; i++) {
    if (/NOME\s+DO\s+REPRESENTANTE/i.test(linhas[i])) {
      // O nome pode estar acima OU abaixo do label dependendo do scan
      for (const j of [i - 1, i + 1, i - 2, i + 2]) {
        if (j < 0 || j >= linhas.length) continue;
        const candidato = limparNome(linhas[j]);
        if (candidato && candidato.length >= 5 && /^[A-ZÀ-Ý\s]+$/.test(candidato)) {
          return candidato;
        }
      }
    }
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function limparNome(s: string): string {
  return s
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\s'\-]/gu, '')
    .trim();
}

function formatarData(dia: string, mes: string, ano: string): string | undefined {
  let anoNum = parseInt(ano, 10);
  if (ano.length === 2) {
    // Ano com 2 dígitos: heurística pivot — 50+ é 19xx, < 50 é 20xx
    anoNum = anoNum >= 50 ? 1900 + anoNum : 2000 + anoNum;
  }
  if (anoNum < 1900 || anoNum > new Date().getFullYear()) return undefined;
  return `${anoNum.toString().padStart(4, '0')}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function normalizar(t: string): string {
  return t
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}
