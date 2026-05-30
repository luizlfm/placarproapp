import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { ModalController, ToastController, AlertController } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { precisaTutorialPwaIos, tutorialPwaJaVisto, marcarTutorialPwaVisto } from '../../utils/pwa.utils';
import { IosPwaTutorialModalComponent } from '../ios-pwa-tutorial-modal/ios-pwa-tutorial-modal.component';
import {
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
} from 'livekit-client';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../../../auth/auth.service';
import { LiveKitService } from '../../livekit/livekit.service';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { PlanosService } from '../../../users/planos.service';
import { INTERVALO_HEARTBEAT_MS } from '../../constants/transmissao.constants';

/**
 * Modal de Transmissão ao Vivo — usado pelo organizador/moderador pra iniciar
 * uma transmissão LiveKit pra um jogo.
 *
 * Estados (`estado`):
 *  - `idle`        — preview da câmera local, ainda não conectou na sala
 *  - `connecting`  — clicou "Iniciar", obtendo token + conectando ao LiveKit
 *  - `live`        — conectado, transmitindo. Mostra contador de viewers.
 *  - `erro`        — alguma falha aconteceu (permissão de câmera, sem rede etc.)
 *
 * Fluxo:
 *  1. ngAfterViewInit → solicita câmera/microfone, mostra preview
 *  2. Usuário clica "INICIAR TRANSMISSÃO"
 *  3. Pede token da Cloud Function (`gerarTokenLiveKit`)
 *  4. `room.connect(url, token)` + publica tracks de áudio/vídeo
 *  5. Cria doc Firestore (`transmissoes/{id}` com `ativa: true`)
 *  6. Mostra contador de viewers conectados na sala
 *  7. Usuário clica "PARAR" → desconecta + encerra doc Firestore
 *
 * IMPORTANTE: O modal precisa de HTTPS pra `getUserMedia()` funcionar.
 * Em dev (localhost) também funciona (exceção da spec). Capacitor (mobile
 * nativo) precisa de permissão de câmera/microfone configurada no manifest.
 */
@Component({
  selector: 'app-transmissao-modal',
  templateUrl: './transmissao-modal.component.html',
  styleUrls: ['./transmissao-modal.component.scss'],
  standalone: false,
})
export class TransmissaoModalComponent implements AfterViewInit, OnDestroy {
  /** Jogo que está sendo transmitido. */
  @Input() jogoId = '';
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  /** Texto descritivo do jogo (ex: "Sport vs Pains") — usado só pra UI. */
  @Input() rotulo = 'Transmissão ao vivo';

  /** Estado do modal — controla o que aparece na UI. */
  estado: 'idle' | 'connecting' | 'live' | 'erro' = 'idle';
  mensagemErro = '';

  /** Contador de viewers conectados — atualizado via eventos do Room. */
  viewersConectados = 0;
  /** Pico de viewers alcançado durante esta sessão. */
  viewersPico = 0;
  /** ID do doc Firestore da transmissão atual (preenchido após iniciar). */
  private transmissaoId?: string;

  /** Tempo desde o início (em segundos). Atualizado por interval enquanto live. */
  duracaoSegundos = 0;
  private duracaoInterval?: ReturnType<typeof setInterval>;
  /**
   * Heartbeat que persiste `duracaoSegundos` no Firestore a cada 30s.
   * Necessário pra Cloud Function de abate de crédito conseguir somar
   * o tempo total do jogo mesmo se o broadcaster cair. Sem isto, ao cair
   * o tempo desta sessão seria perdido.
   */
  private heartbeatInterval?: ReturnType<typeof setInterval>;

  /** Microfone mutado pelo usuário (ainda transmite vídeo). */
  micMutado = false;
  /** Câmera desligada (envia só áudio). */
  cameraDesligada = false;
  /**
   * Câmera atual: 'user' (frontal — selfie) ou 'environment' (traseira).
   * Default 'user' porque é o caso mais comum (transmissão de tribuna,
   * comentarista virado pra própria câmera). Troca via `flipCamera()`
   * substitui o LocalVideoTrack inteiro e republica no Room.
   */
  facingMode: 'user' | 'environment' = 'user';
  /** True enquanto está trocando entre frontal/traseira — bloqueia
   *  cliques duplicados que poderiam criar tracks órfãos. */
  trocandoCamera = false;

  @ViewChild('videoPreview') videoPreviewRef?: ElementRef<HTMLVideoElement>;
  /** Container `.tx-video-wrap` que envolve o vídeo + overlays. É O
   *  elemento que vai pra fullscreen — assim os botões overlay
   *  (INICIAR/girar câmera) ficam visíveis dentro da tela cheia. */
  @ViewChild('videoWrap') videoWrapRef?: ElementRef<HTMLElement>;

  /**
   * Flag de "tela cheia SIMULADA via CSS" — quando true, aplica
   * `position: fixed; inset: 0; z-index: 99999` no `.tx-video-wrap`.
   *
   * Por que existe (além da Fullscreen API real):
   *   - iOS Safari NÃO permite controles HTML custom em fullscreen de
   *     `<video>` (webkitEnterFullscreen vira o player nativo do iOS).
   *   - A Fullscreen API spec do `<html>` exige user-gesture e às vezes
   *     é bloqueada em iframes / PWAs.
   *
   * Solução: simulamos a tela cheia via CSS. Funciona em QUALQUER browser,
   * mantém os botões custom visíveis e suporta `flipCamera`/`iniciar`. */
  modoTelaCheiaSimulada = false;

