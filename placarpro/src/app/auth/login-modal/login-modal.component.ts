import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ModalController, ToastController } from '@ionic/angular';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login-modal',
  templateUrl: './login-modal.component.html',
  styleUrls: ['./login-modal.component.scss'],
  standalone: false,
})
export class LoginModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  loading = false;
  loadingGoogle = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(6)]],
  });

  async dismiss(saved = false): Promise<boolean> {
    return this.modalCtrl.dismiss({ saved });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, senha } = this.form.getRawValue();
    this.loading = true;
    try {
      await this.auth.signInWithEmail(email, senha);
      await this.toast('Bem-vindo!', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      await this.toast(this.auth.describeError(err), 'danger');
    } finally {
      this.loading = false;
    }
  }

  async loginGoogle(): Promise<void> {
    this.loadingGoogle = true;
    try {
      await this.auth.signInWithGoogle();
      await this.toast('Bem-vindo!', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code !== 'auth/popup-closed-by-user') {
        await this.toast(this.auth.describeError(err), 'danger');
      }
    } finally {
      this.loadingGoogle = false;
    }
  }

  async criarConta(): Promise<void> {
    await this.modalCtrl.dismiss();
    this.router.navigate(['/cadastro']);
  }

  async esqueciSenha(): Promise<void> {
    await this.modalCtrl.dismiss();
    this.router.navigate(['/recuperar-senha']);
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }
}
