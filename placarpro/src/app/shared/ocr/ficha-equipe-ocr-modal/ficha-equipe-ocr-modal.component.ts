import { Component, Input, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController } from '@ionic/angular';
import { OcrService } from '../ocr.service';
import { OcrSpaceService } from '../ocr-space.service';
import { OcrCameraService } from '../ocr-camera.service';
import { parseFichaEquipe, FichaEquipe, JogadorFicha } from '../parsers/ficha-equipe-parser';
import { pdfParaPrimeiraImagem } from '../pdf-to-image.util';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { EquipeTecnicaService } from '../../../campeonatos/equipe-tecnica.service';
import { FuncaoTecnica } from '../../../campeonatos/models/membro-tecnico.model';

/**
 * Modal de escaneamento de FICHA DE INSCRIÇÃO de equipe (foto/PDF).
 *
 * Fluxo:
 *   1. User captura/anexa foto ou PDF da ficha preenchida
 *   2. OCR (OCR.space → Tesseract fallback)
 *   3. Parser extrai nome da equipe + lista de jogadores + comissão
 *   4. Preview editável (user pode remover jogadores ruins, ajustar nomes)
 *   5. "Importar" → cria a equipe + cada jogador em bulk
 *
 * Retorna `{ saved: true, equipeId, qtdJogadores }` pro caller atualizar
 * a lista de equipes.
 */
