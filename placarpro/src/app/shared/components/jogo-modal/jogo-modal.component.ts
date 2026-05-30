import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Fase } from '../../../campeonatos/models/fase.model';
import { Jogo, JogoStatus } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';
import {
  dataHoraBrParaIso,
  dataHoraIsoParaBr,
} from '../../directives/mask.directive';

@Component({
  selector: 'app-jogo-modal',
  templateUrl: './jogo-modal.component.html',
  styleUrls: ['./jogo-modal.component.scss'],
  standalone: false,
})
export class JogoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() equipes: Equipe[] = [];
  @Input() jogoExistente?: Jogo;
  /** Fase pré-selecionada ao abrir como novo. */
  @Input() faseDefault?: string;
  /** Rodada pré-selecionada ao abrir como novo. */
  @Input() rodadaDefault?: number;
  /** Lista de fases pra popular o select. Vazio = só fallback (texto). */
  @Input() fases: Fase[] = [];
  /** Lista de jogos existentes — usado pra calcular as rodadas disponíveis
   *  por fase (max rodada existente + 1 pra criar nova). */
  @Input() jogosExistentes: Jogo[] = [];
  /**
   * Modo de operação do modal:
   *  - 'completo'    → todos os campos visíveis (default)
   *  - 'resultado'   → só placar (gols) + botão encerrar/salvar
   *  - 'informacoes' → tudo menos gols/placar (equipes, fase, rodada,
   *                    data, local, status)
   */
  @Input() modo: 'completo' | 'resultado' | 'informacoes' = 'completo';

  get mostrarPlacar(): boolean { return this.modo !== 'informacoes'; }
  get mostrarInformacoes(): boolean { return this.modo !== 'resultado'; }

  private readonly fb = inject(FormBuilder);
  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  loading = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    mandanteId: ['', Validators.required],
    visitanteId: ['', Validators.required],
    fase: [''],
    rodada: [null as number | null],
    dataHora: [''],
    local: [''],
    status: ['agendado' as JogoStatus],
    golsMandante: [null as number | null],
    golsVisitante: [null as number | null],
  });

  ngOnInit(): void {
    if (this.jogoExistente) {
      // Converte dataHora ISO (YYYY-MM-DDTHH:mm) → BR (dd/mm/aaaa hh:mm).
      const dataBr =
        dataHoraIsoParaBr(this.jogoExistente.dataHora) || this.jogoExistente.dataHora || '';
      this.form.patchValue({
        mandanteId: this.jogoExistente.mandanteId,
        visitanteId: this.jogoExistente.visitanteId,
        fase: this.jogoExistente.fase ?? '',
        rodada: this.jogoExistente.rodada ?? null,
        dataHora: dataBr,
        local: this.jogoExistente.local ?? '',
        status: this.jogoExistente.status,
        golsMandante: this.jogoExistente.golsMandante ?? null,
        golsVisitante: this.jogoExistente.golsVisitante ?? null,
      });
    } else {
      this.form.patchValue({
        fase: this.faseDefault ?? '',
        rodada: this.rodadaDefault ?? null,
      });
    }
  }

  get titulo(): string {
    if (!this.jogoExistente) return 'Novo jogo';
    if (this.modo === 'resultado')   return 'Editar resultado';
    if (this.modo === 'informacoes') return 'Editar informações';
    return 'Editar jogo';
  }

  /**
   * Lista de rodadas pra popular o select. Calcula com base nos jogos
   * existentes da fase selecionada: pega max(rodada) e adiciona +1 pra
   * permitir "rodada nova". Sempre tem no mínimo [1..5].
   */
  get rodadasDisponiveis(): number[] {
    const faseAtual = (this.form.value.fase ?? '') as string;
    const jogosFase = this.jogosExistentes.filter(
      j => !faseAtual || !j.fase || j.fase === faseAtual,
    );
    const max = jogosFase.reduce((m, j) => Math.max(m, j.rodada ?? 0), 0);
    const limite = Math.max(max + 1, 5);
    return Array.from({ length: limite }, (_, i) => i + 1);
  }

  get mandanteSelecionado(): Equipe | undefined {
    return this.equipes.find(e => e.id === this.form.value.mandanteId);
  }

  get visitanteSelecionado(): Equipe | undefined {
    return this.equipes.find(e => e.id === this.form.value.visitanteId);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    const v = this.form.getRawValue();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (v.mandanteId === v.visitanteId) {
      await this.toast('Mandante e visitante devem ser diferentes.', 'warning');
      return;
    }
    this.loading = true;
    try {
      // Converte dataHora BR → ISO antes de salvar (se válida).
      const dataDigitada = (v.dataHora as string).trim();
      const dataIso = dataHoraBrParaIso(dataDigitada);
      const payloadBruto: Record<string, unknown> = {
        ...v,
        rodada: v.rodada ? Number(v.rodada) : undefined,
        dataHora: dataIso || dataDigitada || undefined,
      };
      // Firestore não aceita `undefined` — remove keys vazias.
      const payload = Object.fromEntries(
        Object.entries(payloadBruto).filter(([_, v]) => v !== undefined),
      ) as any;
      if (this.jogoExistente?.id) {
        await this.jogosSrv.atualizar(
          this.campeonatoId,
          this.categoriaId,
          this.jogoExistente.id,
          payload,
        );
      } else {
        await this.jogosSrv.criar(this.campeonatoId, this.categoriaId, payload);
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch {
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async encerrar(): Promise<void> {
    const v = this.form.getRawValue();
    if (v.golsMandante == null || v.golsVisitante == null) {
      await this.toast('Informe o placar antes de encerrar.', 'warning');
      return;
    }
    this.form.patchValue({ status: 'encerrado' });
    await this.salvar();
  }

  async remover(): Promise<void> {
    if (!this.jogoExistente?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover jogo?',
      message: 'Esta partida será apagada definitivamente.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.jogosSrv.remover(
                this.campeonatoId,
                this.categoriaId,
                this.jogoExistente!.id!,
              );
              await this.modalCtrl.dismiss({ removed: true });
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }
}