  // ============ LiveKit state ============
  private room?: Room;
  localVideoTrack?: LocalVideoTrack;
  private localAudioTrack?: LocalAudioTrack;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly authSrv = inject(AuthService);
  private readonly livekit = inject(LiveKitService);
  private readonly transmissoesSrv = inject(TransmissoesService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly planosSrv = inject(PlanosService);
  private readonly router = inject(Router);

  async ngAfterViewInit(): Promise<void> {
    // Pequeno delay pra garantir que o ViewChild `videoPreviewRef` está renderizado.
    setTimeout(() => this.prepararPreview(), 50);

    // ── Auto-tela cheia simulada em iOS Safari não-PWA ──
    // Quando o user abre o modal pelos botões "Transmitir agora" (card)
    // ou pelo FAB "TRANSMITIR" em iOS Safari sem PWA instalado, ATIVA
    // automaticamente o `modoTelaCheiaSimulada` (CSS `position: fixed;
    // inset: 0; z-index: 99999`). Resultado: o vídeo + controles ocupam
    // toda a área HTML possível desde o início, sem o user precisar
    // tocar no botão "expandir".
    // Em PWA standalone OU app Capacitor nativo OU outros browsers
    // (que têm Fullscreen API real), NÃO ativa automaticamente — o
    // modal abre normal e o user pode clicar em expandir se quiser.
    setTimeout(() => {
      if (precisaTutorialPwaIos()) {
        this.modoTelaCheiaSimulada = true;
        this.aplicarHackBodyHeight();
        try {
          window.scrollTo(0, 1);
          requestAnimationFrame(() => window.scrollTo(0, 1));
          setTimeout(() => window.scrollTo(0, 1), 200);
        } catch { /* ignore */ }
      }
    }, 150);

    // ── Auto-fullscreen ao rotacionar pra paisagem ──
    // Em mobile, quando o broadcaster vira o celular pra horizontal, faz
    // sentido ocupar a tela inteira do navegador (some a barra de
    // endereço, abas, tudo) — é o gesto natural pra "modo transmissão".
    // Detecta via matchMedia e dispara `requestFullscreen()` no <html>.
    //
    // ATENÇÃO: `requestFullscreen()` exige user gesture na maioria dos
    // browsers. A rotação SOZINHA pode não bastar — registramos também
    // um listener de `touchstart`/`click` que dispara o fullscreen UMA
    // vez se ainda estamos em landscape e o user tocar na tela.
    if (typeof window !== 'undefined' && window.matchMedia) {
      this._mqlLandscape = window.matchMedia('(orientation: landscape)');
      this._aoMudarOrientacao = (ev: MediaQueryListEvent | MediaQueryList) => {
        // Tanto MediaQueryListEvent quanto MediaQueryList expõem `matches`.
        this.aoMudarOrientacao(!!ev.matches);
      };
      // Suporta browsers modernos (addEventListener) e legacy (addListener)
      if (typeof this._mqlLandscape.addEventListener === 'function') {
        this._mqlLandscape.addEventListener('change', this._aoMudarOrientacao);
      } else if (typeof this._mqlLandscape.addListener === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this._mqlLandscape.addListener(this._aoMudarOrientacao);
      }
      // Estado inicial — modal pode ser aberto já em landscape (tablet)
      this.aoMudarOrientacao(this._mqlLandscape.matches);
    }
  }

  ngOnDestroy(): void {
    this.pararTudo();
    // Limpa o listener de orientação e sai de fullscreen ao fechar modal
    if (this._mqlLandscape && this._aoMudarOrientacao) {
      if (typeof this._mqlLandscape.removeEventListener === 'function') {
        this._mqlLandscape.removeEventListener('change', this._aoMudarOrientacao);
      } else if (typeof this._mqlLandscape.removeListener === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this._mqlLandscape.removeListener(this._aoMudarOrientacao);
      }
    }
    if (this._pendingFullscreenHandler) {
      document.removeEventListener('touchstart', this._pendingFullscreenHandler);
      document.removeEventListener('click', this._pendingFullscreenHandler);
    }
    // Restaura body/html height se estavam em fullscreen simulado.
    this.removerHackBodyHeight();
    // Restaura status bar no Capacitor native (caso o modal feche em FS).
    if (Capacitor.isNativePlatform()) {
      StatusBar.show().catch(() => undefined);
    }
    this.sairFullscreenIgnorandoErro();
  }

  private _mqlLandscape?: MediaQueryList;
  private _aoMudarOrientacao?: (ev: MediaQueryListEvent | MediaQueryList) => void;
  private _pendingFullscreenHandler?: () => void;

  /**
   * Reage à mudança de orientação:
   *  - landscape → tenta fullscreen. Se falhar (sem user gesture),
   *    registra um listener que dispara no próximo touch/click.
   *  - portrait  → sai do fullscreen (volta a barra de URL do browser).
   */
  private async aoMudarOrientacao(ehLandscape: boolean): Promise<void> {
    if (ehLandscape) {
      // SEMPRE ativa a tela cheia SIMULADA via CSS — funciona em iOS
      // Safari (que não permite Fullscreen API real). Cobre todo o
      // conteúdo HTML (header, modal, etc) com `position: fixed; inset: 0`.
      // A barra de URL do Safari pode continuar visível no topo (única
      // forma de esconder é PWA instalado na home screen), mas o vídeo
      // + controles overlay já ocupam toda a área HTML disponível.
      this.modoTelaCheiaSimulada = true;

      // Best-effort: também tenta Fullscreen API real (esconde a barra
      // do browser em Android Chrome / desktop). Em iOS Safari falha,
      // mas o simulado já cobre o conteúdo.
      const ok = await this.entrarFullscreen();
      if (!ok && !this._pendingFullscreenHandler) {
        // Browser exigiu gesture. Aguarda o próximo toque pra tentar.
        this._pendingFullscreenHandler = () => {
          // Se ainda está em landscape, tenta. Caso contrário descarta.
          if (this._mqlLandscape?.matches) {
            this.entrarFullscreen();
          }
          if (this._pendingFullscreenHandler) {
            document.removeEventListener('touchstart', this._pendingFullscreenHandler);
            document.removeEventListener('click', this._pendingFullscreenHandler);
            this._pendingFullscreenHandler = undefined;
          }
        };
        document.addEventListener('touchstart', this._pendingFullscreenHandler, { once: true, passive: true });
        document.addEventListener('click', this._pendingFullscreenHandler, { once: true });
      }
    } else {
      // Portrait — sai do fullscreen (simulado + real) pra UX padrão.
      this.modoTelaCheiaSimulada = false;
      this.sairFullscreenIgnorandoErro();
    }
  }

  /**
   * Acionado pelo botão "Tela cheia" no header do modal.
   *
   * Estratégia em camadas:
   *  1. iOS Safari (iPhone/iPad): `<video>.webkitEnterFullscreen()` é a
   *     única forma de tela cheia REAL — esconde tabs/URL bar do Safari
   *     (que `requestFullscreen` da spec NÃO consegue fazer no iOS).
   *     Custo: vídeo entra no player nativo do iOS, então o broadcaster
   *     temporariamente perde acesso aos botões mute/cam/flip/encerrar.
   *     Pra voltar e usar controles, o user toca "Concluído" no player.
   *  2. Demais browsers: `requestFullscreen()` no `<html>` (oculta
   *     toolbar + tabs do navegador, mantém UI do modal visível).
   */
  /**
   * Entra em tela cheia tentando EM PARALELO todas as técnicas conhecidas
   * pra esconder a barra de URL do iOS Safari:
   *
   *   1. `Element.requestFullscreen()` no wrap (Fullscreen API moderna)
   *   2. `Element.webkitRequestFullscreen()` no wrap (webkit legacy)
   *   3. `requestFullscreen()` no document.body (alternativa)
   *   4. `requestFullscreen()` no document.documentElement (HTML inteiro)
   *   5. Hack do body height (força scroll → iOS oculta URL bar)
   *   6. `screen.orientation.lock('landscape')` (se disponível)
   *   7. Scroll trick (`window.scrollTo(0, 1)`) repetido em RAF
   *   8. CSS simulado (`position: fixed; inset: 0; z-index: 99999`)
   *   9. Force window resize (`window.dispatchEvent(new Event('resize'))`)
   *
   * Pelo menos UMA dessas funcionará no browser/versão do usuário.
   */
  entrarTelaCheia(): void {
    // Toggle: se já está em fullscreen simulado, sai.
    if (this.modoTelaCheiaSimulada) {
      this.modoTelaCheiaSimulada = false;
      this.removerHackBodyHeight();
      this.sairFullscreenIgnorandoErro();
      // Restaura status bar no Capacitor native.
      if (Capacitor.isNativePlatform()) {
        StatusBar.show().catch(() => undefined);
      }
      return;
    }

    // ───── 0) iOS Safari não-PWA: oferece tutorial de install ─────
    // Detecta o ÚNICO cenário onde fullscreen real é IMPOSSÍVEL via APIs
    // web (iOS Safari sem PWA + sem Capacitor native). Em vez de tentar
    // hacks que não funcionam, mostra o tutorial pra instalar como PWA.
    // Depois de instalado, abrir pelo ícone redireciona pra esta tela.
    if (precisaTutorialPwaIos()) {
      this.abrirTutorialPwaIos();
      // Ainda ativa o simulado pra dar feedback visual imediato.
      this.modoTelaCheiaSimulada = true;
      this.aplicarHackBodyHeight();
      try {
        window.scrollTo(0, 1);
        requestAnimationFrame(() => window.scrollTo(0, 1));
      } catch { /* ignore */ }
      return;
    }

    // ───── 1) Fullscreen API SÍNCRONA (várias variantes em paralelo) ─────
    // Tentamos múltiplos elementos pra maximizar chance de pelo menos um
    // funcionar. Todas SÍNCRONAS dentro do user gesture click handler.
    const wrap = this.videoWrapRef?.nativeElement;
    const candidatosFs: HTMLElement[] = [];
    if (wrap) candidatosFs.push(wrap);
    candidatosFs.push(document.body, document.documentElement);

    let pediuFullscreenReal = false;
    for (const el of candidatosFs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyEl = el as any;
      const fn =
        anyEl.requestFullscreen ||
        anyEl.webkitRequestFullscreen ||
        anyEl.webkitRequestFullScreen || // variante antiga do Safari
        anyEl.mozRequestFullScreen ||
        anyEl.msRequestFullscreen;
      if (typeof fn === 'function') {
        try {
          const p = fn.call(el);
          if (p && typeof p.catch === 'function') {
            p.catch((err: unknown) => console.info('[Transmissao] FS rejeitado em', el.tagName, err));
          }
          pediuFullscreenReal = true;
          break; // primeira que aceitou — não tenta as outras
        } catch (err) {
          console.info('[Transmissao] FS erro em', el.tagName, err);
        }
      }
    }

    // ───── 2) CSS simulado (sempre ativa como fallback) ─────
    this.modoTelaCheiaSimulada = true;

    // ───── 3) Body height hack pra esconder URL bar em iOS Safari ─────
    // Esticar body além do viewport faz iOS Safari ENTENDER que a página
    // é "scrollable" e ELE PRÓPRIO esconde a URL bar pra dar mais espaço.
    // Combinado com `scrollTo(0, 1)` força o iOS a entrar em modo
    // "compacto" da barra. SEM essa técnica, scrollTo(0,1) não funciona
    // se o body cabe inteiro no viewport.
    this.aplicarHackBodyHeight();

    // ───── 4) Scroll trick (várias vezes pra garantir) ─────
    try {
      window.scrollTo(0, 1);
      requestAnimationFrame(() => {
        window.scrollTo(0, 1);
        // Mais uma vez após 100ms (alguns iOS resetam scrollTop).
        setTimeout(() => window.scrollTo(0, 1), 100);
        // E novamente após 500ms (caso o layout demore a estabilizar).
        setTimeout(() => window.scrollTo(0, 1), 500);
      });
    } catch { /* ignore */ }

    // ───── 5) Screen orientation lock (só PWA / Android Chrome) ─────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const screenAny = window.screen as any;
    if (screenAny?.orientation?.lock) {
      screenAny.orientation
        .lock('landscape')
        .catch((err: unknown) => console.info('[Transmissao] orientation.lock falhou', err));
    }

    // ───── 6) Force resize event pra reposicionar elementos ─────
    setTimeout(() => {
      try { window.dispatchEvent(new Event('resize')); } catch { /* ignore */ }
    }, 50);

    // ───── 7) Capacitor StatusBar.hide() ─────
    // Quando o app está rodando NATIVO via Capacitor (iOS/Android build),
    // o plugin nativo esconde a status bar real (relógio, notch, bateria).
    // Em browser web (Safari/Chrome) esse plugin não faz nada — cai em
    // `Capacitor.isNativePlatform() === false` e ignora.
    if (Capacitor.isNativePlatform()) {
      StatusBar.hide().catch(err =>
        console.info('[Transmissao] StatusBar.hide falhou', err),
      );
    }

    // ───── 8) iOS PWA detection ─────
    // Se rodando como PWA standalone (app instalado na home screen),
    // a barra do Safari já está escondida — mas o `apple-mobile-web-app-status-bar-style`
    // pode ainda mostrar uma faixa preta no topo. Vamos avisar.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isStandalone = (window.navigator as any).standalone ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches;

    if (!pediuFullscreenReal && !isStandalone && !Capacitor.isNativePlatform()) {
      this.toast(
        'iOS Safari não permite tela cheia REAL em web. Pra esconder a barra, adicione o app à Tela Inicial (Compartilhar → Adicionar à Tela de Início).',
        'warning',
      );
    }
  }

  /** Estado anterior do body pra restaurar quando sai do fullscreen. */
  private _bodyOriginalHeight = '';
  private _bodyOriginalMinHeight = '';
  private _htmlOriginalHeight = '';

  /**
   * Hack iOS Safari: força body/html a ter altura > viewport pra iOS
   * detectar que a página é "scrollable" e esconder a URL bar quando
   * combinamos com `scrollTo(0, 1)`. Sem altura maior, iOS ignora o
   * scrollTo (já está no topo absoluto = não precisa ocultar barra).
   */
  private aplicarHackBodyHeight(): void {
    try {
      this._bodyOriginalHeight = document.body.style.height;
      this._bodyOriginalMinHeight = document.body.style.minHeight;
      this._htmlOriginalHeight = document.documentElement.style.height;
      // Altura maior que viewport força iOS a tratar como scrollable.
      const altura = window.innerHeight + 100;
      document.body.style.minHeight = altura + 'px';
      document.documentElement.style.minHeight = altura + 'px';
    } catch { /* ignore */ }
  }

  /**
   * Abre o modal-tutorial ensinando o user a instalar o app como PWA
   * (iOS Safari "Adicionar à Tela de Início"). O modal salva a URL
   * atual no localStorage — quando o user instalar e abrir pelo ícone
   * PWA, navega direto pra essa rota já logado.
   */
  private async abrirTutorialPwaIos(): Promise<void> {
    // Captura a URL atual incluindo path + query — pra reabrir no PWA.
    const urlAtual = window.location.pathname + window.location.search;
    const modal = await this.modalCtrl.create({
      component: IosPwaTutorialModalComponent,
      componentProps: {
        redirectUrl: urlAtual,
        contextoLabel: 'tela cheia da transmissão',
      },
      backdropDismiss: false,
    });
    await modal.present();
    // Marca que o user viu — não exibimos de novo automaticamente.
    marcarTutorialPwaVisto();
  }

  /**
   * Decide se vale exibir o tutorial PWA antes de o user iniciar a
   * transmissão. Critérios cumulativos:
   *   - Está em iOS Safari não-PWA não-Capacitor (única forma do
   *     fullscreen real não funcionar);
   *   - Ainda NÃO viu o tutorial (`tutorialPwaJaVisto() === false`).
   *
   * Se já viu uma vez, não repete — assume que o user escolheu não
   * instalar e prefere a UX com barra do Safari.
   */
  private async deveExibirTutorialAntesDeIniciar(): Promise<boolean> {
    return precisaTutorialPwaIos() && !tutorialPwaJaVisto();
  }

  /**
   * Exibe o tutorial e AGUARDA o user fechá-lo antes de retornar.
   * Diferente do `abrirTutorialPwaIos()` que não espera — esse usa
   * `onDidDismiss()` pra bloquear o iniciar() até o tutorial sair.
   */
  private async exibirTutorialPwaBloqueante(): Promise<void> {
    const urlAtual = window.location.pathname + window.location.search;
    const modal = await this.modalCtrl.create({
      component: IosPwaTutorialModalComponent,
      componentProps: {
        redirectUrl: urlAtual,
        contextoLabel: 'tela cheia da transmissão',
      },
      backdropDismiss: false,
    });
    await modal.present();
    await modal.onDidDismiss();
    marcarTutorialPwaVisto();
  }

  /** Restaura body height ao sair do fullscreen. */
  private removerHackBodyHeight(): void {
    try {
      document.body.style.height = this._bodyOriginalHeight;
      document.body.style.minHeight = this._bodyOriginalMinHeight;
      document.documentElement.style.height = this._htmlOriginalHeight;
      document.documentElement.style.minHeight = '';
    } catch { /* ignore */ }
  }

  private async entrarFullscreen(): Promise<boolean> {
    try {
      if (document.fullscreenElement) return true;
      // PRIORIZA o container `.tx-video-wrap` (em vez do `<html>` inteiro)
      // pra que os controles overlay (INICIAR TRANSMISSÃO + flip câmera)
      // que estão dentro do wrap sejam exibidos DENTRO do fullscreen.
      // Fallback pra documentElement se o ref não estiver disponível.
      const el = this.videoWrapRef?.nativeElement ?? document.documentElement;
      // Safari iOS usa webkitRequestFullscreen — eslint não conhece
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyEl = el as any;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (anyEl.webkitRequestFullscreen) {
        anyEl.webkitRequestFullscreen();
      } else {
        return false;
      }
      return true;
    } catch (err) {
      // Esperado quando browser exige user gesture
      console.info('[Transmissao] fullscreen adiado — aguardando gesture', err);
      return false;
    }
  }

  private sairFullscreenIgnorandoErro(): void {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
  }

  /**
   * Solicita permissão de câmera/microfone e mostra preview local antes da
   * conexão com o LiveKit. Se o usuário negar, mostra mensagem clara.
   */
  /**
   * Resolução atualmente em uso pelo broadcaster (preenchida após
   * `createLocalVideoTrack` resolver). Usado pra ajustar o bitrate
   * de publish proporcionalmente. Default 4K — se cair pra menor,
   * o `criarVideoTrackComFallback()` atualiza.
   */
  resolucaoAtual: { width: number; height: number } = { width: 3840, height: 2160 };

  /**
   * Tenta criar o video track na MAIOR resolução possível (cascata 4K
   * → 1080p → 720p). Cada tentativa falha silenciosamente se a câmera
   * não suportar; a próxima é tentada. Sempre cai em 720p como último
   * recurso (suportado por qualquer câmera moderna). Se ainda assim
   * falhar, propaga o erro.
   */
  /** Framerate atual capturado pela câmera. Default 60fps — se a câmera
   *  não suportar, cai pra 30 no fallback. */
  framerateAtual = 60;

  /** Label legível da resolução atual ("4K @ 60fps", "1080p @ 30fps", etc).
   *  Usado no chip visual da tela do broadcaster pra mostrar a qualidade
   *  que conseguiu capturar — sem precisar abrir DevTools. */
  get rotuloResolucao(): string {
    const w = this.resolucaoAtual.width;
    const f = this.framerateAtual;
    const res = w >= 3840 ? '4K' : w >= 1920 ? '1080p' : w >= 1280 ? '720p' : `${w}×${this.resolucaoAtual.height}`;
    return `${res}@${f}fps`;
  }

  private async criarVideoTrackComFallback(): Promise<LocalVideoTrack> {
    // Cascata de tentativas — vai do MELHOR pro mais conservador.
    // Tenta SEMPRE 60fps primeiro em cada resolução (iPhone 15 captura
    // 4K@60 nativamente). Se não conseguir 60, tenta 30fps.
    //
    // `comFacingMode = true` força câmera específica (frontal/traseira) —
    // funciona bem em mobile. Em DESKTOP/NOTEBOOK alguns browsers
    // tratam como constraint estrita e dão NotFoundError mesmo tendo
    // webcam → por isso a SEGUNDA passada repete tudo SEM facingMode
    // (deixa o browser escolher qualquer câmera disponível).
    const tentativas: { width: number; height: number; fps: number; rotulo: string }[] = [
      { width: 3840, height: 2160, fps: 60, rotulo: '4K @ 60fps' },
      { width: 3840, height: 2160, fps: 30, rotulo: '4K @ 30fps' },
      { width: 1920, height: 1080, fps: 60, rotulo: '1080p @ 60fps' },
      { width: 1920, height: 1080, fps: 30, rotulo: '1080p @ 30fps' },
      { width: 1280, height: 720,  fps: 60, rotulo: '720p @ 60fps' },
      { width: 1280, height: 720,  fps: 30, rotulo: '720p @ 30fps' },
      { width: 640,  height: 480,  fps: 30, rotulo: '480p @ 30fps' },
    ];

    let ultimoErro: unknown = null;

    // ── 1ª passada: COM facingMode (ideal pra mobile) ──
    for (const t of tentativas) {
      try {
        const track = await createLocalVideoTrack({
          resolution: { width: t.width, height: t.height, frameRate: t.fps },
          facingMode: this.facingMode,
        });
        this.resolucaoAtual = { width: t.width, height: t.height };
        this.framerateAtual = t.fps;
        console.log(`[Transmissao] vídeo capturado em ${t.rotulo} (facingMode=${this.facingMode})`);
        if (t.width !== 3840 || t.fps !== 60) {
          this.toast(
            `Câmera não suporta 4K@60fps — usando ${t.rotulo}.`,
            'success',
          );
        }
        return track;
      } catch (err) {
        console.warn(`[Transmissao] ${t.rotulo} (com facingMode) indisponível`, err);
        ultimoErro = err;
      }
    }

    // ── 2ª passada: SEM facingMode (desktop/webcam fixa) ──
    console.log('[Transmissao] tentativas com facingMode falharam; tentando SEM facingMode (desktop)');
    for (const t of tentativas) {
      try {
        const track = await createLocalVideoTrack({
          resolution: { width: t.width, height: t.height, frameRate: t.fps },
        });
        this.resolucaoAtual = { width: t.width, height: t.height };
        this.framerateAtual = t.fps;
        console.log(`[Transmissao] vídeo capturado em ${t.rotulo} (sem facingMode)`);
        return track;
      } catch (err) {
        console.warn(`[Transmissao] ${t.rotulo} (sem facingMode) indisponível`, err);
        ultimoErro = err;
      }
    }

    // ── 3ª passada (último recurso): SEM CONSTRAINTS NENHUMA ──
    // Deixa o browser escolher a configuração que ele quiser. Webcams
    // antigas / virtuais que rejeitam qualquer width/height/fps específico
    // costumam aceitar quando não tem constraint.
    console.log('[Transmissao] tentando sem qualquer constraint (default browser)');
    try {
      const track = await createLocalVideoTrack();
      this.resolucaoAtual = { width: 1280, height: 720 }; // estimativa
      this.framerateAtual = 30;
      console.log('[Transmissao] vídeo capturado em modo default');
      return track;
    } catch (err) {
      ultimoErro = err;
    }

    throw ultimoErro ?? new Error('Nenhuma câmera disponível.');
  }

  private async prepararPreview(): Promise<void> {
    if (this.livekit.naoConfigurado) {
      this.estado = 'erro';
      this.mensagemErro = 'LiveKit ainda não foi configurado pelo administrador. ' +
        'Configure a URL em environment.livekit.url e os secrets nas Cloud Functions.';
      this.cdr.detectChanges();
      return;
    }

    try {
      // Cria tracks locais (NÃO publica ainda — só pra preview).
      //
      // Resolução: tenta 4K (3840×2160) PRIMEIRO. Se a câmera não
      // suportar, faz FALLBACK automático pra 1080p e depois 720p.
      // 4K só é entregue se a câmera do device + browser conseguirem
      // capturar nessa resolução (iPhones modernos sim, Androids
      // top-de-linha sim, Androids antigos provavelmente não).
      //
      // Bitrate (configurado no publishDefaults abaixo) é ajustado
      // proporcionalmente: 4K precisa de ~6Mbps, 1080p ~3Mbps.
      this.localVideoTrack = await this.criarVideoTrackComFallback();
      this.localAudioTrack = await createLocalAudioTrack({
        noiseSuppression: true,
        echoCancellation: true,
      });

      // Liga o track ao <video> preview
      if (this.videoPreviewRef?.nativeElement && this.localVideoTrack) {
        this.localVideoTrack.attach(this.videoPreviewRef.nativeElement);
      }
      this.estado = 'idle';
      this.cdr.detectChanges();
    } catch (err: unknown) {
      console.error('[Transmissao] erro ao obter câmera/microfone', err);
      this.estado = 'erro';
      const msg = (err instanceof Error) ? err.message : String(err);
      const lower = msg.toLowerCase();

      // Detecta acesso por HTTP (não-HTTPS): getUserMedia é bloqueado
      // fora de localhost/HTTPS. Mensagem específica é mais útil que
      // o NotFoundError genérico que o browser retorna nesse caso.
      const ehSeguro = typeof window !== 'undefined' && (
        window.isSecureContext ||
        location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1'
      );
      if (!ehSeguro) {
        this.mensagemErro =
          'Câmera bloqueada: o site precisa ser HTTPS pra acessar câmera/microfone. ' +
          'Use placarproapp.com em vez do IP.';
      } else if (lower.includes('permission') || lower.includes('denied') || lower.includes('notallowed')) {
        this.mensagemErro =
          'Permissão de câmera/microfone NEGADA. Clique no cadeado/info do navegador ' +
          'na barra de endereço e libere "Câmera" e "Microfone" pra este site.';
      } else if (lower.includes('notfound') || lower.includes('devicesnotfound')) {
        this.mensagemErro =
          'Nenhuma câmera/microfone detectado. Verifique se a webcam está conectada ' +
          'e se outros apps (Zoom/Meet) não estão usando ela.';
      } else if (lower.includes('notreadable') || lower.includes('inuse') || lower.includes('trackstart')) {
        this.mensagemErro =
          'Câmera em uso por outro app (Zoom, Meet, Teams, OBS, etc). Feche os outros e tente novamente.';
      } else if (lower.includes('overconstrained')) {
        this.mensagemErro =
          'Câmera não suporta as resoluções tentadas. Atualize o navegador ou troque a webcam.';
      } else {
        this.mensagemErro = 'Falha ao acessar câmera/microfone: ' + msg;
      }
      this.cdr.detectChanges();
    }
  }

  /**
   * Gate de crédito antes de iniciar: garante que há tempo/crédito de
   * transmissão. Reserva (debita) no momento real do início. Retorna false
   * (e avisa/oferece comprar) quando não há crédito — bloqueando o início.
   */
  private async garantirCreditoTransmissao(): Promise<boolean> {
    let ownerId = '';
    try {
      const camp = await firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId));
      ownerId = camp?.ownerId ?? '';
    } catch {
      /* sem owner conhecido — não bloqueia (best-effort) */
    }
    if (!ownerId) return true;

