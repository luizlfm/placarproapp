/**
 * Parser de texto OCR de documentos brasileiros (CNH, RG, CPF).
 *
 * V2 — Estratégia LABEL-BASED:
 * Em vez de heurística "linha maiúscula = nome" (que pegava textos
 * institucionais como "MINISTÉRIO DA INFRAESTRUTURA"), agora o parser:
 *   1. Localiza labels conhecidos do documento (NOME, CPF, FILIAÇÃO,
 *      DOC. IDENTIDADE, NASCIMENTO, etc.)
 *   2. Extrai o valor IMEDIATAMENTE após o label (mesma linha ou linha
 *      seguinte)
 *   3. Valida cada valor com regex apropriada
 *   4. Só usa heurística como FALLBACK quando o label não foi encontrado
 *
 * Suporta CNH (Carteira Nacional de Habilitação), RG (Carteira de
 * Identidade) e variantes regionais. Tolerante a ruído OCR (espaços
 * extras, caracteres trocados, acentos perdidos).
 */

export interface DadosDocumentoBR {
  /** Texto bruto do OCR (pra debugging/manual review). */
  textoOriginal: string;
  /** Nome completo do titular. */
  nome?: string;
  /** CPF formatado: `123.456.789-00`. */
  cpf?: string;
  /** RG / DOC. IDENTIDADE (na CNH é "MG14967119 SSP MG", no RG é só o número). */
  rg?: string;
  /** Data nascimento ISO: `YYYY-MM-DD`. */
  dataNascimento?: string;
  /** Número de registro da CNH (só CNH). */
  registroCnh?: string;
  /** Validade da CNH ISO: `YYYY-MM-DD` (só CNH). */
  validadeCnh?: string;
  /** Categoria da habilitação (AB, B, AC, etc. — só CNH). */
  categoriaCnh?: string;
  /** Nome do pai. */
  nomePai?: string;
  /** Nome da mãe. */
  nomeMae?: string;
  /** Confiança do parser (0-1) — fração de campos obrigatórios preenchidos. */
  confianca: number;
}

/** Map de variações de label que aparecem nos documentos. */
const LABELS = {
  nome: ['NOME', 'NOME COMPLETO', 'NOME E SOBRENOME'],
  cpf: ['CPF', 'C.P.F', 'C P F'],
  rg: [
    'DOC IDENTIDADE', 'DOC. IDENTIDADE', 'DOCUMENTO DE IDENTIDADE',
    'IDENTIDADE', 'RG', 'REGISTRO GERAL', 'CARTEIRA DE IDENTIDADE',
    'IDENT', 'CART IDENT',
  ],
  nascimento: [
    'DATA NASCIMENTO', 'DATA DE NASCIMENTO', 'NASCIMENTO',
    'DT NASC', 'DT NASCIMENTO', 'DATA NASC', 'NASC',
  ],
  filiacao: ['FILIACAO', 'FILIAÇÃO', 'FILIAÇAO', 'FILIACÃO', 'PAI E MAE', 'PAI E MÃE'],
  registroCnh: ['N° REGISTRO', 'Nº REGISTRO', 'N REGISTRO', 'REGISTRO', 'NUMERO REGISTRO'],
  validadeCnh: ['VALIDADE', 'VALIDA ATE', 'VÁLIDA ATÉ', 'VALIDADE CNH'],
  categoriaCnh: ['CAT HAB', 'CAT. HAB', 'CATEGORIA', 'CATEGORIA HABILITACAO', 'CAT'],
} as const;

