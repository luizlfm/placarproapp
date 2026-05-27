import { Injectable, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';

/**
 * Evento `beforeinstallprompt` (Android Chrome, Edge desktop, etc).
 * Não está no `lib.dom.d.ts` standard ainda, então defino aqui.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

/**
 * Detecta plataforma + gerencia o convite "Adicionar à Tela Inicial" (PWA).
 *
 * Por que existe:
 *  - Em iOS Safari NÃO existe a API `beforeinstallprompt` — a única forma
 *    de instalar é o usuário tocar manualmente em Compartilhar → Adicionar
 *    à Tela de Início. Sem isso, ZERO fullscreen real (com tabs/URL bar
 *    escondidas) é possível em iOS.
 *  - Em Chrome/Edge Android, o browser dispara `beforeinstallprompt` que
 *    podemos guardar e disparar quando o usuário aceitar.
 *  - O PWA standalone (depois de instalado) elimina tabs/URL bar/etc, e
 *    `display-mode: standalone` retorna `true` no matchMedia.
 *
 * Quando usar:
 *  - Antes de abrir o modal de TRANSMISSÃO ao vivo (fluxo onde fullscreen
 *    real faz mais diferença). Outras telas não precisam tanto.
 *
 * Tracking:
 *  - `localStorage['pwa-install-dismissed']` armazena timestamp da última
 *    recusa — não molestamos o usuário toda hora; respeitamos por 30 dias.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private readonly alertCtrl = inject(AlertController);

  /** Evento guardado pra disparar instalação direta (Android Chrome). */
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** Chave do localStorage com timestamp da última recusa. */
  private static readonly KEY_DISMISSED = 'pwa-install-dismissed';
  /** Tempo (ms) que respeitamos a recusa antes de reabrir o prompt. */
  private static readonly DISMISSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

  constructor() {
    // Captura o evento globalmente assim que o browser disparar.
    // Tem que ser logo no boot pra não perder a janela curta de captura.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', (ev) => {
        ev.preventDefault(); // impede o mini-infobar nativo do Chrome
        this.deferredPrompt = ev as BeforeInstallPromptEvent;
      });
      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        // Já instalou — limpa qualquer flag de "dismissed"
        try { localStorage.removeItem(PwaInstallService.KEY_DISMISSED); } catch { /* ignore */ }
      });
    }
  }

  /** True quando o app está aberto JÁ instalado como PWA standalone. */
  get jaInstalado(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    // Safari iOS expõe `navigator.standalone`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window.navigator as any).standalone === true) return true;
    return false;
  }

  /** True quando é iOS Safari (não suporta beforeinstallprompt). */
  get ehIosSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const ehIos = /iPhone|iPad|iPod/.test(ua);
    const ehSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return ehIos && ehSafari;
  }

  /** True quando o navegador suporta install prompt nativo (Android Chrome). */
  get suportaInstallPromptNativo(): boolean {
    return this.deferredPrompt !== null;
  }

  /** True quando devemos ainda perguntar (não foi dispensado recentemente). */
  private deveImportunar(): boolean {
    try {
      const ts = Number(localStorage.getItem(PwaInstallService.KEY_DISMISSED) || 0);
      if (!ts) return true;
      return Date.now() - ts > PwaInstallService.DISMISSAL_TTL_MS;
    } catch {
      return true;
    }
  }

  /** Marca como dispensado pra não reabrir já-já. */
  private marcarDispensado(): void {
    try {
      localStorage.setItem(PwaInstallService.KEY_DISMISSED, String(Date.now()));
    } catch { /* ignore */ }
  }

  /**
   * Mostra o prompt SE for relevante:
   *  - Já instalado → não mostra.
   *  - Dispensado nos últimos 30d → não mostra.
   *  - iOS Safari → alert com instruções visuais "Compartilhar → Adicionar".
   *  - Android com beforeinstallprompt → dispara prompt nativo do browser.
   *  - Outros → não mostra (sem caminho pra instalar).
   *
   * Retorna `true` se MOSTROU o prompt (independente da escolha), `false`
   * se pulou direto (já instalado / dispensado / não suportado).
   */
  async mostrarPromptSeRelevante(): Promise<boolean> {
    if (this.jaInstalado) return false;
    if (!this.deveImportunar()) return false;

    // 1) Android (e Chrome desktop) — usa o prompt nativo do browser
    if (this.deferredPrompt) {
      const alerta = await this.alertCtrl.create({
        header: '📲 Instalar PlacarPro',
        message:
          'Instale o PlacarPro como aplicativo pra transmitir em tela cheia (sem barras do navegador), com ícone no menu e funcionando offline.',
        buttons: [
          {
            text: 'Agora não',
            role: 'cancel',
            handler: () => { this.marcarDispensado(); },
          },
          {
            text: 'Instalar',
            role: 'confirm',
            handler: () => {
              this.deferredPrompt?.prompt();
              this.deferredPrompt?.userChoice.then(escolha => {
                if (escolha.outcome === 'dismissed') this.marcarDispensado();
                this.deferredPrompt = null;
              });
            },
          },
        ],
      });
      await alerta.present();
      return true;
    }

    // 2) iOS Safari — sem API; mostra tutorial visual
    if (this.ehIosSafari) {
      const alerta = await this.alertCtrl.create({
        header: '📲 Adicionar à Tela de Início',
        message: `
          <p style="margin: 0 0 10px;">
            Pra transmitir em <strong>tela cheia real</strong> (sem barras
            do Safari), adicione o PlacarPro à Tela de Início do iPhone:
          </p>
          <ol style="text-align: left; margin: 0; padding-left: 18px; line-height: 1.6;">
            <li>Toque no botão <strong>Compartilhar</strong> ⤴ (embaixo)</li>
            <li>Role a lista e toque em <strong>"Adicionar à Tela de Início"</strong></li>
            <li>Confirme em "Adicionar"</li>
          </ol>
          <p style="margin: 10px 0 0; font-size: 12px; opacity: 0.7;">
            Depois, abra o ícone do PlacarPro direto da tela inicial — vai
            funcionar como app nativo.
          </p>
        `,
        buttons: [
          {
            text: 'Não mostrar de novo',
            role: 'cancel',
            handler: () => { this.marcarDispensado(); },
          },
          {
            text: 'Entendi',
            role: 'confirm',
            handler: () => { this.marcarDispensado(); },
          },
        ],
      });
      await alerta.present();
      return true;
    }

    return false;
  }
}
