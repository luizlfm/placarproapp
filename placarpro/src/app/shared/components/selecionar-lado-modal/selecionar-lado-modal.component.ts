import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';

/**
 * Modal de seleção de equipe para UM lado (mandante OU visitante).
 * Substitui o AlertController com radios — mostra logo + nome de cada equipe
 * e bloqueia a opção que já é o adversário.
 *
 * Se a partida tem resultado lançado, exibe aviso e pede confirmação extra
 * antes de salvar (zera placar/status/eventos).
 */
@Component({
  selector: 'app-selecionar-lado-modal',
  templateUrl: './selecionar-lado-modal.component.html',
  styleUrls: ['./selecionar-lado-modal.component.scss'],
  standalone: false,
})
export class SelecionarLadoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogo!: Jogo;
  @Input() lado: 'mandante' | 'visitante' = 'mandante';
  @Input() equipes: Equipe[] = [];

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly jogosSrv = inject(JogosService);

  /** Lista ordenada para exibição. */
  equipesOrdenadas: Equipe[] = [];

  /** ID atualmente selecionado no UI (vazio = "Sem equipe"). */
  selecionadoId = '';

  /** ID original — pra detectar se o usuário mudou. */
  idOriginal = '';

  /** ID do adversário (não pode ser escolhido para este lado). */
  adversarioId = '';

  salvando = false;

  ngOnInit(): void {
    if (this.lado === 'mandante') {
      this.idOriginal = this.jogo?.mandanteId ?? '';
      this.adversarioId = this.jogo?.visitanteId ?? '';
    } else {
      this.idOriginal = this.jogo?.visitanteId ?? '';
      this.adversarioId = this.jogo?.mandanteId ?? '';
    }
    this.selecionadoId = this.idOriginal;
    this.equipesOrdenadas = [...this.equipes].sort((a, b) =>
      (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
    );
  }

  get titulo(): string {
    return this.lado === 'mandante' ? 'Selecionar mandante' : 'Selecionar visitante';
  }

  /** Verdadeiro se a partida tem placar ou já foi iniciada/encerrada. */
  get temResultado(): boolean {
    if (!this.jogo) return false;
    return (
      this.jogo.golsMandante != null ||
      this.jogo.golsVisitante != null ||
      this.jogo.status === 'encerrado' ||
      this.jogo.status === 'em-andamento'
    );
  }

  get placarFormatado(): string {
    const m = this.jogo?.golsMandante ?? 0;
    const v = this.jogo?.golsVisitante ?? 0;
    return `${m} × ${v}`;
  }

  /** Verdadeiro se o usuário trocou a equipe atual por outra diferente. */
  get mudou(): boolean {
    return this.selecionadoId !== this.idOriginal;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** Marca a equipe como selecionada (radio). */
  escolher(eq: Equipe | null): void {
    if (eq && eq.id === this.adversarioId) return; // bloqueado
    this.selecionadoId = eq?.id ?? '';
  }

  estaSelecionada(eq: Equipe | null): boolean {
    return this.selecionadoId === (eq?.id ?? '');
  }

  trackById(_i: number, e: Equipe): string {
    return e.id ?? '';
  }

  async salvar(): Promise<void> {
    if (!this.jogo?.id) return;

    // Se não mudou nada, só fecha
    if (!this.mudou) {
      await this.modalCtrl.dismiss();
      return;
    }

    // Se tem resultado E vai alterar, pede confirmação extra
    if (this.temResultado) {
      const ok = await this.confirmarZeragem();
      if (!ok) return;
      await this.aplicarComZeragem();
      return;
    }

    // Caminho normal: só troca a equipe do lado
    this.salvando = true;
    try {
      const patch =
        this.lado === 'mandante'
          ? { mandanteId: this.selecionadoId }
          : { visitanteId: this.selecionadoId };
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id, patch);
      await this.toast('Equipe atualizada.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[SelecionarLado] salvar erro', err);
      await this.toast('Erro ao atualizar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  /** Confirmação extra quando a partida já tem resultado. */
  private async confirmarZeragem(): Promise<boolean> {
    return new Promise<boolean>(async resolve => {
      const alert = await this.alertCtrl.create({
        header: 'Trocar equipe desta partida?',
        message:
          `Esta partida já tem resultado lançado (${this.placarFormatado}).\n\n` +
          `Ao trocar a equipe, serão zerados:\n` +
          `• Placar (gols mandante e visitante)\n` +
          `• Lances registrados (gols, cartões, faltas)\n` +
          `• Status volta para "Agendado"`,
        buttons: [
          { text: 'Cancelar', role: 'cancel', handler: () => resolve(false) },
          {
            text: 'Trocar e zerar',
            role: 'destructive',
            handler: () => resolve(true),
          },
        ],
      });
      await alert.present();
    });
  }

  /** Aplica troca + zera placar/status/eventos. */
  private async aplicarComZeragem(): Promise<void> {
    if (!this.jogo?.id) return;
    this.salvando = true;
    try {
      await this.jogosSrv.limparEventos(
        this.campeonatoId,
        this.categoriaId,
        this.jogo.id,
      );
      const patch =
        this.lado === 'mandante'
          ? {
              mandanteId: this.selecionadoId,
              golsMandante: null,
              golsVisitante: null,
              status: 'agendado' as const,
            }
          : {
              visitanteId: this.selecionadoId,
              golsMandante: null,
              golsVisitante: null,
              status: 'agendado' as const,
            };
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id, patch);
      await this.toast('Equipe trocada. Resultado zerado.', 'success');
      await this.modalCtrl.dismiss({ saved: true, zerado: true });
    } catch (err) {
      console.error('[SelecionarLado] zerar erro', err);
      await this.toast('Erro ao zerar partida.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
