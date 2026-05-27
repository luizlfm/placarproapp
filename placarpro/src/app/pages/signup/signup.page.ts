import { Component, inject } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { LogsService } from '../../users/logs.service';

/** Valida que os campos `password` e `confirm` são iguais no FormGroup pai. */
function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm')?.value;
  return password === confirm ? null : { passwordMismatch: true };
}

type TipoCadastro = 'organizador' | 'cliente' | 'moderador' | 'racha';
const STORAGE_TIPO_LOGIN = 'placarpro_tipo_login';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class SignupPage {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly usersSrv = inject(UsersService);
  private readonly logsSrv = inject(LogsService);
  private readonly router = inject(Router);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  showPassword = false;
  loading = false;

  /** Tipo de conta sendo criada — só afeta o redirect padrão depois do signup. */
  tipoCadastro: TipoCadastro = this.lerTipoInicial();

  private lerTipoInicial(): TipoCadastro {
    const v = localStorage.getItem(STORAGE_TIPO_LOGIN);
    if (v === 'cliente' || v === 'moderador' || v === 'organizador' || v === 'racha') return v;
    return 'organizador';
  }

  selecionarTipo(t: TipoCadastro): void {
    this.tipoCadastro = t;
    localStorage.setItem(STORAGE_TIPO_LOGIN, t);
  }

  /** Destino padrão pós-signup por tipo.
   *  Organizador → `/app` (sem rota) — o `masterRedirectGuard` redireciona
   *  pro destino correto (admin master cai em `/app/admin`). */
  private get destinoPadrao(): string {
    switch (this.tipoCadastro) {
      case 'cliente':    return '/espectador';
      case 'moderador':  return '/espectador'; // por enquanto reusa /espectador
      case 'racha':      return '/racha';
      case 'organizador':
      default:           return '/app';
    }
  }

  /** Verdadeiro para tipos que exigem código de convite OBRIGATÓRIO no signup.
   *
   *  Política atual:
   *   - `organizador`: SIM, exige código (lista em environment).
   *   - `moderador`:    NÃO mais exige — o user pode se cadastrar sem código
   *     e a conta fica "pendente". O admin master valida via painel
   *     `/app/admin → Detalhes do usuário → Validar moderador`. Quando o
   *     user passa código válido no signup, é autoaprovado (legado).
   *   - `cliente` / `racha`: cadastro livre.
   */
  get exigeCodigoConvite(): boolean {
    // Apenas organizador exige código no signup. Moderador é opcional —
    // sem código vira "pendente de validação" pelo admin master.
    return this.tipoCadastro === 'organizador';
  }

  /** Verdadeiro para tipos que MOSTRAM o campo de código no formulário
   *  (mesmo que opcional). Pra moderador, o campo aparece mas é opcional
   *  — quem souber o código entra direto aprovado. */
  get mostraCodigoConvite(): boolean {
    return this.tipoCadastro === 'organizador' || this.tipoCadastro === 'moderador';
  }

  /** Label do helper text — varia por tipo. */
  get hintCodigoConvite(): string {
    return this.tipoCadastro === 'moderador'
      ? 'Opcional. Com código, sua conta já é validada. Sem código, fica aguardando aprovação do admin.'
      : 'Necessário para criar conta de organizador.';
  }

  readonly form: FormGroup = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirm: ['', [Validators.required]],
      /** Código de convite — obrigatório só quando tipoCadastro === 'organizador'.
       *  Validação ocorre dinamicamente no submit. */
      codigoConvite: [''],
    },
    { validators: passwordMatchValidator },
  );

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, email, password, codigoConvite } = this.form.getRawValue();

    // Política de código de convite:
    //  - ORGANIZADOR: código obrigatório. Sem ele, cadastro rejeitado.
    //  - MODERADOR: código OPCIONAL. Com código válido, conta é autoaprovada
    //    (`moderadorValidado: true`). Sem código, conta vira PENDENTE
    //    (`moderadorValidado: false`) — admin master valida depois.
    //  - CLIENTE / RACHA: sem código, sempre livre.
    let moderadorValidadoNoSignup = false;
    if (this.tipoCadastro === 'organizador') {
      if (!codigoConvite || !codigoConvite.trim()) {
        await this.toast(
          'Informe o código de convite para criar conta como organizador.',
          'danger',
        );
        return;
      }
      if (!this.usersSrv.validarCodigoConvite(codigoConvite, 'organizador')) {
        await this.toast(
          'Código de convite inválido. Solicite ao admin do PlacarPro.',
          'danger',
        );
        return;
      }
    } else if (this.tipoCadastro === 'moderador') {
      // Moderador com código: valida — se válido autoaprova; inválido,
      // só avisa e segue como pendente (não bloqueia o signup).
      if (codigoConvite?.trim()) {
        if (this.usersSrv.validarCodigoConvite(codigoConvite, 'moderador')) {
          moderadorValidadoNoSignup = true;
        } else {
          await this.toast(
            'Código inválido — conta criada, mas aguardará validação do admin.',
            'medium',
          );
        }
      }
    }

    const loader = await this.loadingCtrl.create({ message: 'Criando conta...' });
    await loader.present();
    this.loading = true;
    try {
      await this.auth.signUpWithEmail(email, password, name);
      // Persiste o tipo de conta em users/{uid}.tipo — usado depois pelo
      // login pra validar que o usuário não está tentando entrar como o
      // tipo errado (organizador vs espectador).
      //
      // NOTA: O signup NUNCA promove ninguém a admin master automaticamente.
      // Admin master é controlado por:
      //   1) Hardcoded em environment.adminMasterUids (super-admin permanente)
      //   2) Toggle manual via painel admin (toggleUserIsMaster)
      // Antes, o código de convite `admin-master` virava `isMaster: true`
      // automaticamente, o que vazava o painel admin pra qualquer organizador
      // que conhecesse o código.
      // Grava o perfil em users/{uid}. Pra moderador, inclui o status de
      // validação resolvido acima: autoaprovado (com código) ou pendente.
      const perfilBase: Record<string, unknown> = {
        nome: name,
        email,
        tipo: this.tipoCadastro,
      };
      if (this.tipoCadastro === 'moderador') {
        perfilBase['moderadorValidado'] = moderadorValidadoNoSignup;
      }
      await this.usersSrv.saveProfile(perfilBase);
      // Registra cadastro no log de auditoria (engole erros — não bloqueia)
      void this.logsSrv.registrar(
        'signup',
        `Novo cadastro: ${name} (${email}) como ${this.tipoCadastro}`,
        { email, tipo: this.tipoCadastro },
      );
      await this.toast('Conta criada! Bem-vindo ao PlacarPro.', 'success');
      await this.router.navigateByUrl(this.destinoPadrao);
    } catch (err) {
      await this.toast(this.auth.describeError(err), 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  async loginWithGoogle(): Promise<void> {
    if (!this.codigoConviteValidoSeOrganizador()) return;
    await this.loginWithProvider(() => this.auth.signInWithGoogle());
  }

  async loginWithApple(): Promise<void> {
    if (!this.codigoConviteValidoSeOrganizador()) return;
    await this.loginWithProvider(() => this.auth.signInWithApple());
  }

  /**
   * Validação síncrona antes de abrir OAuth: se o usuário escolheu um tipo
   * que exige código (organizador OU moderador), valida ANTES de redirecionar
   * pro Google/Apple. Senão, alerta e retorna false.
   */
  private codigoConviteValidoSeOrganizador(): boolean {
    if (!this.exigeCodigoConvite) return true;
    const codigo = (this.form.get('codigoConvite')?.value ?? '').trim();
    if (!codigo) {
      void this.toast(
        'Informe o código de convite antes de continuar com Google/Apple.',
        'danger',
      );
      return false;
    }
    if (!this.usersSrv.validarCodigoConvite(codigo, this.tipoCadastro)) {
      void this.toast(
        'Código de convite inválido. Solicite ao admin do PlacarPro.',
        'danger',
      );
      return false;
    }
    return true;
  }

  private async loginWithProvider(provider: () => Promise<unknown>): Promise<void> {
    const loader = await this.loadingCtrl.create({ message: 'Conectando...' });
    await loader.present();
    this.loading = true;
    // Marca pra onde voltar após signInWithRedirect (Safari/iOS)
    this.auth.setPostLoginReturn(this.destinoPadrao);
    try {
      const result = await provider();
      // result===null significa que o login está em redirect — página vai recarregar
      if (result) {
        // Cadastro OAuth: garante o tipo na conta (se já existir doc com
        // outro tipo, mantém — porque é signup, não login com mismatch).
        const uid = this.auth.currentUser?.uid;
        if (uid) {
          try {
            await this.usersSrv.ensureTipo(uid, this.tipoCadastro);
            // Moderador via OAuth: mesma política do email/senha — código
            // OPCIONAL. Com código válido vira validado; sem, fica pendente.
            if (this.tipoCadastro === 'moderador') {
              const codigo = (this.form.get('codigoConvite')?.value ?? '').trim();
              const validado = !!codigo
                && this.usersSrv.validarCodigoConvite(codigo, 'moderador');
              await this.usersSrv.saveProfile({ moderadorValidado: validado });
            }
          } catch (err) {
            console.warn('[Signup] ensureTipo falhou (silencioso)', err);
          }
        }
        await this.router.navigateByUrl(this.destinoPadrao);
      }
    } catch (err) {
      await this.toast(this.auth.describeError(err), 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2800,
      position: 'top',
      color,
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await t.present();
  }
}
