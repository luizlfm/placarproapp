import { Component, Input, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Enquete, EnqueteAlternativa } from '../../../../campeonatos/models/enquete.model';
import { EnquetesService } from '../../../../campeonatos/enquetes.service';
import { AuthService } from '../../../../auth/auth.service';

/**
 * Modal de votação acionado pelo botão "Votar" no card da enquete.
 *
 * Diferente do `VotacaoModalComponent` (admin: vê resultados + pode votar),
 * este é focado em participantes do público: mostra só as alternativas
 * pra escolher e confirma. Após votar, fecha sozinho e o card da enquete
 * atualiza pela stream do Firestore.
 */
@Component({
  selector: 'app-votar-modal',
  templateUrl: './votar-modal.component.html',
  styleUrls: ['./votar-modal.component.scss'],
  standalone: false,
})
export class VotarModalComponent {
  @Input() enquete!: Enquete;
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  /** IDs das alternativas já votadas pelo usuário (pra pré-selecionar). */
  @Input() jaVotados: string[] = [];

  private readonly enquetesSrv = inject(EnquetesService);
  private readonly authSrv = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  /** Alternativas selecionadas pelo usuário no modal (antes de confirmar). */
  selecionadas: string[] = [];

  votando = false;

  ngOnInit(): void {
    // Pré-seleciona o que já votou (pra escolha única o set vai sumir
    // quando o usuário clicar em outra opção).
    this.selecionadas = [...(this.jaVotados ?? [])];
  }

  get estaLogado(): boolean {
    return !!this.authSrv.currentUser;
  }

  /** Toggle de seleção respeitando múltipla escolha ou escolha única. */
  toggle(altId: string): void {
    if (this.enquete.multiplaEscolha) {
      this.selecionadas = this.selecionadas.includes(altId)
        ? this.selecionadas.filter(id => id !== altId)
        : [...this.selecionadas, altId];
    } else {
      this.selecionadas = [altId];
    }
  }

  isSelecionada(altId: string): boolean {
    return this.selecionadas.includes(altId);
  }

  /** Confirma o voto. */
  async confirmar(): Promise<void> {
    if (!this.estaLogado) {
      await this.toast('Faça login para votar.', 'danger');
      return;
    }
    if (!this.enquete.votacaoAberta) {
      await this.toast('Votação encerrada.', 'danger');
      return;
    }
    if (this.selecionadas.length === 0) {
      await this.toast('Escolha pelo menos uma alternativa.', 'medium');
      return;
    }
    if (!this.enquete.id) return;

    this.votando = true;
    try {
      await this.enquetesSrv.votar(
        this.campeonatoId,
        this.categoriaId,
        this.enquete.id,
        this.selecionadas,
      );
      await this.toast('Voto registrado!', 'success');
      await this.modalCtrl.dismiss({ voted: true, alternativaIds: this.selecionadas });
    } catch (err) {
      console.error('[VotarModal] votar erro', err);
      const msg = (err as Error)?.message || 'Não foi possível registrar o voto.';
      await this.toast(msg, 'danger');
    } finally {
      this.votando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackByAlt(_i: number, a: EnqueteAlternativa): string {
    return a.id;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
