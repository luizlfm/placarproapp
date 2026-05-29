import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { ToastController } from '@ionic/angular';
import { filter, distinctUntilChanged, map, pairwise } from 'rxjs/operators';
import { AuthService } from './auth/auth.service';
import { ThemeService } from './shared/theme.service';
import { CampeonatoThemeService } from './shared/campeonato-theme.service';
import { UsersService } from './users/users.service';
import { consumirRedirectPendente, isPwaStandalone } from './shared/utils/pwa.utils';

/** Mirror de `TipoConta` (user-profile.model). */
type TipoLogin = 'organizador' | 'cliente' | 'moderador' | 'racha';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  // Injetar o ThemeService aqui faz o singleton ser construído logo no boot,
  // aplicando o tema salvo (light/dark/system) antes da primeira render.
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private readonly toastCtrl = inject(ToastController);
  private readonly campTheme = inject(CampeonatoThemeService);
  private readonly usersSrv = inject(UsersService);

  constructor() {
    this.silenciarBugIonicAriaChanged();
    this.monitorarAtualizacoes();
    this.aplicarCorDoOrganizador();
    this.aplicarRedirectPosInstalacaoPwa();
    this.validarRotaNoBoot();
    this.escutarMudancasDeAuth();

    // No Safari/iOS, `signInWithGoogle()` usa `signInWithRedirect` por causa
    // do bloqueio de popup + cookies de terceiros (ITP). Ao voltar do provider,
    // a página recarrega e cai aqui — pegamos o resultado e mandamos pro
    // returnUrl que tinha sido salvo antes do redirect.
    this.auth
      .handleRedirectResult()
      .then(({ user, returnUrl }) => {
        console.log('[App] handleRedirectResult done', {
          hasUser: !!user,
          returnUrl,
          urlAtual: this.router.url,
        });
        if (user) {
          // Só redireciona quando o usuário está numa rota de AUTH (/, /login,
          // /cadastro, /recuperar-senha) — essas são as únicas que fazem
          // sentido reagir ao "user logado". Em qualquer outra URL (deep
          // links compartilhados como /luizz/categoria/XXX, /p/slug, etc.)
          // MANTEMOS a navegação atual — o usuário clicou num link e quer
          // ir pra lá, não pra /app ou /espectador.
          //
          // ANTES: a condição extra `destino !== urlAtual` redirecionava
          // SEMPRE que a URL atual diferia do destino padrão — fazendo links
          // compartilhados caírem em /espectador. Bug reportado quando user
          // logado abria /luizz/categoria/XXX e ia parar em /espectador.
          const urlAtual = this.router.url.split('?')[0];
          const rotasPublicas = ['/', '/login', '/cadastro', '/recuperar-senha'];
          if (!rotasPublicas.includes(urlAtual)) return;

          let tipoLogin = 'organizador';
          try {
            tipoLogin = localStorage.getItem('placarpro_tipo_login') ?? 'organizador';
          } catch { /* SSR / privado */ }
          // Pra organizador, vai pra `/app` (sem rota) — o `masterRedirectGuard`
          // decide entre `/app/admin` (admin master) ou `/app/meus-campeonatos`
          // (organizador comum). Cliente vai direto pro espectador.
          const destinoPadrao = tipoLogin === 'cliente' ? '/espectador' : '/app';
          let destino = returnUrl;
          if (!destino || destino === '/login') {
            destino = destinoPadrao;
          }
          this.router.navigateByUrl(destino).then(ok =>
            console.log('[App] navigate done', { destino, tipoLogin, ok }),
          );
        }
      })
      .catch(err => console.error('[App] handleRedirectResult erro', err));
  }

  /**
   * Detecta novas versões publicadas (build novo no Firebase Hosting) e
   * pergunta ao usuário se quer recarregar. Sem isto, o service worker
   * PWA serve o bundle CACHEADO por dias — usuários ficam vendo telas
   * antigas mesmo depois de deploy (caso clássico: tela "Modo Transmissão
   * / ENTRAR EM TELA CHEIA" que já foi removida do código mas continua
   * aparecendo pra quem instalou ou abriu o app antes do deploy).
   *
   * Como funciona:
   *  1. SwUpdate detecta novo `ngsw.json` no servidor (poll a cada 6h
   *     por padrão + checagem no boot).
   *  2. Quando uma nova versão fica pronta (VersionReadyEvent), mostramos
   *     toast "Nova versão disponível — toque pra atualizar".
   *  3. User toca → `activateUpdate()` + `location.reload()` → bundle
   *     novo entra em vigor imediatamente.
   *
   * `optional: true` na injeção porque SwUpdate só está disponível com
   * ServiceWorkerModule ativo (production); em dev o inject retorna null.
   */
  /**
   * Aplica a `corPrimaria` salva no profile do organizador como CSS vars
   * globais — afeta toolbar primary, botões primary etc. em todo o app.
   *
   * Atualizado em tempo real via observable: ao mudar e salvar a cor na
   * Página do Organizador, o `users/{uid}` é re-emitido e a cor é
   * reaplicada sem precisar de F5.
   */
  private aplicarCorDoOrganizador(): void {
    this.usersSrv.profile$().subscribe(p => {
      this.campTheme.setCor(p?.corPrimaria ?? null);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // VALIDAÇÃO DE ROTA POR PERFIL — fluxo global
  // ═══════════════════════════════════════════════════════════════════
  //
  // OBJETIVO: garantir que o usuário SEMPRE veja a tela correta pro
  // perfil dele, em três cenários:
  //   1) F5 (boot) numa rota que não bate com o perfil → redireciona
  //   2) Login via modal numa rota qualquer → redireciona pra área
  //   3) Logout numa rota de área restrita → redireciona pra home
  //
  // PERFIS E SUAS ÁREAS PRINCIPAIS:
  //   - organizador / moderador / admin master → /app/*
  //   - cliente (espectador)                   → /espectador/*
  //   - racha                                  → /racha/*
  //
  // ROTAS IGNORADAS (não dispara redirect):
  //   /, /login, /cadastro, /recuperar-senha  (fluxo de auth)
  // ═══════════════════════════════════════════════════════════════════

  /** Rotas onde nunca interferimos (fluxo de auth tem guards próprios). */
  private readonly rotasAuthIgnoradas = [
    '/login',
    '/cadastro',
    '/recuperar-senha',
  ];

  /** Lê tipo de login persistido no localStorage. */
  private getTipoLogin(): TipoLogin {
    try {
      const v = localStorage.getItem('placarpro_tipo_login');
      if (v === 'cliente' || v === 'moderador' || v === 'racha' || v === 'organizador') {
        return v;
      }
    } catch { /* SSR / privado */ }
    return 'organizador';
  }

  /** Área principal correspondente a cada perfil. */
  private areaPrincipalDoPerfil(tipo: TipoLogin): string {
    if (tipo === 'cliente') return '/espectador';
    if (tipo === 'racha')   return '/racha';
    return '/app'; // organizador, moderador
  }

  /** True se a URL atual já está dentro da área principal do perfil. */
  private rotaPertenceAArea(urlSemQuery: string, area: string): boolean {
    return urlSemQuery === area || urlSemQuery.startsWith(`${area}/`);
  }

  /**
   * Decide se deve redirecionar e pra onde. Lógica única usada tanto
   * no boot (F5) quanto após login modal. Devolve a URL destino ou
   * `null` se não precisar mexer na rota atual.
   */
  private decidirRedirecionamento(urlAtualSemQuery: string): string | null {
    // 1) Anônimo → nada a fazer (guards de rota cuidam).
    if (!this.auth.currentUser) return null;

    // 2) Rota de auth → ignora (redirectIfAuthGuard cuida).
    if (this.rotasAuthIgnoradas.includes(urlAtualSemQuery)) return null;

    // 3) Página de detalhe do JOGO (admin) e TRANSMISSÃO ao vivo:
    //    são rotas que organizador frequentemente abre vindo de um
    //    link compartilhado. NÃO redireciona daqui — quer ver o jogo.
    const rotasDeepLinkPermitidas = [
      '/transmissao/', // /transmissao/:campId/:catId/:jogoId
    ];
    if (rotasDeepLinkPermitidas.some(p => urlAtualSemQuery.startsWith(p))) {
      return null;
    }

    // 4) Compara área principal vs rota atual.
    const tipo = this.getTipoLogin();
    const area = this.areaPrincipalDoPerfil(tipo);
    if (this.rotaPertenceAArea(urlAtualSemQuery, area)) {
      return null; // já está na área certa
    }

    // 5) Rota não bate → redireciona pra área principal.
    return area;
  }

  /**
   * Validação executada no BOOT (F5/abertura inicial). Aguarda o
   * Firebase Auth hidratar (estado persistido em IndexedDB) e depois
   * decide se redireciona.
   */
  private async validarRotaNoBoot(): Promise<void> {
    try {
      // Espera o Firebase Auth terminar a hidratação (caso F5).
      await this.auth.waitForAuthInit();

      // Pequeno delay pra Angular Router terminar a navegação inicial
      // (sem isso, `this.router.url` pode ainda ser '/').
      await new Promise(resolve => setTimeout(resolve, 50));

      const urlAtual = this.router.url.split('?')[0];
      const destino = this.decidirRedirecionamento(urlAtual);
      if (!destino) return;

      console.log('[App] boot — rota não condiz com perfil, redirecionando', {
        de: urlAtual, para: destino,
      });
      await this.router.navigateByUrl(destino, { replaceUrl: true });
    } catch (err) {
      console.warn('[App] validarRotaNoBoot falhou', err);
    }
  }

  /**
   * Escuta mudanças de auth depois do boot:
   *  - null → user: login via modal → redireciona pra área do perfil
   *  - user → null: logout → manda pra `/` (home pública)
   *
   * `pairwise()` só emite a partir da segunda emissão; sem `skip()`
   * desnecessário (bug anterior comia a primeira emissão e nunca
   * disparava o login).
   */
  private escutarMudancasDeAuth(): void {
    this.auth.user$
      .pipe(
        map(u => !!u),
        distinctUntilChanged(),
        pairwise(),
      )
      .subscribe(async ([antes, agora]) => {
        const urlAtual = this.router.url.split('?')[0];

        // ── LOGIN (false → true) ────────────────────────────────────
        if (!antes && agora) {
          const destino = this.decidirRedirecionamento(urlAtual);
          if (!destino) {
            console.log('[App] login detectado — já na área correta', urlAtual);
            return;
          }
          console.log('[App] login detectado — redirecionando pra área', {
            de: urlAtual, para: destino, tipo: this.getTipoLogin(),
          });
          await this.router.navigateByUrl(destino, { replaceUrl: true });
          return;
        }

        // ── LOGOUT (true → false) ───────────────────────────────────
        if (antes && !agora) {
          // Se já está em rota pública (`/`, `/login`, etc.) ou pública de
          // viewer (`/p/`, `/luizz/`, `/transmissao/`), não faz nada.
          const rotasPublicas = ['/login', '/cadastro', '/recuperar-senha'];
          if (urlAtual === '/' || rotasPublicas.includes(urlAtual)) return;

          // Rotas públicas de viewer começam com path do usuário ou
          // prefixos conhecidos. Detectar isso é frágil; manter user
          // numa rota pública após logout é OK (nada a fazer).
          // Já /app/*, /espectador/*, /racha/* precisam sair.
          const areaRestrita =
            urlAtual.startsWith('/app/') || urlAtual === '/app' ||
            urlAtual.startsWith('/espectador') ||
            urlAtual.startsWith('/racha');
          if (!areaRestrita) return;

          console.log('[App] logout detectado — mandando pra home pública', urlAtual);
          await this.router.navigateByUrl('/', { replaceUrl: true });
          return;
        }
      });
  }

  /**
   * Auto-redirect pós-instalação PWA.
   *
   * Fluxo:
   *  1. User está no Safari numa tela (ex: transmissão de um jogo).
   *  2. Abre o modal `IosPwaTutorialModal` — esse modal salva a URL atual
   *     no localStorage (`placarpro_pending_redirect_after_pwa_install`).
   *  3. User instala o app na home screen e abre pelo ícone.
   *  4. O app abre em PWA standalone — Firebase Auth já persistido,
   *     auto-login automático (sem precisar redigitar).
   *  5. Esse método detecta `isPwaStandalone() === true` E tem URL
   *     pendente → navega pra essa URL.
   *
   * Resultado: user clica no ícone do PWA → vai direto pra tela de
   * transmissão em fullscreen real, já logado.
   */
  private aplicarRedirectPosInstalacaoPwa(): void {
    // Só executa em modo PWA standalone — em browser normal a URL
    // pendente fica armazenada esperando o user instalar.
    if (!isPwaStandalone()) return;

    const urlPendente = consumirRedirectPendente();
    if (!urlPendente) return;

    // Aguarda Auth resolver (pode ter tokens em curso de revalidação).
    // O `handleRedirectResult` no constructor já faz parte disso —
    // esperamos 600ms pra estar seguro, depois navegamos.
    setTimeout(() => {
      this.router.navigateByUrl(urlPendente).then(ok => {
        console.log('[App] redirect pós-PWA-install', { urlPendente, ok });
      });
    }, 600);
  }

  private async monitorarAtualizacoes(): Promise<void> {
    if (!this.swUpdate || !this.swUpdate.isEnabled) return;

    // Checa update logo no boot — pega o caso "abriu o app depois do
    // deploy mas o SW ainda não rodou poll automático".
    try { await this.swUpdate.checkForUpdate(); } catch { /* ignore */ }

    // Checagem periódica a cada 60 segundos. Sem isto, o Angular SW só
    // checa updates a cada 6h por padrão — usuários que ficam horas com
    // o app aberto nunca recebem o toast de atualização. 60s é leve (só
    // baixa o `ngsw.json` minúsculo) e garante propagação rápida.
    setInterval(() => {
      this.swUpdate!.checkForUpdate().catch(() => { /* ignore */ });
    }, 60_000);

    // Ao voltar pra aba após ficar em background (ex: o user trocou de
    // app no celular e voltou pro PlacarPro), checa de novo. Cobre o
    // caso clássico: deploy aconteceu enquanto o app estava na bandeja.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.swUpdate!.checkForUpdate().catch(() => { /* ignore */ });
        }
      });
    }

    this.swUpdate.versionUpdates
      .pipe(filter((ev): ev is VersionReadyEvent => ev.type === 'VERSION_READY'))
      .subscribe(async () => {
        const toast = await this.toastCtrl.create({
          message: '✨ Nova versão disponível. Toque pra atualizar.',
          duration: 0, // persistente até user agir
          position: 'top',
          color: 'success',
          buttons: [
            {
              text: 'Atualizar',
              handler: async () => {
                try {
                  await this.swUpdate!.activateUpdate();
                } catch { /* ignore */ }
                window.location.reload();
              },
            },
            { text: 'Depois', role: 'cancel' },
          ],
        });
        await toast.present();
      });
  }

  /**
   * Workaround pra erros conhecidos do Ionic 8 + Angular 20 que poluem o
   * console sem quebrar funcionalidade. Capturamos a exceção via
   * `window.onerror` e descartamos APENAS as mensagens listadas.
   *
   * Erros filtrados:
   *  - "reading 'onAriaChanged'" — race condition na inicialização de
   *    web components durante hot-reload e navegação rápida.
   *  - "ion-ripple-effect#undefined" — chunk loading fail do Ionic
   *    quando um componente clicável (ion-item, ion-button) tenta
   *    instanciar o ripple mas o bundle não está disponível.
   *  - "loadModule" timeouts do Stencil — Ionic carrega web components
   *    sob demanda via chunks; se a rota muda no meio do load, falha.
   *
   * Demais erros continuam fluindo normalmente.
   */
  private silenciarBugIonicAriaChanged(): void {
    if (typeof window === 'undefined') return;
    const padroesIgnorados = [
      "reading 'onAriaChanged'",
      'ion-ripple-effect',
      'Constructor for',
    ];
    const ehErroIgnorado = (msg: unknown): boolean =>
      typeof msg === 'string' && padroesIgnorados.some(p => msg.includes(p));

    window.addEventListener(
      'error',
      ev => {
        const msg = ev?.error?.message ?? ev?.message ?? '';
        if (ehErroIgnorado(msg)) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      },
      true,
    );
    window.addEventListener('unhandledrejection', ev => {
      const msg = ev?.reason?.message ?? '';
      if (ehErroIgnorado(msg)) {
        ev.preventDefault();
      }
    });

    // Angular/Zone logam esses erros direto via `console.error` ANTES de
    // bubblarem como evento `window.error`. Sem patchar o console.error,
    // mensagens tipo `Constructor for "ion-searchbar#undefined" was not
    // found` continuam aparecendo no DevTools mesmo com o listener acima.
    // Mantemos `originalError` pra qualquer outro erro real fluir normal.
    const originalError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      const texto = args
        .map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : ''))
        .join(' ');
      if (ehErroIgnorado(texto)) return;
      originalError(...args);
    };
  }
}
