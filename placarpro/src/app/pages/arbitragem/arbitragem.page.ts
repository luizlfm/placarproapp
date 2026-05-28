import { Component, Input, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { Arbitro } from '../../users/models/arbitro.model';
import { UsersService } from '../../users/users.service';

@Component({
  selector: 'app-arbitragem',
  templateUrl: './arbitragem.page.html',
  styleUrls: ['./arbitragem.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ArbitragemPage {
  private readonly fb = inject(FormBuilder);
  private readonly usersSrv = inject(UsersService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);

  /** Quando true, a página foi aberta como modal (em vez de via rota).
   *  Mostra o botão de fechar no header em vez do back-button padrão. */
  @Input() modoModal = false;

  readonly arbitros$: Observable<Arbitro[]> = this.usersSrv.arbitros$();

  editandoId: string | null = null;
  abrirForm = false;
  salvando = false;

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    documento: [''],
    telefone: [''],
    federacao: [''],
  });

  novo(): void {
    this.editandoId = null;
    this.form.reset({ nome: '', documento: '', telefone: '', federacao: '' });
    this.abrirForm = true;
  }

  editar(a: Arbitro): void {
    this.editandoId = a.id ?? null;
    this.form.patchValue({
      nome: a.nome,
      documento: a.documento ?? '',
      telefone: a.telefone ?? '',
      federacao: a.federacao ?? '',
    });
    this.abrirForm = true;
  }

  fechar(): void {
    this.abrirForm = false;
    this.editandoId = null;
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.salvando = true;
    try {
      const v = this.form.getRawValue();
      if (this.editandoId) {
        await this.usersSrv.atualizarArbitro(this.editandoId, v);
      } else {
        await this.usersSrv.criarArbitro(v);
      }
      this.fechar();
    } catch {
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  async remover(a: Arbitro, ev: Event): Promise<void> {
    ev.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Remover árbitro?',
      message: `"${a.nome}" será removido.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: () => this.usersSrv.removerArbitro(a.id!),
        },
      ],
    });
    await alert.present();
  }

  trackById(_i: number, a: Arbitro): string {
    return a.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'top', color });
    await t.present();
  }
}