/** Palavras que NUNCA fazem parte de nome próprio — extensão da blacklist. */
const PALAVRAS_INSTITUCIONAIS = new Set([
  'REPUBLICA', 'REPÚBLICA', 'FEDERATIVA', 'BRASIL',
  'MINISTERIO', 'MINISTÉRIO', 'INFRAESTRUTURA', 'INFRAESTUTURA',
  'DEPARTAMENTO', 'NACIONAL', 'TRANSITO', 'TRÂNSITO',
  'CARTEIRA', 'HABILITACAO', 'HABILITAÇÃO',
  'REGISTRO', 'GERAL', 'IDENTIDADE', 'IDENT',
  'DETRAN', 'INSTITUTO', 'SECRETARIA', 'ESTADO',
  'POLICIA', 'POLÍCIA', 'CIVIL', 'FEDERAL',
  'CONDUTOR', 'CATEGORIA', 'NOME', 'FILIACAO', 'FILIAÇÃO',
  'NASCIMENTO', 'NATURALIDADE', 'CPF', 'RG', 'DATA',
  'EMISSAO', 'EMISSÃO', 'VALIDADE', 'ORGAO', 'ÓRGÃO',
  'PERMISSAO', 'PERMISSÃO', 'OBSERVACAO', 'OBSERVAÇÃO',
  'VALIDA', 'VÁLIDA', 'TODO', 'TERRITORIO', 'TERRITÓRIO',
  'DOC', 'DOCUMENTO',
  // Artefatos OCR comuns no cabeçalho da CNH
  'SAR', 'SU', 'ES', 'EE',
]);

// ──────────────────────────────────────────────────────────────────────
// Parser principal
// ──────────────────────────────────────────────────────────────────────

export function parseDocumentoBR(textoBruto: string): DadosDocumentoBR {
  const texto = normalizar(textoBruto);
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);

  const resultado: DadosDocumentoBR = {
    textoOriginal: textoBruto,
    confianca: 0,
  };

  // 1) Tenta extração label-based — preferida, mais precisa.
  resultado.nome = acharValorAposLabel(linhas, LABELS.nome, { validador: validarNome });
  resultado.cpf = acharValorAposLabel(linhas, LABELS.cpf, { validador: ehCpfValidoFormatado, extrator: extrairCpfDaLinha });
  resultado.rg = acharValorAposLabel(linhas, LABELS.rg, { extrator: extrairRgDaLinha });
  resultado.dataNascimento = acharValorAposLabel(linhas, LABELS.nascimento, { extrator: extrairDataDaLinha });
  resultado.registroCnh = acharValorAposLabel(linhas, LABELS.registroCnh, { extrator: extrairRegistroCnh });
  resultado.validadeCnh = acharValorAposLabel(linhas, LABELS.validadeCnh, { extrator: extrairDataDaLinha });
  resultado.categoriaCnh = acharValorAposLabel(linhas, LABELS.categoriaCnh, { extrator: extrairCategoriaCnh });

  // Filiação tem 2 nomes — extrai os 2 primeiros nomes válidos após o label.
  const filiacao = acharFiliacao(linhas);
  resultado.nomePai = filiacao[0];
  resultado.nomeMae = filiacao[1];

  // 2) Fallbacks — só se label-based falhou.
  if (!resultado.cpf) resultado.cpf = extrairCpfGlobal(texto);
  if (!resultado.dataNascimento) resultado.dataNascimento = extrairDataNascimentoFallback(texto);
  if (!resultado.nome) resultado.nome = extrairNomeFallback(linhas);

  // 3) Confiança — fração de campos obrigatórios preenchidos.
  const camposObrigatorios = ['nome', 'cpf', 'dataNascimento'] as const;
  const preenchidos = camposObrigatorios.filter(k => !!resultado[k]).length;
  resultado.confianca = preenchidos / camposObrigatorios.length;

  return resultado;
}

// ──────────────────────────────────────────────────────────────────────
// Core: busca de valor por label
// ──────────────────────────────────────────────────────────────────────

/**
 * Procura `labels` no array de linhas e retorna o valor associado.
 *
 * Estratégia (em ordem):
 *   A) Se a linha do label tem MAIS texto após o label (mesma linha,
 *      formato "LABEL: valor" ou "LABEL valor") → usa esse texto
 *   B) Senão, pega a PRIMEIRA linha não-vazia abaixo do label
 *   C) Aplica validador/extrator opcional
 */
