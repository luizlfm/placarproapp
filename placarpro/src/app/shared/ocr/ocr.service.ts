import { Injectable } from '@angular/core';
import { createWorker, Worker, PSM } from 'tesseract.js';
import { preprocessarImagem } from './image-preprocess.util';

/**
 * Serviço de OCR usando Tesseract.js.
 *
 * Carrega o worker uma vez (lazy) e reusa em chamadas subsequentes — assim
 * o overhead de inicialização (~3-5s pra baixar o WASM + idioma) acontece
 * só uma vez na sessão.
 *
 * Idiomas: 'por' (português) por padrão. Pra adicionar mais, passar como
 * `langs` no `extrair()` — ex: `['por', 'eng']` pra documentos bilíngues.
 *
 * Performance: o Tesseract roda no thread principal por padrão. Pra
 * imagens grandes pode travar a UI por alguns segundos — sempre exibir
 * loading enquanto processa.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  private worker: Worker | null = null;
  private langAtual = '';
  /** True enquanto o worker está sendo inicializado — evita race condition
   *  de chamadas simultâneas tentarem criar 2 workers. */
  private inicializando: Promise<Worker> | null = null;

  /**
   * Extrai todo o texto reconhecido da imagem.
   *
   * Por padrão aplica PRÉ-PROCESSAMENTO (grayscale + contraste + resize)
   * que aumenta MUITO a precisão em fotos de documento. Passar
   * `preprocessar: false` se a imagem já está limpa (ex: PDF renderizado).
   *
   * @param imagem  Data URL (base64) OU File OU Blob OU HTMLImageElement.
   * @param langs   Idiomas pra reconhecer. Default: 'por'.
   * @param opcoes  { preprocessar?: boolean } — default true.
   * @returns       Texto bruto reconhecido, com quebras de linha preservadas.
   */
  async extrair(
    imagem: string | File | Blob | HTMLImageElement,
    langs: string | string[] = 'por',
    opcoes: { preprocessar?: boolean } = {},
  ): Promise<string> {
    const langStr = Array.isArray(langs) ? langs.join('+') : langs;
    const worker = await this.obterWorker(langStr);

    // Pré-processa só se for data URL (string base64) — File/Blob/Img
    // ficaria custoso converter; nesses casos passar `preprocessar: false`.
    let imagemFinal: string | File | Blob | HTMLImageElement = imagem;
    if (typeof imagem === 'string' && opcoes.preprocessar !== false) {
      try {
        imagemFinal = await preprocessarImagem(imagem);
      } catch (err) {
        console.warn('[OcrService] preprocess falhou, usando imagem original', err);
      }
    }

    const { data } = await worker.recognize(imagemFinal);
    return data.text ?? '';
  }

  /**
   * Igual ao `extrair()` mas retorna também as linhas reconhecidas com
   * confidence — útil pra parsing posicional (tabelas, layouts fixos).
   *
   * Nota: `lines` no Tesseract.js v5+ está tipado como `unknown` no
   * `RecognizeResult` (vem só com a opção `{ blocks: true }` em algumas
   * versões). Fazemos cast defensivo com fallback pra array vazio.
   */
  async extrairDetalhado(
    imagem: string | File | Blob | HTMLImageElement,
    langs: string | string[] = 'por',
  ): Promise<{ texto: string; confianca: number; linhas: { texto: string; confianca: number }[] }> {
    const langStr = Array.isArray(langs) ? langs.join('+') : langs;
    const worker = await this.obterWorker(langStr);

    const { data } = await worker.recognize(imagem);
    const dataAny = data as { text?: string; confidence?: number; lines?: Array<{ text?: string; confidence?: number }> };
    const linhasRaw = dataAny.lines ?? [];
    return {
      texto: dataAny.text ?? '',
      confianca: dataAny.confidence ?? 0,
      linhas: linhasRaw.map(l => ({
        texto: l.text ?? '',
        confianca: l.confidence ?? 0,
      })),
    };
  }

  /**
   * Encerra o worker e libera memória. Chamar quando souber que não vai
   * usar OCR por um tempo (ex: ao fechar modal de OCR). Próxima chamada
   * reinicializa automaticamente.
   */
  async destruir(): Promise<void> {
    if (this.worker) {
      try { await this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
      this.langAtual = '';
    }
  }

  /** Lazy-init do worker. Re-inicializa se o idioma mudou. */
  private async obterWorker(lang: string): Promise<Worker> {
    if (this.worker && this.langAtual === lang) {
      return this.worker;
    }
    // Se está inicializando, espera a mesma promise — evita race.
    if (this.inicializando) {
      return this.inicializando;
    }
    // Idioma diferente do anterior — encerra worker antigo.
    if (this.worker && this.langAtual !== lang) {
      try { await this.worker.terminate(); } catch { /* ignore */ }
      this.worker = null;
    }

    this.inicializando = (async (): Promise<Worker> => {
      try {
        const w = await createWorker(lang);
        // Configurações otimizadas pra OCR de DOCUMENTOS de identidade:
        // - PSM.AUTO (3): segmentação automática, detecta blocos/labels/valores
        //   bem em layouts típicos de RG/CNH (várias colunas + caixas).
        // - Preservar espaços inter-palavra ajuda parser a separar campos.
        await w.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1',
        });
        this.worker = w;
        this.langAtual = lang;
        return w;
      } finally {
        this.inicializando = null;
      }
    })();

    return this.inicializando;
  }
}
