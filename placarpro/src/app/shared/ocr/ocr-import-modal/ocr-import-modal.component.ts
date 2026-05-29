import { Component, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { OcrService } from '../ocr.service';
import { OcrCameraService } from '../ocr-camera.service';
import { parseDocumentoBR, DadosDocumentoBR } from '../parsers/rg-parser';
import { pdfParaPrimeiraImagem } from '../pdf-to-image.util';

/**
 * Modal de captura + extração OCR de documento (RG/CNH/CPF).
 *
 * Fluxo:
 * 1. User clica "Tirar foto" → câmera abre (nativo ou web)
 * 2. Imagem capturada → preview na tela
 * 3. User confirma → roda OCR (Tesseract.js) + parser BR
 * 4. Campos extraídos aparecem editáveis pra revisão
 * 5. User toca "Importar" → modal fecha retornando os dados
 *
 * Resultado retornado pelo `dismiss({ saved: true, dados })` pode ser
 * usado pelo caller pra pré-preencher um formulário (ex: cadastro de
 * jogador → patchValue no Reactive Form).
 */
@Component({
  selector: 'app-ocr-import-modal',
  templateUrl: './ocr-import-modal.component.html',
  styleUrls: ['./ocr-import-modal.component.scss'],
  standalone: false,
})
export class OcrImportModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly ocr = inject(OcrService);
  private readonly camera = inject(OcrCameraService);

  /** Estados do fluxo: 'inicial' → 'capturado' → 'processando' → 'revisao' */
  estado: 'inicial' | 'capturado' | 'processando' | 'revisao' = 'inicial';

  /** Data URL do arquivo capturado (foto ou PDF original). */
  arquivoDataUrl: string | null = null;
  /** Data URL da IMAGEM renderizada (igual ao arquivo se foto;
   *  convertida via pdfjs se PDF). É o que vai pro OCR e pro preview. */
  imagemDataUrl: string | null = null;
  /** True se o arquivo capturado foi um PDF — controla UI/mensagens. */
  ehPdf = false;

  /** Resultado do parser, editável pelo user antes de confirmar. */
  dados: DadosDocumentoBR | null = null;

  /** Modelos two-way pros inputs editáveis */
  nome = '';
  cpf = '';
  rg = '';
  dataNascimento = '';

  /** Progresso do OCR pra mostrar no spinner (0-100). */
  progressoOcr = 0;

  /**
   * Captura imagem ou PDF do documento. Em mobile nativo (Capacitor),
   * pergunta ao user se quer abrir câmera ou galeria. No web, abre o
   * file picker que aceita IMAGENS (image/*) E PDFs (application/pdf).
   * Se for PDF, a primeira página é renderizada como imagem pra OCR.
   */
  async tirarFoto(): Promise<void> {
    try {
      const arquivo = await this.camera.escolher();
      this.arquivoDataUrl = arquivo;
      this.ehPdf = OcrCameraService.ehPdf(arquivo);

      if (this.ehPdf) {
        // Converte 1ª página do PDF em PNG (mostra estado intermediário
        // pq pode levar 1-2s pra renderizar).
        this.estado = 'processando';
        const png = await pdfParaPrimeiraImagem(arquivo, 2);
        if (!png) {
          throw new Error('PDF sem páginas legíveis.');
        }
        this.imagemDataUrl = png;
      } else {
        this.imagemDataUrl = arquivo;
      }

      this.estado = 'capturado';
    } catch (err) {
      if ((err as Error).message?.includes('cancel')) return; // user cancelou
      console.error('[OcrImport] capturar erro', err);
      await this.toast(
        this.ehPdf
          ? 'Não foi possível ler o PDF. Tente outro arquivo ou foto.'
          : 'Não foi possível abrir a câmera/galeria.',
        'danger',
      );
      this.estado = 'inicial';
    }
  }

  /** Volta pra tirar outra foto / escolher outro arquivo. */
  trocarFoto(): void {
    this.arquivoDataUrl = null;
    this.imagemDataUrl = null;
    this.ehPdf = false;
    this.estado = 'inicial';
  }

  /** Inicia OCR + parsing. */
  async processar(): Promise<void> {
    if (!this.imagemDataUrl) return;
    this.estado = 'processando';
    this.progressoOcr = 0;

    try {
      const texto = await this.ocr.extrair(this.imagemDataUrl, 'por');
      this.dados = parseDocumentoBR(texto);

      // Pré-preenche os modelos
      this.nome = this.dados.nome ?? '';
      this.cpf = this.dados.cpf ?? '';
      this.rg = this.dados.rg ?? '';
      this.dataNascimento = this.dados.dataNascimento ?? '';

      this.estado = 'revisao';

      const confiancaPercent = Math.round(this.dados.confianca * 100);
      if (confiancaPercent < 50) {
        await this.toast(
          `Confiança baixa (${confiancaPercent}%). Revise os campos antes de importar.`,
          'medium',
        );
      }
    } catch (err) {
      console.error('[OcrImport] OCR erro', err);
      await this.toast('Erro ao processar imagem. Tente outra foto.', 'danger');
      this.estado = 'capturado';
    }
  }

  /** Confirma e fecha o modal retornando os campos ao caller. */
  async importar(): Promise<void> {
    if (!this.nome.trim()) {
      await this.toast('Nome é obrigatório.', 'medium');
      return;
    }
    await this.modalCtrl.dismiss({
      saved: true,
      dados: {
        nome: this.nome.trim(),
        cpf: this.cpf.trim() || undefined,
        rg: this.rg.trim() || undefined,
        dataNascimento: this.dataNascimento || undefined,
      },
    });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'top', color });
    await t.present();
  }
}
