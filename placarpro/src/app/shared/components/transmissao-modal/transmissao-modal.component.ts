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
import { AuthService } from '../../../auth/auth.service';
import { LiveKitService } from '../../livekit/livekit.service';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
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

  // ============ LiveKit state ============
  private room?: Room;
  private localVideoTrack?: LocalVideoTrack;
  private localAudioTrack?: LocalAudioTrack;

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly authSrv = inject(AuthService);
  private readonly livekit = inject(LiveKitService);
  private readonly transmissoesSrv = inject(TransmissoesService);
  private readonly campeonatosSrv = inject(CampeonatosService);

  async ngAfterViewInit(): Promise<void> {
    // Pequeno delay pra garantir que o ViewChild `videoPreviewRef` está renderizado.
    setTimeout(() => this.prepararPreview(), 50);

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
      // Portrait — sai do fullscreen pra a UX padrão voltar.
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
  async entrarTelaCheia(): Promise<void> {
    // 1) iOS Safari — videoEl.webkitEnterFullscreen
    const video = this.videoPreviewRef?.nativeElement as
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | undefined;
    if (video?.webkitEnterFullscreen && !document.fullscreenEnabled) {
      try {
        video.webkitEnterFullscreen();
        return;
      } catch (err) {
        console.info('[Transmissao] webkitEnterFullscreen falhou', err);
      }
    }
    // 2) Fluxo padrão (Chrome/Firefox/Safari macOS desktop/etc)
    const ok = await this.entrarFullscreen();
    if (!ok) {
      // Último recurso: tenta no <video> direto mesmo em browsers
      // não-iOS (alguns Android browsers só permitem em video element)
      if (video?.webkitEnterFullscreen) {
        try { video.webkitEnterFullscreen(); } catch { /* ignore */ }
      } else {
        this.toast(
          'Seu navegador não permite tela cheia. Adicione o app à tela inicial pra experiência completa.',
          'warning',
        );
      }
    }
  }

  private async entrarFullscreen(): Promise<boolean> {
    try {
      if (document.fullscreenElement) return true;
      const el = document.documentElement;
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
      // Resolução: 720p a 30fps é o sweet spot mobile→mobile.
      // Bitrate fica controlado pelo LiveKit automático.
      this.localVideoTrack = await createLocalVideoTrack({
        resolution: { width: 1280, height: 720, frameRate: 30 },
        facingMode: this.facingMode,
      });
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
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        this.mensagemErro = 'Permissão de câmera/microfone negada. Habilite nas configurações do navegador e tente novamente.';
      } else if (msg.toLowerCase().includes('notfound') || msg.toLowerCase().includes('device')) {
        this.mensagemErro = 'Nenhuma câmera/microfone encontrado neste dispositivo.';
      } else {
        this.mensagemErro = 'Falha ao acessar câmera/microfone: ' + msg;
      }
      this.cdr.detectChanges();
    }
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
      this.room = new Room({
        adaptiveStream: true,    // ajusta qualidade auto pros viewers
        dynacast: true,          // economiza banda — só envia o que tá assistindo
        publishDefaults: {
          videoEncoding: {
            maxBitrate: 1_500_000, // 1.5 Mbps — bom pra mobile
            maxFramerate: 30,
          },
          audioPreset: { maxBitrate: 64_000 },
          simulcast: true,       // múltiplas resoluções → fallback automático em rede ruim
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
      this.estado = 'erro';
      this.mensagemErro = (err instanceof Error) ? err.message : 'Falha desconhecida ao iniciar transmissão.';
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
      const novoTrack = await createLocalVideoTrack({
        resolution: { width: 1280, height: 720, frameRate: 30 },
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
