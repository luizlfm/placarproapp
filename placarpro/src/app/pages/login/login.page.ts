import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { AuthService } from '../../auth/auth.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { UsersService } from '../../users/users.service';
import { LogsService } from '../../users/logs.service';
import { AlertService } from '../../shared/alert.service';

/** Mantém sincronizado com `TipoConta` em users/models/user-profile.model.
 *  Se a model adicionar um novo tipo, este alias precisa acompanhar — daí
 *  o uso direto da union em vez de string solta. */
type TipoLogin = 'organizador' | 'cliente' | 'moderador' | 'racha';
const STORAGE_TIPO_LOGIN = 'placarpro_tipo_login';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class LoginPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly campSrv = inject(CampeonatosService);
  private readonly usersSrv = inject(UsersService);
  private readonly logsSrv = inject(LogsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly alerts = inject(AlertService);

  showPassword = false;
  loading = false;
  /** Destino após login. Se houver returnUrl explícito na query, prevalece;
   *  caso contrário usa o destino padrão do tipo selecionado. */
  returnUrl = '';
  /** Indica se a `returnUrl` veio da query string (não pode ser sobrescrita
   *  ao trocar de tipo, senão quebra o redirect pós-login de fluxos como
   *  /inscricao/:token). */
  private returnUrlExplicito = false;

  /** Tipo de login selecionado — só afeta UX e redirect padrão. */
  tipoLogin: TipoLogin = 'organizador';

  readonly form: FormGroup = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  ngOnInit(): void {
    const q = this.route.snapshot.queryParamMap.get('returnUrl');
    if (q) {
      this.returnUrl = q;
      this.returnUrlExplicito = true;
    } else {
      // Restaura escolha anterior do usuário (ou padrão: organizador)
      const saved = localStorage.getItem(STORAGE_TIPO_LOGIN) as TipoLogin | null;
      const tiposValidos: TipoLogin[] = ['organizador', 'cliente', 'moderador', 'racha'];
      this.tipoLogin = saved && tiposValidos.includes(saved) ? saved : 'organizador';
      this.returnUrl = this.destinoPadrao(this.tipoLogin);
    }
  }

  /** Destino padrão por tipo de login.
   *  Pra organizador, navega para `/app` (sem rota específica) — o
   *  `masterRedirectGuard` no shell-routing decide entre `/app/admin`
   *  (se for admin master) ou `/app/meus-campeonatos` (organizador comum).
   *  Antes ia direto pra `/app/meus-campeonatos`, mas isso ignorava o
   *  redirect dinâmico do admin. */
  private destinoPadrao(tipo: TipoLogin): string {
    switch (tipo) {
      case 'cliente':    return '/espectador';
      // Moderador entra no painel `/app`: vê em "Meus campeonatos" todos
      // os campeonatos onde foi adicionado (via `moderadorUids` denormalizado)
      // e tem acesso às seções permitidas pelos guards de permissão.
      case 'moderador':  return '/app';
      case 'racha':      return '/racha';      // área dedicada de peladas
      case 'organizador':
      default:           return '/app';
    }
  }

  /** Usuário clicou em um dos cards de tipo. */
  selecionarTipo(t: TipoLogin): void {
    this.tipoLogin = t;
    localStorage.setItem(STORAGE_TIPO_LOGIN, t);
    if (!this.returnUrlExplicito) {
      this.returnUrl = this.destinoPadrao(t);
    }
  }

  togglePassword(): void {
    this.showPassword = !this.showPassword;
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, password } = this.form.getRawValue();
    const loader = await this.loadingCtrl.create({ message: 'Entrando...' });
    await loader.present();
    this.loading = true;
    /** Garante que o loader é fechado uma única vez, mesmo se chamado
     *  de múltiplos caminhos (try/catch/early-return). */
    let loaderFechado = false;
    const fecharLoader = async () => {
      if (loaderFechado) return;
      loaderFechado = true;
      try { await loader.dismiss(); } catch { /* ignore — já dismissed */ }
    };
    try {
      const user = await this.auth.signInWithEmail(email, password);
      // IMPORTANTE: fechar o loader ANTES de validarTipoOuFalhar, pois
      // este pode abrir um alert (mismatch de tipo) — se o loader ficar
      // ativo, ele aparece por cima do alert e atrapalha o UX.
      await fecharLoader();
      this.loading = false;
      const ok = await this.validarTipoOuFalhar(user.uid);
      if (!ok) return;
      // Registra login no log de auditoria (silencioso)
      void this.logsSrv.registrar(
        'login',
        `Login (email): ${user.email ?? user.uid}`,
        { uid: user.uid, metodo: 'email' },
      );
      const destino = await this.resolverDestinoFinal(user.uid);
      await this.router.navigateByUrl(destino);
    } catch (err) {
      await fecharLoader();
      await this.showError(this.auth.describeError(err));
    } finally {
      this.loading = false;
      // Fallback — se algo deu errado e o loader ainda está aberto, fecha agora
      await fecharLoader();
    }
  }

  async loginWithGoogle(): Promise<void> {
    await this.loginWithProvider(() => this.auth.signInWithGoogle());
  }

  async loginWithApple(): Promise<void> {
    await this.loginWithProvider(() => this.auth.signInWithApple());
  }

  private async loginWithProvider(provider: () => Promise<unknown>): Promise<void> {
    const loader = await this.loadingCtrl.create({ message: 'Conectando...' });
    await loader.present();
    this.loading = true;
    // Salva returnUrl pra ser usado após signInWithRedirect (Safari/iOS)
    this.auth.setPostLoginReturn(this.returnUrl);

    let loaderFechado = false;
    const fecharLoader = async () => {
      if (loaderFechado) return;
      loaderFechado = true;
      try { await loader.dismiss(); } catch { /* ignore */ }
    };

    try {
      const result = await provider();
      console.log('[Login] provider resolveu', {
        result: !!result,
        currentUser: !!this.auth.currentUser,
        returnUrl: this.returnUrl,
      });
      // Se result===null, o login está usando redirect — a página vai recarregar
      // e o AppComponent vai navegar pro returnUrl. Não fazer nada aqui.
      if (result || this.auth.currentUser) {
        // Pequeno delay pra garantir que o authState propagou antes do guard avaliar
        await new Promise(r => setTimeout(r, 100));
        const uid = this.auth.currentUser?.uid;
        if (uid) {
          // IMPORTANTE: fechar o loader ANTES de validarTipoOuFalhar, pra
          // que o alert de mismatch apareça limpo (sem o loader sobreposto).
          await fecharLoader();
          this.loading = false;
          // OAuth via /login: SEMPRE força tipo='cliente' pra contas novas.
          // Organizador/Moderador exigem /signup com código de convite.
          const ok = await this.validarTipoOuFalhar(uid, { forceCliente: true });
          if (!ok) return;
          // Registra login OAuth no log
          void this.logsSrv.registrar(
            'login',
            `Login (OAuth): ${this.auth.currentUser?.email ?? uid}`,
            { uid, metodo: 'oauth' },
          );
          const destino = await this.resolverDestinoFinal(uid);
          await this.router.navigateByUrl(destino);
        } else {
          await this.router.navigateByUrl(this.returnUrl);
        }
      }
    } catch (err) {
      console.error('[Login] erro OAuth', err);
      await fecharLoader();
      await this.showError(this.auth.describeError(err));
    } finally {
      this.loading = false;
      await fecharLoader();
    }
  }

  /**
   * Valida se o tipo selecionado na UI bate com o tipo persistido em
   * `users/{uid}.tipo`. Se houver mismatch, faz signOut, abre um alert
   * descritivo (com botão pra mudar a seleção) e retorna `false`.
   *
   * Em caso de erro de leitura (Firestore offline, regras, etc.) faz o
   * "fail open" — deixa o usuário entrar — e loga no console. Bloquear
   * todo login por uma falha transitória de rede seria pior UX.
   */
  private async validarTipoOuFalhar(
    uid: string,
    opts: { forceCliente?: boolean } = {},
  ): Promise<boolean> {
    try {
      const check = await this.usersSrv.ensureTipo(uid, this.tipoLogin, opts);
      if (check.ok) {
        // Sincroniza localStorage com o tipo real (caso o usuário tenha
        // limpado o storage e a primeira escolha estava certa por sorte).
        localStorage.setItem(STORAGE_TIPO_LOGIN, check.tipoReal);
        return true;
      }
      // MISMATCH: tipo selecionado != tipo da conta. SignOut + alerta.
      await this.auth.signOut();
      // Quando forceCliente está ligado e o usuário tentou um tipo que
      // exige código (organizador OU moderador) mas é cliente, exibimos
      // mensagem específica orientando a usar /cadastro com código.
      const exigeCodigo =
        this.tipoLogin === 'organizador' || this.tipoLogin === 'moderador';
      if (opts.forceCliente && exigeCodigo) {
        await this.mostrarAlertaPrecisaCadastro();
      } else {
        await this.mostrarAlertaTipoIncorreto(check.tipoReal);
      }
      return false;
    } catch (err) {
      console.error('[Login] validarTipo falhou — deixando entrar (fail-open)', err);
      return true;
    }
  }

  /**
   * Mostra alerta quando o usuário tentou logar como organizador via OAuth
   * (Google/Apple) mas a conta é/foi criada como cliente. Orienta a usar
   * o fluxo de cadastro com código de convite.
   *
   * NOTA: usamos `**negrito**` (estilo Markdown) em vez de `<b>` — o
   * `AlertService` converte pra `<strong>` depois de sanitizar o input.
   */
  private async mostrarAlertaPrecisaCadastro(): Promise<void> {
    const label = this.labelTipo(this.tipoLogin);
    const ok = await this.alerts.confirm({
      header: `Cadastro de ${label.toLowerCase()}`,
      message:
        `Para criar uma conta como **${label}**, você precisa se cadastrar ` +
        'em "Criar agora" e informar um **código de convite** válido.\n\n' +
        'Se você é apenas um torcedor, troque para **SOU ESPECTADOR** e ' +
        'entre normalmente.',
      cssClass: 'alert-tipo-conta',
      cancelar: 'Cancelar',
      confirmar: 'Ir pro cadastro',
    });
    if (ok) void this.router.navigate(['/cadastro']);
  }

  /**
   * Alerta amigável quando o usuário selecionou o tipo errado.
   * Inclui botão "Trocar para X" que ajusta a UI sem precisar fazer login
   * de novo do zero.
   */
  private async mostrarAlertaTipoIncorreto(tipoReal: TipoLogin): Promise<void> {
    const tipoRealLabel = this.labelTipo(tipoReal);
    const tipoEscolhidoLabel = this.labelTipo(this.tipoLogin);
    const ok = await this.alerts.confirm({
      header: 'Tipo de conta diferente',
      message:
        `Você selecionou **SOU ${tipoEscolhidoLabel}**, mas esta conta ` +
        `é do tipo **${tipoRealLabel}**.\n\n` +
        `Quer trocar para **SOU ${tipoRealLabel}** e entrar?`,
      cssClass: 'alert-tipo-conta',
      cancelar: 'Cancelar',
      confirmar: `Trocar para ${tipoRealLabel}`,
    });
    if (ok) this.selecionarTipo(tipoReal);
  }

  /** Label legível em CAIXA ALTA pra cada TipoLogin (usado nos alerts). */
  private labelTipo(t: TipoLogin): string {
    switch (t) {
      case 'cliente':    return 'ESPECTADOR';
      case 'moderador':  return 'MODERADOR';
      case 'racha':      return 'RACHA';
      case 'organizador':
      default:           return 'ORGANIZADOR';
    }
  }

  /**
   * Resolve o destino final do redirect pós-login.
   *
   * Lógica:
   *  - Se a `returnUrl` foi explícita (vinda de queryParam, ex: pós /inscricao),
   *    respeita ela e não interfere.
   *  - Se o tipo selecionado é 'moderador' e o usuário modera EXATAMENTE 1
   *    campeonato, abre direto a tela inicial daquele campeonato. Isso evita
   *    o clique extra de "passar por meus-campeonatos pra entrar no único
   *    campeonato que ele administra".
   *  - Se modera múltiplos, deixa o redirect padrão (`/app` → guard manda
   *    pra `/app/meus-campeonatos` onde ele escolhe qual abrir).
   *  - Em qualquer falha, devolve o `returnUrl` original — fail-safe.
   */
  private async resolverDestinoFinal(uid: string): Promise<string> {
    if (this.returnUrlExplicito) return this.returnUrl;
    if (this.tipoLogin !== 'moderador') return this.returnUrl;
    try {
      const camps = await this.campSrv.listOndeSouModeradorOnce(uid);
      if (camps.length === 1 && camps[0].id) {
        return `/app/campeonato/${camps[0].id}/inicio`;
      }
    } catch (err) {
      console.warn('[Login] resolverDestinoFinal falhou', err);
    }
    return this.returnUrl;
  }

  private async showError(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      color: 'danger',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await toast.present();
  }
}
