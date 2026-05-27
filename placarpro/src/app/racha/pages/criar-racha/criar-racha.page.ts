import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { RachaService } from '../../racha.service';

/**
 * Tela "Criar Novo Racha" — form rápido inspirado no FutBora.
 *
 * Campos mínimos:
 *  - Nome do racha (obrigatório, até 50 chars)
 *  - Quantidade de times (default 2)
 *  - Jogadores por time (default 5)
 *
 * Opcional (toggle "Personalizar regras"):
 *  - Local
 *  - Horário recorrente
 *
 * Após criar, redireciona pro wizard de ativação (`/racha/:id/ativar`).
 */
@Component({
  selector: 'app-criar-racha',
  templateUrl: './criar-racha.page.html',
  styleUrls: ['./criar-racha.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class CriarRachaPage {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  loading = false;
  /** Toggle "Personalizar regras" — quando false, esconde os campos extra. */
  personalizarAberto = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
    qtdTimes: [2, [Validators.required, Validators.min(2), Validators.max(8)]],
    jogadoresPorTime: [5, [Validators.required, Validators.min(3), Validators.max(11)]],
    local: [''],
    horario: [''],
  });

  /** Total derivado (qtdTimes × jogadoresPorTime) — exibido em tempo real. */
  get totalJogadores(): number {
    const t = Number(this.form.value.qtdTimes ?? 0);
    const j = Number(this.form.value.jogadoresPorTime ?? 0);
    return t * j;
  }

  /** Contador de chars do nome (estilo FutBora). */
  get nomeLength(): number {
    return (this.form.value.nome ?? '').length;
  }

  togglePersonalizar(): void {
    this.personalizarAberto = !this.personalizarAberto;
  }

  cancelar(): void {
    this.router.navigateByUrl('/racha');
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Verifique os campos obrigatórios.', 'danger');
      return;
    }
    const v = this.form.getRawValue();
    const loader = await this.loadingCtrl.create({ message: 'Criando racha...' });
    await loader.present();
    this.loading = true;
    try {
      const id = await this.rachaSrv.criar({
        nome: v.nome,
        qtdTimes: Number(v.qtdTimes),
        jogadoresPorTime: Number(v.jogadoresPorTime),
        local: v.local,
        horario: v.horario,
      });
      await this.toast('Racha criado! Vamos ativar agora.', 'success');
      // Leva direto pro wizard de ativação
      await this.router.navigate(['/racha', id, 'ativar']);
    } catch (err) {
      console.error('[CriarRacha] erro', err);
      await this.toast('Falha ao criar. Tente novamente.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2500, position: 'top', color,
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await t.present();
  }
}
