import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { RachaService } from '../../racha.service';
import { RachaJogador } from '../../models/racha.model';

/**
 * Modal de criação/edição de jogador do racha.
 *
 * Segue o padrão dos modais de `/app/*` (LocaisCadastradosModalComponent
 * e similares): header com Cancelar/Salvar, body com form, footer com
 * ações secundárias (Arquivar/Remover) quando estiver em modo edição.
 *
 * Props:
 *  - `rachaId` (obrigatório)
 *  - `jogador` (opcional) — se passado, abre em modo EDIÇÃO; senão CRIAÇÃO
 *  - `forcaConvidado` (opcional) — quando true, cria como convidado por
 *    padrão (útil quando aberto do tab "Convidados")
 *
 * Dismiss data (via `modalCtrl.dismiss({...})`):
 *  - `{ saved: true }` quando salvou (parent re-fetch desnecessário pois
 *    a lista é stream reativo)
 *  - `undefined` quando cancelou
 */
@Component({
  selector: 'app-jogador-modal',
  templateUrl: './jogador-modal.component.html',
  styleUrls: ['./jogador-modal.component.scss'],
  standalone: false,
})
export class JogadorModalComponent implements OnInit {
  @Input() rachaId = '';
  @Input() jogador?: RachaJogador;
  @Input() forcaConvidado = false;

  private readonly fb = inject(FormBuilder);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly rachaSrv = inject(RachaService);

  /** Form principal. */
  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    apelido: ['', [Validators.maxLength(40)]],
    notaGeral: [null as number | null, [Validators.min(0), Validators.max(10)]],
    telefone: ['', [Validators.maxLength(20)]],
    posicao: [''],
    mensalista: [false],
    convidado: [false],
  });

  salvando = false;
  removendo = false;

  /** Posições disponíveis pro select. */
  readonly posicoes = [
    { value: '',         label: 'Não definida' },
    { value: 'goleiro',  label: 'Goleiro' },
    { value: 'fixo',     label: 'Fixo' },
    { value: 'ala',      label: 'Ala' },
    { value: 'pivo',     label: 'Pivô' },
    { value: 'linha',    label: 'Linha' },
  ];

  ngOnInit(): void {
    if (this.jogador) {
      this.form.patchValue({
        nome: this.jogador.nome ?? '',
        apelido: this.jogador.apelido ?? '',
        notaGeral: this.jogador.notaGeral ?? null,
        telefone: this.jogador.telefone ?? '',
        posicao: this.jogador.posicao ?? '',
        mensalista: !!this.jogador.mensalista,
        convidado: !!this.jogador.convidado,
      });
    } else if (this.forcaConvidado) {
      this.form.patchValue({ convidado: true });
    }
  }

  /** True quando estiver editando (jogador veio do parent). */
  get modoEdicao(): boolean {
    return !!this.jogador?.id;
  }

  // ============== Save / Cancel ==============

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast('Verifique os campos obrigatórios.', 'danger');
      return;
    }
    if (!this.rachaId) return;

    const v = this.form.getRawValue();
    const payload: Partial<RachaJogador> = {
      nome: v.nome.trim(),
      apelido: v.apelido.trim() || undefined,
      notaGeral: v.notaGeral !== null && v.notaGeral !== undefined ? Number(v.notaGeral) : undefined,
      telefone: v.telefone.trim() || undefined,
      posicao: (v.posicao || undefined) as RachaJogador['posicao'],
      mensalista: !!v.mensalista,
      convidado: !!v.convidado,
    };

    this.salvando = true;
    try {
      if (this.modoEdicao && this.jogador?.id) {
        await this.rachaSrv.atualizarJogador(this.rachaId, this.jogador.id, payload);
        this.toast(`"${payload.nome}" atualizado!`, 'success');
      } else {
        await this.rachaSrv.criarJogador(this.rachaId, {
          ...payload,
          nome: payload.nome!,
          ativo: true,
        });
        this.toast(`"${payload.nome}" adicionado!`, 'success');
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[JogadorModal] salvar erro', err);
      this.toast('Falha ao salvar. Tente novamente.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  cancelar(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  // ============== Ações secundárias (só em edição) ==============

  /** Toggle ativo/arquivado — não fecha o modal. */
  async toggleArquivar(): Promise<void> {
    if (!this.jogador?.id) return;
    const novoEstado = this.jogador.ativo === false;
    try {
      await this.rachaSrv.atualizarJogador(this.rachaId, this.jogador.id, {
        ativo: novoEstado,
      });
      this.jogador = { ...this.jogador, ativo: novoEstado };
      this.toast(novoEstado ? 'Jogador reativado.' : 'Jogador arquivado.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[JogadorModal] toggle ativo erro', err);
      this.toast('Falha ao arquivar.', 'danger');
    }
  }

  /** Remove com confirmação. Fecha modal após remover. */
  async remover(): Promise<void> {
    if (!this.jogador?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover jogador?',
      message: `Confirma remover "<b>${this.jogador.nome}</b>"? Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            if (!this.jogador?.id) return;
            this.removendo = true;
            try {
              await this.rachaSrv.removerJogador(this.rachaId, this.jogador.id);
              this.toast('Jogador removido.', 'medium');
              await this.modalCtrl.dismiss({ saved: true, removed: true });
            } catch (err) {
              console.error('[JogadorModal] remover erro', err);
              this.toast('Falha ao remover.', 'danger');
            } finally {
              this.removendo = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ============== Helpers ==============

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