function acharValorAposLabel(
  linhas: string[],
  labels: readonly string[],
  opcoes: {
    validador?: (v: string) => boolean;
    extrator?: (linha: string) => string | undefined;
  } = {},
): string | undefined {
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const linhaUpper = linha.toUpperCase();

    for (const label of labels) {
      const labelUpper = label.toUpperCase();
      const idx = linhaUpper.indexOf(labelUpper);
      if (idx < 0) continue;

      // Verifica se é label "isolado" (não substring de outra palavra).
      // Ex: "NOME" deve casar mas "SOBRENOME" não. Checa borda à esquerda.
      const charAntes = idx > 0 ? linha[idx - 1] : ' ';
      if (!/[\s\W]/.test(charAntes)) continue;

      // A) Tenta extrair do RESTO da MESMA linha após o label
      const resto = linha.slice(idx + labelUpper.length)
        .replace(/^[\s:.\-/—–]+/, '') // limpa separadores
        .trim();
      if (resto) {
        const v = aplicarExtratorValidador(resto, opcoes);
        if (v) return v;
      }

      // B) Tenta as próximas 2 linhas (alguns layouts colocam o
      //    label numa linha e o valor na seguinte ou na subsequente)
      for (let j = i + 1; j <= Math.min(i + 2, linhas.length - 1); j++) {
        const seguinte = linhas[j];
        // Se a linha seguinte parecer ser OUTRO label, para de procurar.
        if (ehLinhaDeLabel(seguinte)) break;
        const v = aplicarExtratorValidador(seguinte, opcoes);
        if (v) return v;
      }
    }
  }
  return undefined;
}

/** Aplica extrator (se presente) + validador (se presente) numa linha. */
function aplicarExtratorValidador(
  texto: string,
  opcoes: { validador?: (v: string) => boolean; extrator?: (linha: string) => string | undefined },
): string | undefined {
  const candidato = opcoes.extrator ? opcoes.extrator(texto) : texto;
  if (!candidato) return undefined;
  if (opcoes.validador && !opcoes.validador(candidato)) return undefined;
  return candidato;
}

/**
 * Linha parece ser um label de campo (não um valor)? Usado pra parar
 * de procurar valor quando bate em outro label.
 */
function ehLinhaDeLabel(linha: string): boolean {
  const upper = linha.toUpperCase();
  const todosLabels = Object.values(LABELS).flat();
  return todosLabels.some(lbl => upper.includes(lbl.toUpperCase()));
}

// ──────────────────────────────────────────────────────────────────────
// Validadores
// ──────────────────────────────────────────────────────────────────────

/**
 * Nome válido = 2+ palavras, sem dígitos, sem maioria de palavras
 * institucionais. Aceita texto com letras maiúsculas E minúsculas
 * (alguns docs aparecem em title case).
 */
