import type { jsPDF } from 'jspdf';

/**
 * Helper pra salvar/baixar PDFs gerados pelo jsPDF.
 *
 * PROBLEMA: no iOS Safari, `pdf.save()` (que usa `<a download>` por baixo
 * dos panos) NÃO baixa o arquivo — abre o PDF inline numa nova aba sem
 * opção visível de salvar. O usuário tem que tocar no botão de compartilhar
 * do Safari pra conseguir salvar nos Arquivos. UX ruim.
 *
 * SOLUÇÃO: detectar iOS e usar `navigator.share()` com o PDF como File.
 * Isso dispara o share sheet NATIVO do iOS, que tem "Salvar em Arquivos"
 * como primeira opção, e ao terminar volta automaticamente pra tela do
 * app (não abre nova aba do Safari).
 *
 * Em browsers que NÃO são iOS Safari, `pdf.save()` funciona normalmente
 * (download direto via `<a download>`).
 */

/** True se está rodando em iOS (iPhone/iPad/iPod). */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPad em iOS 13+ se identifica como Mac, então checamos também
  // `maxTouchPoints` pra distinguir Mac real de iPad.
  const isIPadOS = /Mac/.test(ua) && typeof document !== 'undefined' &&
    'ontouchend' in document;
  return /iPhone|iPad|iPod/.test(ua) || isIPadOS;
}

/** True se o browser suporta Web Share API com arquivos. */
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

/**
 * Salva um PDF gerado pelo jsPDF de forma compatível com iOS Safari.
 *
 * - iOS Safari (com Web Share API): abre share sheet nativo
 * - Outros browsers: download direto via `pdf.save()`
 *
 * @param pdf instância jsPDF já preenchida
 * @param fileName nome do arquivo (ex: "sumula-123.pdf")
 */
export async function salvarPdf(pdf: jsPDF, fileName: string): Promise<void> {
  if (isIOS()) {
    try {
      const blob = pdf.output('blob');
      const file = new File([blob], fileName, { type: 'application/pdf' });

      if (podeCompartilharArquivos(file)) {
        await (navigator as Navigator & {
          share: (data: { files: File[]; title?: string }) => Promise<void>;
        }).share({
          files: [file],
          title: fileName,
        });
        return;
      }
    } catch (err: unknown) {
      // AbortError = usuário cancelou o share sheet. NÃO é erro, só sai.
      if (err && typeof err === 'object' && 'name' in err &&
        (err as { name: string }).name === 'AbortError') {
        return;
      }
      // Qualquer outro erro: tenta o fallback pdf.save() abaixo.
      console.warn('[salvarPdf] Web Share falhou, usando pdf.save()', err);
    }
  }

  // Fallback / desktop / Android: download direto via <a download>.
  pdf.save(fileName);
}
