import type { jsPDF } from 'jspdf';
import type { ModalController, ToastController } from '@ionic/angular';
import { PdfViewerModalComponent } from './components/pdf-viewer-modal/pdf-viewer-modal.component';

/**
 * Helper pra salvar/baixar PDFs gerados pelo jsPDF.
 *
 * No iOS Safari, `pdf.save()` navega a aba atual pra dentro do blob do PDF
 * (sequestra o app) e `navigator.share` direto frequentemente falha por
 * causa do "user activation" perdido durante os awaits de geração.
 *
 * Solução: no iOS, se `modalCtrl` for passado, abrimos um modal interno
 * mostrando o PDF + botão "Salvar PDF". O share API é disparado por um
 * clique direto do usuário no modal → user activation está fresca →
 * funciona. Sem `modalCtrl`, caímos em fallback de aba nova ou `pdf.save()`.
 */

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIPadOS = /Mac/.test(ua) && typeof document !== 'undefined' &&
    'ontouchend' in document;
  return /iPhone|iPad|iPod/.test(ua) || isIPadOS;
}

function podeCompartilharArquivos(file: File): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  return typeof nav.share === 'function' &&
    typeof nav.canShare === 'function' &&
    nav.canShare({ files: [file] });
}

async function mostrarToast(toast: ToastController | undefined, message: string): Promise<void> {
  if (!toast) return;
  const t = await toast.create({
    message,
    duration: 6000,
    color: 'primary',
    position: 'bottom',
  });
  await t.present();
}

/**
 * Imprime um PDF: no desktop dispara `pdf.autoPrint()` + window.open
 * (browser abre diálogo de impressão automaticamente). No iOS Safari,
 * `window.open(blobUrl)` sequestra a aba do app — então usamos o mesmo
 * fluxo do `salvarPdf` (modal/share sheet). O share sheet do iOS tem
 * AirPrint nativo, então o usuário ainda consegue imprimir dali.
 */
export async function imprimirPdf(
  pdf: jsPDF,
  fileName: string,
  toastCtrl?: ToastController,
  modalCtrl?: ModalController,
): Promise<void> {
  if (isIOS()) {
    return salvarPdf(pdf, fileName, toastCtrl, modalCtrl, 'imprimir');
  }

  pdf.autoPrint();
  const blobUrl = pdf.output('bloburl');
  window.open(blobUrl, '_blank');
}

/**
 * Salva um PDF gerado pelo jsPDF de forma compatível com iOS Safari.
 *
 * @param pdf instância jsPDF já preenchida
 * @param fileName nome do arquivo (ex: "sumula-123.pdf")
 * @param toastCtrl opcional — usado em fallbacks pra instruir o usuário
 * @param modalCtrl opcional — no iOS, abre modal interno com botão "Salvar"
 */
export async function salvarPdf(
  pdf: jsPDF,
  fileName: string,
  toastCtrl?: ToastController,
  modalCtrl?: ModalController,
  acao: 'salvar' | 'imprimir' = 'salvar',
): Promise<void> {
  if (!isIOS()) {
    pdf.save(fileName);
    return;
  }

  const blob = pdf.output('blob');

  if (modalCtrl) {
    const modal = await modalCtrl.create({
      component: PdfViewerModalComponent,
      componentProps: { blob, fileName, acao },
      cssClass: 'pdf-popup-modal',
    });
    await modal.present();
    return;
  }

  const file = new File([blob], fileName, { type: 'application/pdf' });

  if (podeCompartilharArquivos(file)) {
    try {
      await (navigator as Navigator & {
        share: (data: { files: File[]; title?: string }) => Promise<void>;
      }).share({ files: [file], title: fileName });
      return;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err &&
        (err as { name: string }).name === 'AbortError') {
        return;
      }
      console.warn('[salvarPdf] Web Share falhou, tentando aba nova', err);
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, '_blank');
  if (win) {
    await mostrarToast(
      toastCtrl,
      'PDF aberto em nova aba. Toque em compartilhar ↗ no Safari pra salvar.',
    );
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  console.warn('[salvarPdf] window.open bloqueado, usando pdf.save()');
  await mostrarToast(
    toastCtrl,
    'Pra salvar, toque em compartilhar ↗ no Safari após o PDF abrir.',
  );
  pdf.save(fileName);
}
