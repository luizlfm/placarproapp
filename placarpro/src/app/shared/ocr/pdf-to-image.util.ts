/**
 * Utilitário pra converter PDF em imagem(ns) PNG usando pdfjs-dist.
 *
 * Necessário pra OCR porque o Tesseract.js só lê IMAGENS (PNG/JPG/etc.).
 * Quando o user faz upload de um PDF de documento (CNH digital, RG
 * digitalizado, atestado), precisamos renderizar cada página num canvas
 * e exportar como data URL antes de passar pro OCR.
 *
 * Performance: pdfjs roda o parsing/rendering no thread principal —
 * documentos muito grandes (10+ páginas) podem travar a UI. Pra OCR
 * de documento de identidade normalmente é 1-2 páginas, então OK.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configura o worker do pdfjs. Usa o build legacy (mais compatível
// com bundlers/PWAs) e aponta pro CDN do unpkg pra não bagunçar o
// Angular CLI asset pipeline. Se precisar 100% offline, baixar
// `pdf.worker.min.mjs` pra `assets/` e apontar pra `assets/pdf.worker.min.mjs`.
const PDFJS_VERSION = (pdfjsLib as { version?: string }).version || '5.4.149';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

/**
 * Converte um PDF (data URL ou ArrayBuffer) em array de data URLs PNG —
 * uma entrada por página.
 *
 * @param pdfDataUrl   `data:application/pdf;base64,...` OU ArrayBuffer
 * @param opcoes
 *   - scale: zoom aplicado ao renderizar (default 2 → boa resolução pra OCR
 *     sem inflar memory)
 *   - paginas: limita quantas páginas processar (default Infinity)
 *
 * @returns array de data URLs PNG, uma por página
 */
export async function pdfParaImagens(
  pdfDataUrl: string | ArrayBuffer,
  opcoes: { scale?: number; paginas?: number } = {},
): Promise<string[]> {
  const scale = opcoes.scale ?? 2;
  const maxPaginas = opcoes.paginas ?? Infinity;

  // Converte data URL pra ArrayBuffer (pdfjs aceita os dois).
  let buffer: ArrayBuffer;
  if (typeof pdfDataUrl === 'string') {
    const base64 = pdfDataUrl.replace(/^data:application\/pdf[^;]*;base64,/, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    buffer = bytes.buffer;
  } else {
    buffer = pdfDataUrl;
  }

  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const totalPaginas = Math.min(pdf.numPages, maxPaginas);
  const imagens: string[] = [];

  for (let i = 1; i <= totalPaginas; i++) {
    const pagina = await pdf.getPage(i);
    const viewport = pagina.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // Type assertion porque pdfjs-dist tem types levemente desalinhados
    // entre versões — RenderParameters exige `canvas` em algumas versões
    // novas que não está nos types ainda.
    await pagina.render({
      canvas,
      canvasContext: ctx,
      viewport,
    } as Parameters<typeof pagina.render>[0]).promise;

    imagens.push(canvas.toDataURL('image/png'));
  }

  return imagens;
}

/**
 * Conveniência: converte só a 1ª página (caso mais comum pra OCR de
 * documento de identidade). Mais rápido que processar todas.
 */
export async function pdfParaPrimeiraImagem(
  pdfDataUrl: string | ArrayBuffer,
  scale = 2,
): Promise<string | null> {
  const imagens = await pdfParaImagens(pdfDataUrl, { scale, paginas: 1 });
  return imagens[0] ?? null;
}
