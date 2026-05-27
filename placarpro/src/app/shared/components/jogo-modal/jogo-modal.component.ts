import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo, JogoStatus, parseYoutubeVideoId } from '../../../campeonatos/models/jogo.model';
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
    /** URL OU ID do YouTube — converte pra videoId no salvar. */
    youtubeUrl: [''],
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
        youtubeUrl: this.jogoExistente.youtubeVideoId
          ? `https://youtu.be/${this.jogoExistente.youtubeVideoId}`
          : '',
      });
    } else {
      this.form.patchValue({
        fase: this.faseDefault ?? '',
        rodada: this.rodadaDefault ?? null,
      });
    }
  }

  get titulo(): string {
    return this.jogoExistente ? 'Editar jogo' : 'Novo jogo';
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
      // Extrai videoId do link do YouTube (aceita URL completa OU só o ID).
      const youtubeVideoId = parseYoutubeVideoId(v.youtubeUrl);
      const { youtubeUrl: _ignored, ...rest } = v as any;
      const payloadBruto: Record<string, unknown> = {
        ...rest,
        rodada: v.rodada ? Number(v.rodada) : undefined,
        dataHora: dataIso || dataDigitada || undefined,
        youtubeVideoId: youtubeVideoId || undefined,
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