@Component({
  selector: 'app-ficha-equipe-ocr-modal',
  templateUrl: './ficha-equipe-ocr-modal.component.html',
  styleUrls: ['./ficha-equipe-ocr-modal.component.scss'],
  standalone: false,
})
export class FichaEquipeOcrModalComponent {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly ocr = inject(OcrService);
  private readonly ocrCloud = inject(OcrSpaceService);
  private readonly camera = inject(OcrCameraService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly tecnicaSrv = inject(EquipeTecnicaService);

  estado: 'inicial' | 'capturado' | 'processando' | 'revisao' | 'importando' = 'inicial';
  arquivoDataUrl: string | null = null;
  imagemDataUrl: string | null = null;
  ehPdf = false;

  /** Resultado do parser — editável antes do bulk-create. */
  dados: FichaEquipe | null = null;
  /** Modelos two-way pros campos editáveis. */
  nomeEquipe = '';
  /** Jogadores que o user pode editar/remover antes de importar. */
  jogadores: JogadorFicha[] = [];

  /** Comissão técnica editável — 3 funções fixas com nome + documento. */
  tecnico = { nome: '', documento: '' };
  auxiliarTecnico = { nome: '', documento: '' };
  assistente = { nome: '', documento: '' };

  // ──────────────────────────────────────────────────────────────────
  // CAPTURA
  // ──────────────────────────────────────────────────────────────────

  async tirarFoto(): Promise<void> {
    try {
      const arquivo = await this.camera.escolher();
      this.arquivoDataUrl = arquivo;
      this.ehPdf = OcrCameraService.ehPdf(arquivo);

      if (this.ehPdf) {
        this.estado = 'processando';
        const png = await pdfParaPrimeiraImagem(arquivo, 2);
        if (!png) throw new Error('PDF sem páginas legíveis.');
        this.imagemDataUrl = png;
      } else {
        this.imagemDataUrl = arquivo;
      }
      this.estado = 'capturado';
    } catch (err) {
      if ((err as Error).message?.includes('cancel')) return;
      console.error('[FichaOcr] capturar', err);
      await this.toast('Não foi possível abrir a câmera/galeria.', 'danger');
      this.estado = 'inicial';
    }
  }

  trocarFoto(): void {
    this.arquivoDataUrl = null;
    this.imagemDataUrl = null;
    this.ehPdf = false;
    this.estado = 'inicial';
  }

  // ──────────────────────────────────────────────────────────────────
  // PROCESSAMENTO
  // ──────────────────────────────────────────────────────────────────

  async processar(): Promise<void> {
    if (!this.imagemDataUrl) return;
    this.estado = 'processando';
    let texto = '';
    try {
      // Cascata de engines OCR — usa a que retornar MAIS texto.
      // - Engine 3: melhor pra manuscrito + tabelas (TableOCR)
      // - Engine 2: layout-aware pra docs impressos
      // - Engine 5: ML moderno (varia por imagem)
      // - Tesseract: fallback local quando cloud falha
      const tentativas: Array<{ nome: string; fn: () => Promise<string> }> = [
        {
          nome: 'OCR.space Engine 3 (manuscrito/tabela)',
          fn: () => this.ocrCloud.extrair(this.imagemDataUrl!, { lang: 'por', engine: 3, escala: 2000 }),
        },
        {
          nome: 'OCR.space Engine 5 (ML moderno)',
          fn: () => this.ocrCloud.extrair(this.imagemDataUrl!, { lang: 'por', engine: 5, escala: 2000 }),
        },
        {
          nome: 'OCR.space Engine 2 (layout)',
          fn: () => this.ocrCloud.extrair(this.imagemDataUrl!, { lang: 'por', engine: 2 }),
        },
        {
          nome: 'Tesseract.js (local)',
          fn: () => this.ocr.extrair(this.imagemDataUrl!, 'por'),
        },
      ];

      let melhorTexto = '';
      let melhorEngine = '';
      for (const t of tentativas) {
        try {
          const out = await t.fn();
          console.info(`[FichaOcr] ${t.nome}: ${out.length} chars`);
          if (out.length > melhorTexto.length) {
            melhorTexto = out;
            melhorEngine = t.nome;
          }
          // Se achou texto decente (>500 chars), para — não vale tentar todas.
          if (out.length > 500) break;
        } catch (err) {
          console.warn(`[FichaOcr] ${t.nome} falhou`, err);
        }
      }

      texto = melhorTexto;
      if (melhorEngine) console.info(`[FichaOcr] Melhor resultado: ${melhorEngine} (${texto.length} chars)`);

      this.dados = parseFichaEquipe(texto);
      this.nomeEquipe = this.dados.nomeEquipe ?? '';
      this.jogadores = [...this.dados.jogadores];

      // Pré-preenche a comissão técnica (cada um vem como objeto
      // { nome, documento? } do parser).
      this.tecnico = {
        nome: this.dados.tecnico?.nome ?? '',
        documento: this.dados.tecnico?.documento ?? '',
      };
      this.auxiliarTecnico = {
        nome: this.dados.auxiliarTecnico?.nome ?? '',
        documento: this.dados.auxiliarTecnico?.documento ?? '',
      };
      this.assistente = {
        nome: this.dados.assistente?.nome ?? '',
        documento: this.dados.assistente?.documento ?? '',
      };

      this.estado = 'revisao';

      if (this.jogadores.length === 0) {
        await this.toast(
          'Nenhum jogador detectado. Verifique a foto ou edite manualmente.',
          'medium',
        );
      }
    } catch (err) {
      console.error('[FichaOcr] OCR erro', err);
      await this.toast('Erro ao processar imagem.', 'danger');
      this.estado = 'capturado';
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // EDIÇÃO DA LISTA
  // ──────────────────────────────────────────────────────────────────

  removerJogador(idx: number): void {
    this.jogadores.splice(idx, 1);
  }

  adicionarJogadorVazio(): void {
    this.jogadores.push({
      ordem: this.jogadores.length + 1,
      nome: '',
    });
  }

  trackByOrdem(_i: number, j: JogadorFicha): number {
    return j.ordem;
  }

  // ──────────────────────────────────────────────────────────────────
  // BULK CREATE — cria equipe + jogadores
  // ──────────────────────────────────────────────────────────────────

  async importar(): Promise<void> {
    // Padronização: nome de equipe e nome de pessoas (jogadores +
    // comissão) SEMPRE em maiúsculas — convenção do sistema pra
    // consistência visual em listas, súmulas, relatórios.
    const nome = this.nomeEquipe.trim().toUpperCase();
    if (!nome) {
      await this.toast('Nome da equipe é obrigatório.', 'medium');
      return;
    }
    const jogadoresValidos = this.jogadores.filter(j => j.nome.trim().length >= 2);
    if (jogadoresValidos.length === 0 && !confirm('Nenhum jogador válido. Criar equipe sem jogadores?')) {
      return;
    }

    this.estado = 'importando';
    const loader = await this.loadingCtrl.create({
      message: `Criando equipe + ${jogadoresValidos.length} jogadores...`,
      spinner: 'crescent',
    });
    await loader.present();

    try {
      // 1) Cria a equipe — `NovaEquipeInput` só aceita `nome` + opcionais;
      // `campeonatoId`/`categoriaId` são parâmetros separados do `criar()`.
      const equipeId = await this.equipesSrv.criar(
        this.campeonatoId,
        this.categoriaId,
        { nome },
      );

      // 2) Cria cada jogador em série (pra evitar limite de writes
      //    concorrentes do Firestore). 30 jogadores = ~3-5s.
      let criados = 0;
      for (const j of jogadoresValidos) {
        try {
          const documento = (j.documento ?? '').trim();
          await this.jogadoresSrv.criar(
            this.campeonatoId,
            this.categoriaId,
            {
              equipeId,
              // Nome do jogador SEMPRE em maiúsculas (convenção do sistema)
              nome: j.nome.trim().toUpperCase(),
              ...(documento ? { documento, rg: documento } : {}),
              ...(j.dataNascimento ? { dataNascimento: j.dataNascimento } : {}),
            },
          );
          criados++;
        } catch (errJog) {
          console.warn('[FichaOcr] falha ao criar jogador', j.nome, errJog);
        }
      }

      // 3) Cria comissão técnica (técnico + auxiliar + assistente)
      //    via EquipeTecnicaService. Só cria se o nome estiver
      //    preenchido — campos vazios são ignorados.
      const membrosComissao: Array<{ funcao: FuncaoTecnica; dados: { nome: string; documento: string } }> = [
        { funcao: 'tecnico', dados: this.tecnico },
        { funcao: 'auxiliar', dados: this.auxiliarTecnico },
        // "assistente" não é uma FuncaoTecnica válida — mapeia pra 'outro'
        // com funcaoOutro='Assistente' pra preservar o cargo original.
        { funcao: 'outro', dados: this.assistente },
      ];
      let comissaoCriada = 0;
      for (const m of membrosComissao) {
        const nomeM = m.dados.nome.trim().toUpperCase();
        if (!nomeM) continue;
        try {
          const docM = m.dados.documento.trim();
          await this.tecnicaSrv.criar(this.campeonatoId, this.categoriaId, {
            equipeId,
            // Nome SEMPRE em maiúsculas (convenção do sistema)
            nome: nomeM,
            funcao: m.funcao,
            ...(m.funcao === 'outro' ? { funcaoOutro: 'Assistente' } : {}),
            ...(docM ? { documento: docM } : {}),
          });
          comissaoCriada++;
        } catch (errCm) {
          console.warn('[FichaOcr] falha ao criar membro comissão', nomeM, errCm);
        }
      }

      await this.modalCtrl.dismiss({
        saved: true,
        equipeId,
        nome,
        qtdJogadores: criados,
        qtdComissao: comissaoCriada,
      });
      await this.toast(
        `Equipe criada: ${criados} jogador(es) + ${comissaoCriada} membro(s) da comissão.`,
        'success',
      );
    } catch (err) {
      console.error('[FichaOcr] erro ao criar equipe/jogadores', err);
      await this.toast('Erro ao criar equipe.', 'danger');
      this.estado = 'revisao';
    } finally {
      await loader.dismiss();
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }
}