    const meuUid = this.authSrv.currentUser?.uid ?? null;
    const limiteMin = this.planosSrv.transmissaoDuracaoMin;
    const r = await this.transmissoesSrv.garantirTempoParaIniciar(
      this.campeonatoId, this.categoriaId, this.jogoId, ownerId, meuUid, limiteMin,
    );
    if (r === 'ok') return true;

    if (r === 'sem-creditos') {
      const alert = await this.alertCtrl.create({
        header: 'Sem créditos de transmissão',
        message:
          `Você precisa de um crédito de transmissão pra transmitir ` +
          `(cada crédito libera ${limiteMin} min). Deseja comprar agora?`,
        buttons: [
          { text: 'Agora não', role: 'cancel' },
          {
            text: 'Comprar créditos',
            handler: () => {
              void this.modalCtrl.dismiss();
              void this.router.navigate(['/app/meus-creditos']);
            },
          },
        ],
      });
      await alert.present();
    } else {
      this.toast('Não foi possível validar o crédito de transmissão.', 'danger');
    }
    return false;
  }

  /**
   * Inicia a transmissão:
   *  - Obtém token JWT da Cloud Function (server valida permissão).
   *  - Conecta no Room do LiveKit.
   *  - Publica os tracks locais (câmera + microfone).
   *  - Cria doc Firestore `transmissoes/{id}`.
   */
  async iniciar(): Promise<void> {
    if (this.estado !== 'idle') return;
    if (!this.localVideoTrack || !this.localAudioTrack) {
      this.toast('Preview da câmera ainda não está pronto.', 'warning');
      return;
    }

    // Tutorial PWA removido daqui — o modal já abre em tela cheia
    // simulada automaticamente no `ngAfterViewInit` quando detecta iOS
    // Safari, então o user já tem a UX correta sem ser interrompido
    // antes de transmitir.

    // ── GATE DE CRÉDITO ──
    // Transmitir EXIGE crédito de transmissão. Aqui é o momento REAL do
    // início (chokepoint de todos os caminhos): se não há tempo já pago,
    // reserva +1 bloco (debita 1 crédito do dono). Sem crédito → bloqueia
    // e oferece comprar. Feito ANTES de ligar a câmera/conectar.
    const creditoOk = await this.garantirCreditoTransmissao();
    if (!creditoOk) return;

    this.estado = 'connecting';
    this.cdr.detectChanges();

    try {
      // 1) Pede token do servidor (valida permissão lá).
      const { token, roomName } = await this.livekit.gerarToken({
        jogoId: this.jogoId,
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        papel: 'broadcaster',
      });

      // 2) Cria Room + conecta.
      //
      // ═══ BALANCEADO: QUALIDADE + BAIXA LATÊNCIA ═══
      // Bitrate em nível "broadcasting decente" (entre o profissional de
      // 20 Mbps que era pesado demais e os 8 Mbps que ficaram embaçados):
      //   - 4K @ 60fps:   14 Mbps (sweet spot — nítido sem saturar upload)
      //   - 4K @ 30fps:   10 Mbps
      //   - 1080p @ 60:   7 Mbps
      //   - 1080p @ 30:   5 Mbps
      //   - 720p @ 60:    3.5 Mbps
      //   - 720p @ 30:    2.5 Mbps
      //
      // O que mantém latência baixa é DESLIGAR adaptive/dynacast (não o
      // bitrate reduzido). Bitrate alto NÃO causa delay sozinho — o que
      // causa é o servidor adaptando qualidade pra cada viewer (dynacast)
      // ou o encoder ficando esperando feedback (adaptive).
      const w = this.resolucaoAtual.width;
      const f = this.framerateAtual;
      const bitrate =
        w >= 3840 ? (f >= 60 ? 14_000_000 : 10_000_000)
        : w >= 1920 ? (f >= 60 ? 7_000_000 : 5_000_000)
        : (f >= 60 ? 3_500_000 : 2_500_000);

      this.room = new Room({
        // Volta pros defaults SEGUROS — mexer em adaptive/dynacast/codec
        // pode causar incompatibilidade com viewers conectando.
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          videoEncoding: {
            maxBitrate: bitrate,
            maxFramerate: f,
            priority: 'high',
          },
          audioPreset: { maxBitrate: 192_000 },
          simulcast: true,
          degradationPreference: 'maintain-resolution',
          // Sem forçar codec — deixa o browser escolher o melhor.
        },
      });

      // Listeners ANTES do connect — pra pegar evento de "viewers entrando"
      this.room.on(RoomEvent.ParticipantConnected, () => this.atualizarViewers());
      this.room.on(RoomEvent.ParticipantDisconnected, () => this.atualizarViewers());
      this.room.on(RoomEvent.Disconnected, () => {
        if (this.estado === 'live') {
          // Disconnect inesperado (queda de rede, server reiniciou).
          this.toast('Conexão perdida. Tentando reconectar...', 'warning');
        }
      });

      await this.room.connect(this.livekit.url, token);

      // 3) Publica os tracks (câmera + microfone).
      await this.room.localParticipant.publishTrack(this.localVideoTrack, {
        source: Track.Source.Camera,
        simulcast: true,
      });
      await this.room.localParticipant.publishTrack(this.localAudioTrack, {
        source: Track.Source.Microphone,
      });

      // 4) Cria doc Firestore — outros viewers descobrem por aqui.
      const user = this.authSrv.currentUser;
      const broadcasterNome = user?.displayName || user?.email || 'Transmissão';

      // Busca o ownerId do campeonato (denormalizamos no doc da transmissão
      // pra Cloud Function de abate de crédito não precisar fazer get extra
      // a cada heartbeat). Best-effort — se falhar, segue sem ownerId e o
      // crédito não é descontado automaticamente (admin master corrige).
      let ownerId = '';
      try {
        const camp = await firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId));
        ownerId = camp?.ownerId ?? '';
      } catch (err) {
        console.warn('[Transmissao] não conseguiu buscar ownerId do campeonato', err);
      }

      this.transmissaoId = await this.transmissoesSrv.iniciar({
        jogoId: this.jogoId,
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        roomName,
        broadcasterUid: user?.uid || '',
        broadcasterNome,
        ownerId,
      });

      // 5) Inicia contador de duração
      this.duracaoSegundos = 0;
      this.duracaoInterval = setInterval(() => {
        this.duracaoSegundos++;
        this.cdr.detectChanges();
      }, 1000);

      // 6) Inicia heartbeat — persiste `duracaoSegundos` no Firestore a
      // cada 30s. Permite à Cloud Function somar tempo total da partida
      // (incluindo sessões anteriores em caso de queda+reconexão) e
      // decidir quando descontar 1 crédito do owner (ver Cloud Function
      // `onTransmissaoHeartbeat`).
      this.heartbeatInterval = setInterval(() => {
        if (this.transmissaoId && this.estado === 'live') {
          void this.transmissoesSrv.atualizarHeartbeat(
            this.campeonatoId,
            this.categoriaId,
            this.jogoId,
            this.transmissaoId,
            this.duracaoSegundos,
          );
        }
      }, INTERVALO_HEARTBEAT_MS);

      this.estado = 'live';
      this.atualizarViewers();
      this.cdr.detectChanges();
      this.toast('🔴 Transmissão iniciada! Espectadores veem ao vivo.', 'success');
      // ⚠️ NÃO fechamos o modal automaticamente — fechar destruiria os
      // tracks de câmera/mic (estão referenciados aqui no componente),
      // encerrando o broadcast prematuramente. O broadcaster usa os
      // controles no próprio modal (mute/cam/stop). Pra ver o scoreboard
      // ao mesmo tempo, ele pode abrir outra aba/dispositivo na URL pública.
    } catch (err: unknown) {
      console.error('[Transmissao] erro ao iniciar', err);
      // Log COMPLETO em alert pra debugar em mobile (sem DevTools).
      // Mostra: code, message, details, name, stack truncado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      const debug = {
        code: e?.code,
        message: e?.message,
        details: e?.details,
        name: e?.name,
        type: typeof err,
      };
      console.error('[Transmissao] erro DEBUG completo:', JSON.stringify(debug));

      this.estado = 'erro';
      const msg = (err instanceof Error) ? err.message : String(err);
      const code = e?.code as string | undefined;

      if (msg === 'internal' || code === 'internal' || code === 'functions/internal') {
        // Mensagem expandida com possíveis causas + details (se existir).
        const detalheExtra = e?.details ? ` (detalhe: ${JSON.stringify(e.details)})` : '';
        this.mensagemErro =
          'Erro interno servidor (code: internal)' + detalheExtra + '. ' +
          'Possíveis causas: (1) LiveKit API keys não configuradas, ' +
          '(2) Cloud Function com bug, (3) timeout LiveKit Cloud. ' +
          'Verifique logs via "firebase functions:log --only gerarTokenLiveKit".';
      } else if (code === 'unauthenticated' || code === 'functions/unauthenticated') {
        this.mensagemErro = 'Login expirado. Faça logout e login de novo.';
      } else if (code === 'permission-denied' || code === 'functions/permission-denied') {
        this.mensagemErro = 'Sem permissão pra transmitir este jogo.';
      } else if (code === 'unavailable' || code === 'functions/unavailable' || msg.toLowerCase().includes('network')) {
        this.mensagemErro = 'Servidor temporariamente indisponível. Tente novamente.';
      } else if (msg.toLowerCase().includes('not configured') || msg.toLowerCase().includes('livekit')) {
        this.mensagemErro = 'LiveKit não configurado. Contate admin.';
      } else {
        this.mensagemErro = `Erro: ${msg || code || 'desconhecido'}`;
      }
      this.cdr.detectChanges();
    }
  }

  /**
   * Encerra a transmissão — confirma com o usuário antes pra evitar acidente.
   * Desconecta do LiveKit + marca doc Firestore como `ativa: false`.
   */
  async pararComConfirmacao(): Promise<void> {
    if (this.estado !== 'live') return;
    const alert = await this.alertCtrl.create({
      header: 'Encerrar transmissão?',
      message: 'Os espectadores serão desconectados imediatamente. Você pode iniciar uma nova depois.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Encerrar',
          role: 'destructive',
          handler: () => this.parar(),
        },
      ],
    });
    await alert.present();
  }

  private async parar(): Promise<void> {
    if (this.duracaoInterval) {
      clearInterval(this.duracaoInterval);
      this.duracaoInterval = undefined;
    }
    // Para o heartbeat ANTES de encerrar pra não fazer write conflitante
    // com o updateDoc final do `encerrar()`.
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // Snapshot da duração final ANTES de zerar — passa pro encerrar()
    // pra registrar o tempo total desta sessão (usado pela Cloud Function
    // pra somar com sessões anteriores e decidir abate de crédito).
    const duracaoFinal = this.duracaoSegundos;

    // Desconecta do LiveKit
    try {
      await this.room?.disconnect();
    } catch (err) {
      console.warn('[Transmissao] erro ao desconectar room', err);
    }
    this.room = undefined;

    // Marca doc Firestore como encerrado + grava duração final
    if (this.transmissaoId) {
      try {
        await this.transmissoesSrv.encerrar(
          this.campeonatoId,
          this.categoriaId,
          this.jogoId,
          this.transmissaoId,
          duracaoFinal,
        );
      } catch (err) {
        console.warn('[Transmissao] erro ao encerrar doc Firestore', err);
      }
    }
    this.transmissaoId = undefined;

    this.estado = 'idle';
    this.viewersConectados = 0;
    this.duracaoSegundos = 0;
    this.cdr.detectChanges();
    this.toast('Transmissão encerrada.', 'success');
  }

  /**
   * Limpa todos os recursos (tracks de câmera/mic + room).
   * Chamado em ngOnDestroy + também ao fechar o modal.
   */
  private async pararTudo(): Promise<void> {
    if (this.duracaoInterval) clearInterval(this.duracaoInterval);
    // Para heartbeat também — senão segue tentando atualizar Firestore
    // mesmo após o modal fechar.
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    // Snapshot da duração final pra registrar no `encerrar()` abaixo —
    // mesmo quando o usuário fecha o modal sem clicar PARAR (ex: fecha o
    // navegador), a duração desta sessão é persistida pra Cloud Function
    // somar com sessões anteriores.
    const duracaoFinal = this.duracaoSegundos;

    // Desconecta room se ainda estiver conectado
    if (this.room && this.estado === 'live') {
      try { await this.room.disconnect(); } catch { /* ignore */ }
    }

    // Libera câmera/microfone (importante — senão a LED da câmera fica
    // acesa mesmo após fechar o modal).
    if (this.localVideoTrack) {
      this.localVideoTrack.stop();
      this.localVideoTrack = undefined;
    }
    if (this.localAudioTrack) {
      this.localAudioTrack.stop();
      this.localAudioTrack = undefined;
    }

    // Marca Firestore como encerrado se ainda estava ativo
    if (this.transmissaoId) {
      this.transmissoesSrv.encerrar(
        this.campeonatoId,
        this.categoriaId,
        this.jogoId,
        this.transmissaoId,
        duracaoFinal,
      ).catch(() => { /* ignore — best effort */ });
    }
  }

  /**
   * Alterna entre câmera frontal ('user') e traseira ('environment').
   *
   * Funciona em qualquer estado:
   *  - IDLE (preview ainda não publicou): recria localVideoTrack com
   *    novo facingMode e reataccha no <video> preview.
   *  - LIVE (já publicando no Room): faz unpublish do track antigo,
   *    recria com novo facingMode, publica de novo. Viewers vão ver
   *    um glitch curto (~200ms) — aceitável pra UX de troca de câmera.
   *
   * Em desktops sem câmera traseira, o browser cai automaticamente pra
   * a única disponível — não dá erro, só fica igual.
   */
  async flipCamera(): Promise<void> {
    if (this.trocandoCamera) return; // evita cliques múltiplos
    if (this.estado === 'connecting') return;
    if (!this.localVideoTrack) return;

    this.trocandoCamera = true;
    this.cdr.detectChanges();

    const novo = this.facingMode === 'user' ? 'environment' : 'user';

    try {
      // 1) Cria o novo track ANTES de matar o antigo — se a criação
      // falhar (sem câmera traseira no device, permissão revogada),
      // o usuário não fica com transmissão parada.
      // Usa a MESMA resolução E framerate (4K@60 se disponível) —
      // garante continuidade visual ao virar a câmera durante o broadcast.
      const novoTrack = await createLocalVideoTrack({
        resolution: {
          width: this.resolucaoAtual.width,
          height: this.resolucaoAtual.height,
          frameRate: this.framerateAtual,
        },
        facingMode: novo,
      });

      // 2) Se estamos LIVE, despublica o antigo e publica o novo. Em
      // IDLE basta trocar o preview — nada foi publicado ainda.
      if (this.estado === 'live' && this.room && this.localVideoTrack) {
        await this.room.localParticipant.unpublishTrack(this.localVideoTrack);
        this.localVideoTrack.stop();
        this.localVideoTrack = novoTrack;
        await this.room.localParticipant.publishTrack(novoTrack, {
          source: Track.Source.Camera,
          simulcast: true,
        });
      } else {
        // IDLE / preview — só substitui
        this.localVideoTrack.stop();
        this.localVideoTrack = novoTrack;
      }

      // 3) Sempre reataccha no preview pra refletir o novo feed
      if (this.videoPreviewRef?.nativeElement) {
        novoTrack.attach(this.videoPreviewRef.nativeElement);
      }

      this.facingMode = novo;
      this.toast(
        novo === 'user'
          ? 'Câmera frontal ativada.'
          : 'Câmera traseira ativada.',
        'success',
      );
    } catch (err) {
      console.error('[Transmissao] flipCamera falhou', err);
      this.toast('Não foi possível trocar de câmera neste dispositivo.', 'warning');
    } finally {
      this.trocandoCamera = false;
      this.cdr.detectChanges();
    }
  }

  /** Toggle mute do microfone (não desconecta — só silencia). */
  toggleMic(): void {
    if (!this.localAudioTrack) return;
    this.micMutado = !this.micMutado;
    if (this.micMutado) {
      this.localAudioTrack.mute();
    } else {
      this.localAudioTrack.unmute();
    }
    this.cdr.detectChanges();
  }

  /** Toggle câmera — útil pra organizador que quer pausar vídeo mas manter áudio. */
  toggleCamera(): void {
    if (!this.localVideoTrack) return;
    this.cameraDesligada = !this.cameraDesligada;
    if (this.cameraDesligada) {
      this.localVideoTrack.mute();
    } else {
      this.localVideoTrack.unmute();
    }
    this.cdr.detectChanges();
  }

  /** Conta viewers (todos os participantes EXCETO o próprio broadcaster).
   *  Salva o count atual no Firestore SEMPRE que muda — assim a transmissao.page
   *  e o player conseguem mostrar o número de viewers em tempo real, não só
   *  pra outros viewers mas pro próprio broadcaster ver. */
  private atualizarViewers(): void {
    if (!this.room) return;
    const total = this.room.remoteParticipants.size;
    const mudou = total !== this.viewersConectados;
    this.viewersConectados = total;
    if (total > this.viewersPico) this.viewersPico = total;

    // Persiste no Firestore só quando muda (evita writes desnecessários).
    // Best-effort — falha silenciosa não bloqueia o broadcast.
    if (mudou && this.transmissaoId) {
      this.transmissoesSrv.atualizarStats(
        this.campeonatoId, this.categoriaId, this.jogoId, this.transmissaoId,
        { viewersAtuais: total, viewersPico: this.viewersPico },
      ).catch(() => { /* ignore */ });
    }
    this.cdr.detectChanges();
  }

  /** Formata duração em MM:SS pra UI. */
  get duracaoFormatada(): string {
    const m = Math.floor(this.duracaoSegundos / 60);
    const s = this.duracaoSegundos % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  async fechar(): Promise<void> {
    if (this.estado === 'live') {
      const alert = await this.alertCtrl.create({
        header: 'Fechar modal?',
        message: 'Se fechar agora, a transmissão será encerrada.',
        buttons: [
          { text: 'Continuar transmitindo', role: 'cancel' },
          {
            text: 'Encerrar e fechar',
            role: 'destructive',
            handler: async () => {
              await this.parar();
              await this.modalCtrl.dismiss();
            },
          },
        ],
      });
      await alert.present();
      return;
    }
    await this.modalCtrl.dismiss();
  }

  /** Tenta novamente após erro de preview. */
  async tentarNovamente(): Promise<void> {
    this.mensagemErro = '';
    this.estado = 'idle';
    this.cdr.detectChanges();
    await this.prepararPreview();
  }

  private async toast(message: string, color: 'success' | 'warning' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2500, position: 'top', color,
    });
    await t.present();
  }
}
