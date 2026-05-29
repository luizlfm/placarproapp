import { Injectable } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

/**
 * Serviço de captura de imagem pro fluxo OCR.
 *
 * Estratégia:
 * - **Capacitor nativo** (Android/iOS app instalado) → usa `@capacitor/camera`
 *   que abre a câmera nativa do dispositivo com qualidade alta.
 * - **PWA web** (browser desktop ou mobile) → fallback via `<input type="file"
 *   accept="image/*" capture="environment">` que abre a câmera traseira em
 *   mobile e file picker no desktop.
 *
 * Retorna sempre uma **data URL** (base64) que o Tesseract.js consome
 * diretamente sem precisar de upload ou conversão extra.
 */
@Injectable({ providedIn: 'root' })
export class OcrCameraService {
  /** True quando rodando dentro do Capacitor (app nativo Android/iOS). */
  private get isNativo(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Abre a câmera (ou file picker) e retorna a foto capturada como data URL.
   * Throws se o user cancelar.
   */
  async capturar(): Promise<string> {
    if (this.isNativo) {
      return this.capturarNativo();
    }
    return this.capturarWeb();
  }

  /** Permite escolher entre câmera e galeria (mobile nativo). */
  async escolher(): Promise<string> {
    if (this.isNativo) {
      return this.capturarNativoComEscolha();
    }
    // No web, o `<input type="file">` já oferece a opção de câmera ou galeria.
    return this.capturarWeb();
  }

  // ──────────────────────────────────────────────────────────────────
  // CAPACITOR NATIVO
  // ──────────────────────────────────────────────────────────────────

  private async capturarNativo(): Promise<string> {
    const photo = await Camera.getPhoto({
      quality: 90,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      allowEditing: false,
      // Documento normalmente é horizontal/retangular — qualidade alta ajuda OCR.
      width: 1920,
      correctOrientation: true,
    });
    if (!photo.dataUrl) {
      throw new Error('Foto não retornada pela câmera.');
    }
    return photo.dataUrl;
  }

  private async capturarNativoComEscolha(): Promise<string> {
    const photo = await Camera.getPhoto({
      quality: 90,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Prompt,
      allowEditing: false,
      width: 1920,
      correctOrientation: true,
      promptLabelHeader: 'Origem da imagem',
      promptLabelPhoto: 'Galeria',
      promptLabelPicture: 'Câmera',
    });
    if (!photo.dataUrl) {
      throw new Error('Foto não retornada pela câmera.');
    }
    return photo.dataUrl;
  }

  // ──────────────────────────────────────────────────────────────────
  // FALLBACK WEB (file input com capture)
  // ──────────────────────────────────────────────────────────────────

  private capturarWeb(): Promise<string> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      // Aceita imagens E PDF — PDFs são convertidos pra image pelo
      // OcrService antes do Tesseract rodar (que não lê PDF nativamente).
      input.accept = 'image/*,application/pdf';
      // `capture="environment"` faz mobile browsers abrirem câmera traseira
      // direto. Desktop ignora e mostra file picker normal.
      input.setAttribute('capture', 'environment');
      input.style.display = 'none';

      const cleanup = (): void => {
        try {
          if (input.parentNode) input.parentNode.removeChild(input);
        } catch { /* ignore */ }
      };

      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          reject(new Error('Nenhum arquivo selecionado.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          cleanup();
          resolve(reader.result as string);
        };
        reader.onerror = () => {
          cleanup();
          reject(reader.error ?? new Error('Falha ao ler arquivo.'));
        };
        reader.readAsDataURL(file);
      });

      // Evento `cancel` nativo (Chrome 113+, Firefox 91+, Safari 16+).
      // Dispara quando o user fecha o file picker sem escolher arquivo.
      // Muito mais confiável que o hack antigo de window.focus + timeout
      // (que disparava ANTES do `change` chegar no Windows, fazendo o
      // user precisar selecionar 2-3 vezes pro arquivo "aparecer").
      input.addEventListener('cancel', () => {
        cleanup();
        reject(new Error('Captura cancelada.'));
      });

      document.body.appendChild(input);
      input.click();
    });
  }

  /**
   * Helper estático — detecta se uma data URL é PDF (vs imagem).
   * Usado pelo OcrImportModal pra decidir se precisa converter
   * pra imagem antes de rodar Tesseract.
   */
  static ehPdf(dataUrl: string): boolean {
    return dataUrl.startsWith('data:application/pdf');
  }
}
