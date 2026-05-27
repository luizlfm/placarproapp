import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, ToastController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { Local } from '../../users/models/local.model';
import { UsersService } from '../../users/users.service';

@Component({
  selector: 'app-locais',
  templateUrl: './locais.page.html',
  styleUrls: ['./locais.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class LocaisPage {
  private readonly fb = inject(FormBuilder);
  private readonly usersSrv = inject(UsersService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly locais$: Observable<Local[]> = this.usersSrv.locais$();

  editandoId: string | null = null;
  abrirForm = false;
  salvando = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    endereco: [''],
    cidade: [''],
    capacidade: [null as number | null],
    observacoes: [''],
  });

  novo(): void {
    this.editandoId = null;
    this.form.reset({ nome: '', endereco: '', cidade: '', capacidade: null, observacoes: '' });
    this.abrirForm = true;
  }

  editar(l: Local): void {
    this.editandoId = l.id ?? null;
    this.form.patchValue({
      nome: l.nome,
      endereco: l.endereco ?? '',
      cidade: l.cidade ?? '',
      capacidade: l.capacidade ?? null,
      observacoes: l.observacoes ?? '',
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
      const payload = {
        ...v,
        capacidade: v.capacidade ? Number(v.capacidade) : undefined,
      };
      if (this.editandoId) {
        await this.usersSrv.atualizarLocal(this.editandoId, payload);
      } else {
        await this.usersSrv.criarLocal(payload);
      }
      this.fechar();
    } catch {
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  async remover(l: Local, ev: Event): Promise<void> {
    ev.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Remover local?',
      message: `"${l.nome}" será removido.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: () => this.usersSrv.removerLocal(l.id!),
        },
      ],
    });
    await alert.present();
  }

  trackById(_i: number, l: Local): string {
    return l.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'top', color });
    await t.present();
  }
}
