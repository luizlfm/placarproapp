import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  OAuthProvider,
  User,
  authState,
  createUserWithEmailAndPassword,
  getRedirectResult,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { Observable, firstValueFrom } from 'rxjs';

/**
 * AuthService — wrapper único sobre @angular/fire/auth.
 * Todas as chamadas Firebase passam por `runInInjectionContext` para
 * manter o Zone.js feliz (sem warnings de "outside of Injection context")
 * e garantir change detection correto. Ref:
 * https://github.com/angular/angularfire/blob/main/docs/zones.md
 *
 * Estratégia de login OAuth (Google/Apple):
 *  - Desktop (Chrome/Edge/Firefox/Brave): `signInWithPopup` (UX melhor)
 *  - Safari (qualquer plataforma) + iOS + Android in-app browsers:
 *    `signInWithRedirect` (Safari bloqueia popups + 3rd-party cookies, e
 *    Chrome/Android também tem restrições parecidas). O resultado é
 *    capturado por `handleRedirectResult()` ao voltar.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);

  /** Stream do usuário atual (null quando deslogado). */
  readonly user$: Observable<User | null> = runInInjectionContext(
    this.injector,
    () => authState(this.auth),
  );

  /** Snapshot síncrono do usuário (pode ser null). */
  get currentUser(): User | null {
    return this.auth.currentUser;
  }

  /** Aguarda a primeira emissão do authState — útil em guards. */
  waitForAuthInit(): Promise<User | null> {
    return firstValueFrom(this.user$);
  }

  signInWithEmail(email: string, password: string): Promise<User> {
    return this.run(async () => {
      const cred = await signInWithEmailAndPassword(this.auth, email, password);
      return cred.user;
    });
  }

  signUpWithEmail(email: string, password: string, displayName?: string): Promise<User> {
    return this.run(async () => {
      const cred = await createUserWithEmailAndPassword(this.auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
      return cred.user;
    });
  }

  /**
   * Login com Google.
   * Em ambientes onde popup falha (Safari, iOS, in-app browsers), usa redirect.
   * Quando usa redirect: retorna `null` e a página recarrega. O resultado é
   * tratado por `handleRedirectResult()` no boot do app.
   */
  signInWithGoogle(): Promise<User | null> {
    return this.run(async () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return this.oauthSignIn(provider);
    });
  }

  signInWithApple(): Promise<User | null> {
    return this.run(async () => {
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      return this.oauthSignIn(provider);
    });
  }

  /**
   * Implementação compartilhada Google/Apple: escolhe popup vs. redirect.
   *
   * - Em mobile/Safari: vai direto pra `signInWithRedirect` (popup não
   *   funciona confiavelmente).
   * - Em desktop: tenta popup; se falhar com erro de popup bloqueado /
   *   ambiente não suportado, faz fallback pra redirect.
   */
  private async oauthSignIn(
    provider: GoogleAuthProvider | OAuthProvider,
  ): Promise<User | null> {
    const usaRedirect = this.precisaRedirect();
    console.log('[Auth] oauthSignIn estratégia', {
      modo: usaRedirect ? 'redirect' : 'popup',
      ua: navigator.userAgent,
    });
    if (usaRedirect) {
      // Salva pra onde voltar depois do redirect (consumido por handleRedirectResult)
      const returnUrl = sessionStorage.getItem('postLoginReturn') || '/home';
      sessionStorage.setItem('postLoginReturn', returnUrl);
      await signInWithRedirect(this.auth, provider);
      return null; // página vai recarregar
    }
    try {
      const cred = await signInWithPopup(this.auth, provider);
      console.log('[Auth] popup OK', { uid: cred.user.uid });
      return cred.user;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      // Se popup foi bloqueado ou ambiente não suporta, faz fallback p/ redirect
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        try {
          await signInWithRedirect(this.auth, provider);
          return null;
        } catch (redirectErr) {
          throw this.normalizePopupError(redirectErr);
        }
      }
      throw this.normalizePopupError(err);
    }
  }

  /**
   * Detecta navegadores onde popup OAuth não funciona bem.
   *
   * Estratégia conservadora: usa redirect em TUDO que não seja desktop
   * Chrome/Edge/Firefox/Brave clássico. Popup é UX melhor mas frágil:
   * - Mobile (qualquer browser) — popups são bloqueados por padrão
   * - Safari (qualquer plataforma) — ITP bloqueia cookies de 3rd-party
   * - iOS/iPadOS — todo browser usa WebKit por baixo
   * - PWA standalone — popups tendem a abrir no browser externo
   * - In-app browsers (Instagram, FB, WhatsApp) — Google bloqueia OAuth
   *
   * Só usa popup se for desktop Chromium/Gecko comprovado.
   */
  private precisaRedirect(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = navigator.userAgent || '';

    // Mobile/tablet REAL — só pelo User-Agent (sem maxTouchPoints que dá
    // false-positive em desktop com tela touch ou DevTools mobile emulation).
    const ehMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    if (ehMobile) return true;

    // Safari real (desktop ou mobile) — bloqueia popup OAuth.
    // Atenção: Chrome desktop em modo emulação iOS pode ter UA falsa, mas
    // ainda assim suporta popup nativamente, então não cobrimos esse caso aqui.
    const ehSafariReal = /Version\/\d+.*Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|Edg/i.test(ua);
    if (ehSafariReal) return true;

    // PWA standalone — popup vira janela externa
    const ehStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (ehStandalone) return true;

    // In-app browsers conhecidos
    const inApp = /FBAN|FBAV|Instagram|Line|MicroMessenger|Twitter|TikTok|WhatsApp/i.test(ua);
    if (inApp) return true;

    return false;
  }

  /**
   * Captura o resultado do `signInWithRedirect` ao voltar da página do provider.
   * Deve ser chamada UMA VEZ no boot do app (AppComponent ctor).
   *
   * Retorna o User logado, ou null se não havia redirect pendente.
   * O caller é responsável por navegar pro returnUrl.
   */
  async handleRedirectResult(): Promise<{ user: User | null; returnUrl: string }> {
    return this.run(async () => {
      const returnUrl = sessionStorage.getItem('postLoginReturn') || '/home';
      console.log('[Auth] handleRedirectResult start', { returnUrl });
      try {
        const result = await getRedirectResult(this.auth);
        console.log('[Auth] getRedirectResult', {
          hasResult: !!result,
          hasUser: !!result?.user,
          currentUser: !!this.auth.currentUser,
        });
        if (result?.user) {
          sessionStorage.removeItem('postLoginReturn');
          return { user: result.user, returnUrl };
        }
        // Fallback: getRedirectResult pode retornar null mesmo após login
        // bem-sucedido (já consumido em chamada anterior, ou cache). Se
        // o currentUser existe, considera logado.
        if (this.auth.currentUser) {
          sessionStorage.removeItem('postLoginReturn');
          return { user: this.auth.currentUser, returnUrl };
        }
      } catch (err) {
        console.error('[Auth] getRedirectResult erro', err);
      }
      return { user: null, returnUrl };
    });
  }

  /** Marca pra onde redirecionar após o login com redirect retornar. */
  setPostLoginReturn(url: string): void {
    if (url) sessionStorage.setItem('postLoginReturn', url);
  }

  /**
   * Filtra os erros conhecidos de cancelamento/interrupção do popup OAuth
   * (incluindo o bug interno do firebase-auth "Pending promise was never set")
   * e converte para o código padrão `auth/popup-closed-by-user` — que a
   * `describeError()` já trata com mensagem amigável.
   */
  private normalizePopupError(err: unknown): { code: string; message: string } {
    const code = (err as { code?: string })?.code ?? '';
    const msg = (err as { message?: string })?.message ?? '';
    const ehInternoCancelado =
      msg.includes('INTERNAL ASSERTION FAILED: Pending promise was never set') ||
      msg.includes('PopupOperation') ||
      code === 'auth/cancelled-popup-request';
    if (ehInternoCancelado) {
      return { code: 'auth/popup-closed-by-user', message: 'Login cancelado.' };
    }
    return err as { code: string; message: string };
  }

  resetPassword(email: string): Promise<void> {
    return this.run(() => sendPasswordResetEmail(this.auth, email));
  }

  signOut(): Promise<void> {
    // Limpa chaves de sessão/local que podem influenciar o próximo login
    // (tipo do usuário, returnUrl pendente etc.) — evita herdar perfil
    // antigo do navegador. Wrap em try/catch porque storage pode falhar
    // em modo privado / com restrição.
    try {
      localStorage.removeItem('placarpro_tipo_login');
    } catch { /* ignore */ }
    try {
      sessionStorage.removeItem('postLoginReturn');
      sessionStorage.removeItem('placarpro_admin_navegando');
    } catch { /* ignore */ }
    return this.run(() => signOut(this.auth));
  }

  /** Envolve uma chamada Firebase no contexto de injeção do Angular. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    return runInInjectionContext(this.injector, fn);
  }

  /**
   * Traduz códigos de erro do Firebase em mensagens amigáveis em pt-BR.
   * Lista de códigos: https://firebase.google.com/docs/auth/admin/errors
   */
  describeError(err: unknown): string {
    const code = (err as { code?: string })?.code ?? '';
    switch (code) {
      case 'auth/invalid-email':
        return 'E-mail inválido.';
      case 'auth/user-disabled':
        return 'Esta conta foi desativada.';
      case 'auth/user-not-found':
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
        return 'E-mail ou senha incorretos.';
      case 'auth/email-already-in-use':
        return 'Este e-mail já está cadastrado.';
      case 'auth/weak-password':
        return 'A senha deve ter pelo menos 6 caracteres.';
      case 'auth/popup-closed-by-user':
        return 'Login cancelado.';
      case 'auth/network-request-failed':
        return 'Sem conexão. Verifique sua internet.';
      case 'auth/too-many-requests':
        return 'Muitas tentativas. Tente novamente em alguns minutos.';
      case 'auth/configuration-not-found':
        return 'Authentication não está habilitado no projeto Firebase. Ative em Build → Authentication → Get started.';
      case 'auth/account-exists-with-different-credential':
        return 'Esse e-mail já está cadastrado com outro método de login.';
      case 'auth/cancelled-popup-request':
      case 'auth/popup-blocked':
        return 'O popup foi bloqueado pelo navegador. Permita popups e tente de novo.';
      case 'auth/unauthorized-domain':
        return 'Este domínio não está autorizado. Verifique "Authorized domains" no Firebase Console.';
      case 'auth/web-storage-unsupported':
        return 'Habilite cookies/localStorage no navegador pra fazer login.';
      default:
        return 'Não foi possível concluir. Tente novamente.';
    }
  }
}
