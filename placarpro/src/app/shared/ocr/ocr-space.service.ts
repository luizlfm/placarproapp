import { Injectable } from '@angular/core';

/**
 * Serviço OCR cloud usando OCR.space (free tier: 25.000 requests/mês).
 *
 * Vantagens sobre Tesseract.js client-side:
 *   - Roda servidor: GPU + modelos modernos = MUITO mais precisão
 *   - Suporta múltiplos engines (Engine 2 = layout-aware, melhor pra
 *     documentos com fields/labels lado a lado tipo CNH)
 *   - Bundle do app não cresce (sem WASM/idiomas baixados)
 *
 * Chave demo "helloworld" funciona pra testes sem signup. Pra produção
 * com volume real, criar conta gratuita em ocr.space/ocrapi e usar
 * a chave própria (também 25k/mês grátis).
 *
 * Limite tamanho de imagem: 1 MB no free tier. Por isso fazemos resize
 * agressivo antes (max 1500px de largura).
 */
@Injectable({ providedIn: 'root' })
export class OcrSpaceService {
  /** Chave demo pública — funciona pra testes. Sobrescreva via
   *  `setApiKey()` pra produção. */
  private apiKey = 'helloworld';

  /** Endpoint v2 da OCR.space (suporta Engine 2 layout-aware). */
  private readonly endpoint = 'https://api.ocr.space/parse/image';

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Envia uma imagem (data URL) pra OCR.space e retorna o texto extraído.
   *
   * @param imagemDataUrl  Data URL (PNG/JPG/PDF base64)
   * @param opcoes
   *   - lang: 'por' | 'eng' | etc. Default 'por'.
   *   - engine: 1 (rápido) | 2 (layout-aware, melhor pra docs impressos)
   *     | 3 (TableOCR, MELHOR pra manuscrito e tabelas) | 5 (ML moderno).
   *     Default 2 (mais estável). Pra ficha manuscrita usar 3.
   *   - escala: redimensiona pra essa largura antes (default 1500px,
   *     pra ficar < 1MB no free tier). Engines 3/5 aceitam até 5000px
   *     no free tier — pode usar 2000 pra mais detalhe.
   */
  async extrair(
    imagemDataUrl: string,
    opcoes: { lang?: string; engine?: 1 | 2 | 3 | 5; escala?: number } = {},
  ): Promise<string> {
    const lang = opcoes.lang ?? 'por';
    const engine = opcoes.engine ?? 2;
    const escala = opcoes.escala ?? 1500;

    // Redimensiona antes (free tier tem limite de 1MB)
    const imagem = await this.redimensionar(imagemDataUrl, escala);

    // Monta form-data — OCR.space aceita JSON OU multipart; multipart
    // é mais fácil pra mandar base64 sem prefixo.
    const blob = await (await fetch(imagem)).blob();
    const form = new FormData();
    form.append('file', blob, 'documento.png');
    form.append('language', lang);
    form.append('OCREngine', String(engine));
    form.append('isOverlayRequired', 'false');
    form.append('detectOrientation', 'true');
    form.append('scale', 'true'); // melhora detecção em imagens pequenas
    form.append('apikey', this.apiKey);

    const res = await fetch(this.endpoint, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) {
      throw new Error(`OCR.space HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const data = await res.json() as {
      ParsedResults?: Array<{ ParsedText?: string }>;
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
      ErrorDetails?: string;
    };

    if (data.IsErroredOnProcessing) {
      const erro = Array.isArray(data.ErrorMessage)
        ? data.ErrorMessage.join(' / ')
        : (data.ErrorMessage ?? data.ErrorDetails ?? 'erro desconhecido');
      throw new Error(`OCR.space: ${erro}`);
    }

    const texto = data.ParsedResults?.[0]?.ParsedText ?? '';
    console.info(`[OcrSpace] extrair: ${texto.length} chars, engine=${engine}, lang=${lang}`);
    return texto;
  }

  /** Redimensiona pra largura máxima especificada (mantém aspect ratio). */
  private async redimensionar(dataUrl: string, larguraMaxima: number): Promise<string> {
    const img = await this.carregarImagem(dataUrl);
    if (img.width <= larguraMaxima) {
      // Mesmo já pequena, força reencode em JPEG quality 0.85 pra
      // reduzir tamanho do upload (PNG é muito pesado).
      return this.toJpeg(img, img.width, img.height);
    }
    const ratio = img.width / img.height;
    const w = larguraMaxima;
    const h = Math.round(w / ratio);
    return this.toJpeg(img, w, h);
  }

  private toJpeg(img: HTMLImageElement, w: number, h: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D não disponível.');
    ctx.imageSmoothingEnabled = true;
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality: ImageSmoothingQuality })
      .imageSmoothingQuality = 'high';
    // Fundo branco — JPEG não tem transparência, sem isso fica preto.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  private carregarImagem(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Falha ao carregar imagem.'));
      img.src = src;
    });
  }
}
