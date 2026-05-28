import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo, JogoStatus } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';

/**
 * Modal focado SÓ no placar de uma partida existente. Equipes ficam
 * read-only (logo + nome), e o usuário só preenche os gols + escolhe
 * Salvar (mantém status) ou Encerrar (status=encerrado).
 *
 * Para edição de qualquer outro dado da partida (fase, rodada, data,
 * local, equipes, status), use o JogoModalComponent com modo='completo'
 * ou modo='informacoes'.
 */
@Component({
  selector: 'app-editar-resultado-modal',
  templateUrl: './editar-resultado-modal.component.html',
  styleUrls: ['./editar-resultado-modal.component.scss'],
  standalone: false,
})
export class EditarResultadoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() equipes: Equipe[] = [];
  @Input() jogo!: Jogo;

  private readonly fb = inject(FormBuilder);
  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  loading = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    golsMandante: [null as number | null],
    golsVisitante: [null as number | null],
    status: ['agendado' as JogoStatus],
  });

  ngOnInit(): void {
    this.form.patchValue({
      golsMandante: this.jogo.golsMandante ?? null,
      golsVisitante: this.jogo.golsVisitante ?? null,
      status: this.jogo.status ?? 'agendado',
    });
  }

  get mandante(): Equipe | undefined {
    return this.equipes.find(e => e.id === this.jogo.mandanteId);
  }

  get visitante(): Equipe | undefined {
    return this.equipes.find(e => e.id === this.jogo.visitanteId);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    const v = this.form.getRawValue();
    await this.persistir(v.status);
  }

  async encerrar(): Promise<void> {
    const v = this.form.getRawValue();
    if (v.golsMandante == null || v.golsVisitante == null) {
      await this.toast('Informe o placar antes de encerrar.', 'warning');
      return;
    }
    await this.persistir('encerrado');
  }

  private async persistir(novoStatus: JogoStatus): Promise<void> {
    if (!this.jogo.id) return;
    this.loading = true;
    try {
      const v = this.form.getRawValue();
      const patch: Partial<Jogo> = {
        golsMandante: v.golsMandante ?? null,
        golsVisitante: v.golsVisitante ?? null,
        status: novoStatus,
      };
      await this.jogosSrv.atualizar(
        this.campeonatoId,
        this.categoriaId,
        this.jogo.id,
        patch,
      );
      await this.modalCtrl.dismiss({ saved: true });
    } catch {
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  private async toast(message: string, color: 'warning' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }
}
