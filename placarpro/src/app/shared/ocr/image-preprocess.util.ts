/**
 * Pré-processamento de imagem antes do OCR — melhora significativamente
 * a precisão do Tesseract em fotos de documento.
 *
 * Pipeline aplicado:
 *   1. Redimensiona pra largura ALVO (default 1600px) — Tesseract funciona
 *      melhor com imagens grandes mas não gigantes (5000px+ desperdiça
 *      tempo sem ganho de precisão).
 *   2. Converte pra TONS DE CINZA — remove distração de cores.
 *   3. Aumenta CONTRASTE — texto fica mais "preto" e fundo mais "branco".
 *   4. (Opcional) Aplica THRESHOLD binário — útil pra documentos com
 *      fundo uniforme; ruim pra fotos com sombra/iluminação irregular.
 *
 * Retorna data URL PNG processada.
 */

export interface PreprocessOpcoes {
  /** Largura alvo em pixels. Default 1600 (sweet spot pra OCR). */
  larguraAlvo?: number;
  /** Multiplica contraste. 1.0 = sem mudança. 1.3-1.5 = bom default. */
  contraste?: number;
  /** Aplica threshold binário (0-255). Default false. */
  threshold?: number | false;
}

const DEFAULTS: Required<Omit<PreprocessOpcoes, 'threshold'>> & { threshold: number | false } = {
  larguraAlvo: 1600,
  contraste: 1.35,
  threshold: false,
};

/**
 * Pré-processa uma imagem (data URL) e retorna uma nova data URL PNG
 * otimizada pra OCR.
 */
export async function preprocessarImagem(
  imagemDataUrl: string,
  opcoes: PreprocessOpcoes = {},
): Promise<string> {
  const opt = { ...DEFAULTS, ...opcoes };

  // 1) Carrega imagem
  const img = await carregarImagem(imagemDataUrl);

  // 2) Calcula tamanho destino mantendo aspect ratio
  const ratio = img.width / img.height;
  let larguraDestino = img.width;
  let alturaDestino = img.height;
  if (img.width > opt.larguraAlvo) {
    larguraDestino = opt.larguraAlvo;
    alturaDestino = Math.round(opt.larguraAlvo / ratio);
  }

  // 3) Cria canvas e desenha imagem redimensionada
  const canvas = document.createElement('canvas');
  canvas.width = larguraDestino;
  canvas.height = alturaDestino;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imagemDataUrl;

  // imageSmoothingQuality high → reamostragem bilinear de boa qualidade
  ctx.imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D & { imageSmoothingQuality: ImageSmoothingQuality })
    .imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, larguraDestino, alturaDestino);

  // 4) Pega pixels e aplica grayscale + contraste (+ threshold opcional)
  const imageData = ctx.getImageData(0, 0, larguraDestino, alturaDestino);
  const data = imageData.data;
  const contraste = opt.contraste;
  const factor = (259 * (contraste * 100 + 255)) / (255 * (259 - contraste * 100 + 0.001));

  for (let i = 0; i < data.length; i += 4) {
    // Grayscale (luminância perceptual ITU-R BT.601)
    const cinza = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

    // Aplica contraste
    let valor = Math.round(factor * (cinza - 128) + 128);
    valor = Math.max(0, Math.min(255, valor));

    // Threshold binário (opcional)
    if (opt.threshold !== false) {
      valor = valor >= opt.threshold ? 255 : 0;
    }

    data[i] = valor;
    data[i + 1] = valor;
    data[i + 2] = valor;
    // alpha mantém
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem.'));
    img.src = src;
  });
}