function validarNome(v: string): boolean {
  if (v.length < 5 || v.length > 100) return false;
  // Sem dígitos
  if (/\d/.test(v)) return false;
  // Só letras, acentos, espaços, hífens, apóstrofos
  if (!/^[A-Za-zÀ-ÿ\s'\-]+$/.test(v)) return false;
  const palavras = v.toUpperCase().split(/\s+/).filter(p => p.length >= 2);
  if (palavras.length < 2) return false;
  // Rejeita se QUALQUER palavra estiver na blacklist institucional
  if (palavras.some(p => PALAVRAS_INSTITUCIONAIS.has(p))) return false;
  return true;
}

function ehCpfValidoFormatado(cpf: string): boolean {
  return validarCpfBruto(cpf.replace(/\D/g, ''));
}

function validarCpfBruto(cpf: string): boolean {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let dig1 = 11 - (soma % 11);
  if (dig1 >= 10) dig1 = 0;
  if (dig1 !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  let dig2 = 11 - (soma % 11);
  if (dig2 >= 10) dig2 = 0;
  return dig2 === parseInt(cpf[10], 10);
}

// ──────────────────────────────────────────────────────────────────────
// Extratores específicos por campo (aplicados em linhas candidatas)
// ──────────────────────────────────────────────────────────────────────

function extrairCpfDaLinha(linha: string): string | undefined {
  const m = /(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{2})/.exec(linha);
  if (!m) return undefined;
  const numeros = m[1] + m[2] + m[3] + m[4];
  if (!validarCpfBruto(numeros)) return undefined;
  return `${m[1]}.${m[2]}.${m[3]}-${m[4]}`;
}

/**
 * RG da CNH vem como "MG14967119 SSP MG" — número + órgão emissor + UF.
 * RG comum vem só como número "00.000.000-0". Tentamos pegar ambos.
 */
function extrairRgDaLinha(linha: string): string | undefined {
  // Padrão CNH: opcionalmente 2 letras de UF + 7-10 dígitos + sigla órgão + UF
  const cnh = /([A-Z]{0,2}\s?\d{6,10})(\s+[A-Z]{2,4})?(\s+[A-Z]{2})?/.exec(linha);
  if (cnh) {
    return [cnh[1], cnh[2], cnh[3]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }
  // Padrão RG: dígitos com pontuação opcional + dígito verificador
  const rg = /(\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX])/.exec(linha);
  return rg ? rg[1] : undefined;
}

function extrairDataDaLinha(linha: string): string | undefined {
  const m = /(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/.exec(linha);
  if (!m) return undefined;
  const ano = parseInt(m[3], 10);
  if (ano < 1900 || ano > 2100) return undefined;
  return formatarDataIso(m[1], m[2], m[3]);
}

function extrairRegistroCnh(linha: string): string | undefined {
  // Nº de registro CNH = exatamente 11 dígitos consecutivos.
  const m = /\b(\d{11})\b/.exec(linha);
  return m ? m[1] : undefined;
}

function extrairCategoriaCnh(linha: string): string | undefined {
  // Categoria CNH = 1-3 letras maiúsculas (A, B, AB, AC, ACC, etc.)
  const m = /\b(A|B|C|D|E|AB|AC|AD|AE|BC|BD|BE|CD|CE|DE|ACC)\b/.exec(linha.toUpperCase());
  return m ? m[1] : undefined;
}

// ──────────────────────────────────────────────────────────────────────
// Fallbacks globais (quando label-based não acha)
// ──────────────────────────────────────────────────────────────────────

function extrairCpfGlobal(texto: string): string | undefined {
  const regex = /(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{2})/g;
  let match;
  while ((match = regex.exec(texto)) !== null) {
    const numeros = match[1] + match[2] + match[3] + match[4];
    if (validarCpfBruto(numeros)) {
      return `${match[1]}.${match[2]}.${match[3]}-${match[4]}`;
    }
  }
  return undefined;
}

function extrairDataNascimentoFallback(texto: string): string | undefined {
  // Primeira data válida do texto (1900-ano atual)
  const m = /(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})/.exec(texto);
  if (m) {
    const ano = parseInt(m[3], 10);
    if (ano >= 1900 && ano <= new Date().getFullYear()) {
      return formatarDataIso(m[1], m[2], m[3]);
    }
  }
  return undefined;
}

/**
 * Fallback do nome — só quando o label "NOME" não foi encontrado.
 * Usa heurística mas mais rigorosa (rejeita QUALQUER palavra
 * institucional, não só "maioria").
 */
function extrairNomeFallback(linhas: string[]): string | undefined {
  for (const linha of linhas) {
    if (validarNome(linha)) return linha;
  }
  return undefined;
}

function acharFiliacao(linhas: string[]): [string?, string?] {
  for (let i = 0; i < linhas.length; i++) {
    const upper = linhas[i].toUpperCase();
    if (LABELS.filiacao.some(lbl => upper.includes(lbl))) {
      const nomes: string[] = [];
      for (let j = i + 1; j < Math.min(i + 6, linhas.length); j++) {
        if (ehLinhaDeLabel(linhas[j])) break;
        if (validarNome(linhas[j])) nomes.push(linhas[j]);
        if (nomes.length === 2) break;
      }
      return [nomes[0], nomes[1]];
    }
  }
  return [undefined, undefined];
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function normalizar(t: string): string {
  return t
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Remove caracteres claramente de borda/decoração ('|', '#', etc. soltos)
    .replace(/(^|\n)\s*[|#=*_~]+\s*(?=\n|$)/g, '');
}

function formatarDataIso(dia: string, mes: string, ano: string): string {
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}
