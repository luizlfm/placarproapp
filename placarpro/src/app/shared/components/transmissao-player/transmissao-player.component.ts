import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Observable, Subscription, of } from 'rxjs';
import {
  RemoteTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
  VideoQuality,
} from 'livekit-client';
import { LiveKitService } from '../../livekit/livekit.service';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';
import { Transmissao } from '../../../campeonatos/models/transmissao.model';
import { UsersService } from '../../../users/users.service';
import { Patrocinador } from '../../../users/models/patrocinador.model';
import { PatrocinadorJogo } from '../../../campeonatos/models/jogo.model';

/**
 * Player de Transmissão ao Vivo — usado nas páginas que exibem o jogo
 * (admin: `jogo-detalhe`; pública: `publico-jogo`).
 *
 * Comportamento:
 *  - Monitora `transmissoesSrv.ativa$()` pra detectar quando aparece uma
 *    transmissão ativa pro jogo. Se não tem nenhuma, o componente renderiza
 *    null (não polui a página).
 *  - Quando aparece transmissão ativa → pede token de VIEWER (não publica)
 *    e conecta ao Room. Subscreve aos tracks do broadcaster.
 *  - Quando o broadcaster encerra (doc Firestore vira `ativa: false`),
 *    desconecta automaticamente.
 *
 * Por que componente (não modal):
 *  - Aparece "embutido" na página, junto do placar. Espectador não precisa
 *    abrir/fechar nada — chega na página do jogo e já vê o vídeo.
 *
 * NÃO precisa de login pra viewer. A Cloud Function emite token de subscribe
 * pra qualquer um (auth opcional). Identidade é gerada anônima se não logado.
 */
@Component({
  selector: 'app-transmissao-player',
  templateUrl: './transmissao-player.component.html',
  styleUrls: ['./transmissao-player.component.scss'],
  standalone: false,
})
export class TransmissaoPlayerComponent implements OnChanges, OnDestroy {
  @Input() jogoId = '';
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  /**
   * Modo de exibição:
   *  - 'compacto'    — small player embutido (default na página do jogo)
   *  - 'fullscreen'  — ocupa quase tela toda (modo "imersivo")
   */
  @Input() modo: 'compacto' | 'fullscreen' = 'compacto';

  /** Nome do campeonato — exibido no footer do player no lugar do nome
   *  do broadcaster, pra dar contexto pro espectador (mais útil que o
   *  nome de quem transmite, especialmente em transmissões públicas). */
  @Input() campeonatoNome = '';

  /**
   * Seletor CSS de um ancestor que será fullscreenado em vez de só o
   * próprio card do player. Permite à página pai (publico-jogo,
   * jogo-detalhe, etc) marcar um wrapper que CONTÉM o player + placar +
   * banner + outros overlays, e ter TUDO ISSO em fullscreen junto.
   *
   * Ex.: `<div class="js-tx-fs-root"><scoreboard/><app-transmissao-player
   *      fullscreenAncestor=".js-tx-fs-root"></div>`
   *
   * Quando vazio (default), só o `.tp-card` do player vai pra fullscreen.
   */
  @Input() fullscreenAncestor = '';

  /**
   * Dados do placar do jogo — renderizados como overlay broadcast no
   * topo do player (sempre visíveis, inclusive em fullscreen).
   *
   * Sem este input, o player só mostra video + AO VIVO + footer. Quando
   * a página pai passa estes dados, vira uma overlay tipo TV com nome
   * dos times, escudos, gols e status do jogo.
   *
   * Mantemos AQUI (no próprio player) em vez de só CSS externo porque
   * fullscreen real (do browser) move o elemento pra fora do contexto
   * normal — overlays que dependem de CSS de ancestrais podem sumir
   * em alguns browsers. Como filho direto do .tp-card, sempre aparece.
   */
  @Input() placar?: {
    mandanteNome: string;
    visitanteNome: string;
    mandanteLogo?: string;
    visitanteLogo?: string;
    golsMandante?: number | null;
    golsVisitante?: number | null;
    statusTexto?: string; // ex: "1° Tempo", "AO VIVO", "Encerrado"
  };

  /**
   * ID do dono do campeonato — usado pra carregar os patrocinadores
   * GLOBAIS dele e exibir um banner rotativo no canto do player.
   * Funciona como FALLBACK: só é usado se `patrocinadoresPartida`
   * estiver vazio. Quando vazio também aqui, nenhum banner é exibido.
   */
  @Input() ownerIdPatrocinadores = '';

  /**
   * Patrocinadores ESPECÍFICOS da partida (jogo.patrocinadores).
   * Tem PRIORIDADE sobre `ownerIdPatrocinadores` — quando passado, os
   * patrocinadores globais são ignorados e só estes aparecem no banner.
   *
   * Recebe `PatrocinadorJogo` (nome + logoUrl) que é mapeado pra
   * `Patrocinador` internamente pra reusar o mesmo template.
   */
  @Input() patrocinadoresPartida: PatrocinadorJogo[] | null | undefined = undefined;

  /** Observable da transmissão ativa pra este jogo. Null = ninguém ao vivo. */
  ativa$: Observable<Transmissao | null> = of(null);

  /** Estado interno do player. */
  estado: 'aguardando' | 'connecting' | 'live' | 'erro' = 'aguardando';

  /** Resolução real do vídeo que está chegando do broadcaster. Atualizada
   *  pelo evento `loadedmetadata` do <video> assim que o stream tem
   *  dimensões reais. Mostrada num chip no canto da tela pra usuário ver
   *  a qualidade efetiva da transmissão (não a configurada). */
  resolucaoRecebida: { width: number; height: number } | null = null;

  /** Chave no localStorage onde guardamos a preferência de qualidade. */
  private static readonly KEY_QUALIDADE = 'placarpro_qualidade_transmissao';

  /** Qualidade selecionada pelo viewer:
   *   - 'auto'   → LiveKit escolhe automaticamente conforme banda (padrão)
   *   - 'alta'   → força layer HIGH (1080p+ se disponível)
   *   - 'media'  → força layer MEDIUM (720p)
   *   - 'baixa'  → força layer LOW (360p) — economiza dados/banda */
  qualidadeSelecionada: 'auto' | 'alta' | 'media' | 'baixa' = this.lerQualidadeSalva();

  /** Controle de visibilidade do menu de qualidade (clica no botão de
   *  engrenagem pra abrir). */
  menuQualidadeAberto = false;

  /** Lê preferência de qualidade do localStorage (default: auto). */
  private lerQualidadeSalva(): 'auto' | 'alta' | 'media' | 'baixa' {
    try {
      const v = localStorage.getItem(TransmissaoPlayerComponent.KEY_QUALIDADE);
      if (v === 'alta' || v === 'media' || v === 'baixa' || v === 'auto') return v;
    } catch { /* ignore */ }
    return 'auto';
  }

  /**
   * Aplica a qualidade selecionada na publication do track de vídeo.
   * No LiveKit Client SDK 2.x, `setVideoQuality` é método da
   * `RemoteTrackPublication`, não do track em si.
   */
  private aplicarQualidadeNaPublication(pub: RemoteTrackPublication): void {
    try {
      switch (this.qualidadeSelecionada) {
        case 'alta':  pub.setVideoQuality(VideoQuality.HIGH); break;
        case 'media': pub.setVideoQuality(VideoQuality.MEDIUM); break;
        case 'baixa': pub.setVideoQuality(VideoQuality.LOW); break;
        case 'auto':
        default:
          // Sem setVideoQuality = adaptive (default).
          pub.setSubscribed(true);
      }
    } catch (err) {
      console.warn('[Player] setVideoQuality falhou', err);
    }
  }

  /** Chamado pelo template quando user clica numa opção do menu de
   *  qualidade. Aplica imediatamente + salva preferência. */
  selecionarQualidade(q: 'auto' | 'alta' | 'media' | 'baixa'): void {
    this.qualidadeSelecionada = q;
    try {
      localStorage.setItem(TransmissaoPlayerComponent.KEY_QUALIDADE, q);
    } catch { /* ignore */ }
    // Aplica na publication do track de vídeo atual (se houver).
    if (this.room) {
      this.room.remoteParticipants.forEach(p => {
        p.videoTrackPublications.forEach(pub => {
          this.aplicarQualidadeNaPublication(pub as RemoteTrackPublication);
        });
      });
    }
    this.menuQualidadeAberto = false;
    this.cdr.detectChanges();
  }

  /** Aplica qualidade selecionada em TODAS as publications de vídeo
   *  ativas — usado tanto na seleção manual quanto quando um novo
   *  track chega. */
  private aplicarQualidadeNaTrackAtual(): void {
    if (!this.room) return;
    this.room.remoteParticipants.forEach(p => {
      p.videoTrackPublications.forEach(pub => {
        this.aplicarQualidadeNaPublication(pub as RemoteTrackPublication);
      });
    });
  }

  /** Toggle do menu dropdown. */
  toggleMenuQualidade(): void {
    this.menuQualidadeAberto = !this.menuQualidadeAberto;
    this.cdr.detectChanges();
  }

  /** Label legível pra mostrar no botão de qualidade. */
  get labelQualidade(): string {
    switch (this.qualidadeSelecionada) {
      case 'alta':  return 'Alta';
      case 'media': return 'Média';
      case 'baixa': return 'Baixa';
      case 'auto':
      default:      return 'Auto';
    }
  }

  /** Label legível: "4K", "1080p", "720p", etc. Calculada a partir do
   *  videoHeight (mais confiável que width — funciona pra qualquer aspect). */
  get rotuloResolucao(): string {
    const r = this.resolucaoRecebida;
    if (!r) return '';
    const h = r.height;
    if (h >= 2160) return '4K';
    if (h >= 1440) return '1440p';
    if (h >= 1080) return '1080p';
    if (h >= 720)  return '720p';
    if (h >= 480)  return '480p';
    return `${r.width}×${h}`;
  }
  mensagemErro = '';

  /** Volume mutado (default true — autoplay com áudio é bloqueado pelo browser). */
  mutado = true;

  @ViewChild('videoEl') videoElRef?: ElementRef<HTMLVideoElement>;
  /** Referência ao componente host pra walk-up DOM (find ancestor). */
  private readonly hostRef = inject(ElementRef);

  private room?: Room;
  private subAtiva?: Subscription;
  /** ID da transmissão em que o player está conectado agora (se houver). */
  private transmissaoAtualId?: string;

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly livekit = inject(LiveKitService);
  private readonly transmissoesSrv = inject(TransmissoesService);
  private readonly usersSrv = inject(UsersService);

  // ════ Patrocinador overlay state ════
  /** Lista de patrocinadores filtrada por escopo (campeonato/categoria). */
  patrocinadoresOverlay: Patrocinador[] = [];
  /** Índice do banner atualmente visível. */
  patrocinadorIdx = 0;
  private patrocinadorSub?: Subscription;
  private patrocinadorTimer?: ReturnType<typeof setInterval>;

  ngOnChanges(changes: SimpleChanges): void {
    // Quando muda jogo/campeonato/categoria, recomeça a checagem de "tem live?".
    if (changes['jogoId'] || changes['campeonatoId'] || changes['categoriaId']) {
      this.reiniciarMonitoramento();
    }
    // Quando muda patrocinadoresPartida, ownerId ou escopo, refaz o banner.
    if (
      changes['patrocinadoresPartida'] ||
      changes['ownerIdPatrocinadores'] ||
      changes['campeonatoId'] ||
      changes['categoriaId']
    ) {
      this.carregarPatrocinadores();
    }
  }

  /**
   * Carrega os patrocinadores pro banner do canto do player.
   *
   * PRIORIDADE:
   *  1. Se `patrocinadoresPartida` foi passado (lista da partida) → usa essa.
   *     Os patrocinadores da partida têm prioridade absoluta — quando o admin
   *     cadastra patrocinadores específicos pra um jogo, eles SUBSTITUEM
   *     completamente os globais do owner (não somam).
   *  2. Senão, fallback pra patrocinadores GLOBAIS do owner (ownerId) filtrados
   *     por escopo (campeonato/categoria).
   *
   * Re-chamado sempre que algum dos inputs muda.
   */
  private carregarPatrocinadores(): void {
    this.patrocinadorSub?.unsubscribe();
    if (this.patrocinadorTimer) clearInterval(this.patrocinadorTimer);
    this.patrocinadoresOverlay = [];
    this.patrocinadorIdx = 0;

    // CAMINHO 1: lista da partida tem prioridade (override).
    if (this.patrocinadoresPartida && this.patrocinadoresPartida.length > 0) {
      this.patrocinadoresOverlay = this.patrocinadoresPartida
        .filter(p => p.logoUrl || p.nome)
        .map((p): Patrocinador => ({
          ownerId: '',
          nome: p.nome,
          logoUrl: p.logoUrl,
        }));
      this.patrocinadorIdx = 0;
      this.iniciarRotacaoPatrocinadores();
      this.cdr.detectChanges();
      return;
    }

    // CAMINHO 2: fallback — patrocinadores globais do owner.
    if (!this.ownerIdPatrocinadores) return;

    this.patrocinadorSub = this.usersSrv
      .patrocinadoresDoOwner$(this.ownerIdPatrocinadores)
      .subscribe({
        next: (lista) => {
          this.patrocinadoresOverlay = this.filtrarPatrocinadoresPorEscopo(lista);
          this.patrocinadorIdx = 0;
          this.iniciarRotacaoPatrocinadores();
          this.cdr.detectChanges();
        },
        error: (err) => {
          console.warn('[Player] erro ao carregar patrocinadores', err);
        },
      });
  }

  /** Filtra por escopo (mesma lógica da patrocinadores-faixa). */
  private filtrarPatrocinadoresPorEscopo(lista: Patrocinador[]): Patrocinador[] {
    return lista.filter((p) => {
      // 1. Campeonato no escopo (ou sem escopo = todos)
      if (p.campeonatosVisivel && p.campeonatosVisivel.length > 0) {
        if (!p.campeonatosVisivel.includes(this.campeonatoId)) return false;
      }
      // 2. Categoria específica (par "campId:catId")
      if (p.categoriasVisivel && p.categoriasVisivel.length > 0) {
        const par = `${this.campeonatoId}:${this.categoriaId}`;
        if (!p.categoriasVisivel.includes(par)) return false;
      }
      // 3. Precisa ter ALGUMA imagem pra mostrar
      const temImagem = !!(
        p.bannerAppUrl ||
        p.bannerAppMobileUrl ||
        p.bannerSiteUrl ||
        p.bannerSiteMobileUrl ||
        p.logoUrl
      );
      return temImagem;
    });
  }

  /** URL do banner do patrocinador atual — escolhe o melhor formato pra
   *  posição do overlay (preferimos bannerSite que é mais horizontal,
   *  cai pra App ou logo se não tiver). */
  bannerUrlAtual(): string {
    const p = this.patrocinadoresOverlay[this.patrocinadorIdx];
    if (!p) return '';
    const ehMobile =
      typeof window !== 'undefined' && window.innerWidth <= 600;
    if (ehMobile) {
      return (
        p.bannerSiteMobileUrl ||
        p.bannerAppMobileUrl ||
        p.bannerSiteUrl ||
        p.bannerAppUrl ||
        p.logoUrl ||
        ''
      );
    }
    return (
      p.bannerSiteUrl ||
      p.bannerAppUrl ||
      p.bannerSiteMobileUrl ||
      p.bannerAppMobileUrl ||
      p.logoUrl ||
      ''
    );
  }

  /** Inicia timer de rotação — se só há 1, fica fixo. */
  private iniciarRotacaoPatrocinadores(): void {
    if (this.patrocinadorTimer) clearInterval(this.patrocinadorTimer);
    if (this.patrocinadoresOverlay.length <= 1) return;
    const tempoMs = Math.max(
      3000,
      (this.patrocinadoresOverlay[this.patrocinadorIdx]?.tempoBanner || 6) * 1000,
    );
    this.patrocinadorTimer = setInterval(() => {
      this.patrocinadorIdx =
        (this.patrocinadorIdx + 1) % this.patrocinadoresOverlay.length;
      this.cdr.detectChanges();
      // Reinicia o timer com tempo do banner atual (cada patrocinador
      // pode ter seu próprio `tempoBanner`).
      this.iniciarRotacaoPatrocinadores();
    }, tempoMs);
  }

  ngOnDestroy(): void {
    this.subAtiva?.unsubscribe();
    this.patrocinadorSub?.unsubscribe();
    if (this.patrocinadorTimer) clearInterval(this.patrocinadorTimer);
    this.desconectar();
  }

  /**
   * (Re)inicia a observação do Firestore pra detectar transmissões ativas.
   * Cada emissão do observable representa o estado atual de "tem live agora?".
   */
  private reiniciarMonitoramento(): void {
    this.subAtiva?.unsubscribe();
    this.desconectar();

    if (!this.jogoId || !this.campeonatoId || !this.categoriaId) {
      this.ativa$ = of(null);
      return;
    }

    console.info('[Player] monitorando transmissão', {
      campeonatoId: this.campeonatoId,
      categoriaId: this.categoriaId,
      jogoId: this.jogoId,
    });

    this.ativa$ = this.transmissoesSrv.ativa$(this.campeonatoId, this.categoriaId, this.jogoId);

    // Sub manual pra reagir a mudanças de estado (conectar / desconectar).
    // (`async` no template renderiza o badge AO VIVO; aqui controlamos a
    // conexão real ao LiveKit Room.)
    this.subAtiva = this.ativa$.subscribe(transmissao => {
      console.info('[Player] ativa$ emitiu', {
        transmissao,
        atualId: this.transmissaoAtualId,
      });
      if (transmissao && transmissao.ativa && transmissao.id !== this.transmissaoAtualId) {
        // Apareceu uma transmissão nova (ou troca de transmissão).
        this.conectar(transmissao);
      } else if (!transmissao && this.transmissaoAtualId) {
        // Transmissão sumiu (foi encerrada) → desconecta.
        this.desconectar();
      }
    });
  }

  /**
   * Conecta ao Room como viewer (subscribe-only) e liga o <video> ao
   * primeiro track de câmera publicado pelo broadcaster.
   */
  private async conectar(transmissao: Transmissao): Promise<void> {
    if (this.livekit.naoConfigurado) {
      this.estado = 'erro';
      this.mensagemErro = 'Player ainda não configurado pelo administrador.';
      this.cdr.detectChanges();
      return;
    }

    // Se já conectado em outra sala, desconecta antes
    if (this.room) {
      await this.desconectar();
    }

    this.estado = 'connecting';
    this.transmissaoAtualId = transmissao.id;
    this.cdr.detectChanges();

    try {
      console.info('[Player] pedindo token viewer', { jogoId: this.jogoId });
      // 1) Pede token de viewer (anônimo OK — sem checagem de auth).
      const { token } = await this.livekit.gerarToken({
        jogoId: this.jogoId,
        papel: 'viewer',
      });
      console.info('[Player] token recebido (length=' + token.length + ')');

      // 2) Cria Room (sem publicar — só vai assistir).
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      // 3) Listener pra quando o broadcaster publicar a câmera/microfone.
      this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        console.info('[Player] TrackSubscribed', { kind: track.kind, sid: track.sid });
        this.attachTrack(track);
      });

      this.room.on(RoomEvent.TrackUnsubscribed, (track) => {
        console.info('[Player] TrackUnsubscribed', { kind: track.kind });
        track.detach();
      });

      this.room.on(RoomEvent.ParticipantConnected, (p) => {
        console.info('[Player] ParticipantConnected', { identity: p.identity });
      });

      this.room.on(RoomEvent.Disconnected, (reason) => {
        console.warn('[Player] Disconnected', { reason });
        // Fim da transmissão pelo lado do broadcaster ou queda de rede.
        this.estado = 'aguardando';
        this.transmissaoAtualId = undefined;
        this.cdr.detectChanges();
      });

      // 4) Conecta.
      console.info('[Player] conectando ao Room', { url: this.livekit.url });
      await this.room.connect(this.livekit.url, token);
      console.info('[Player] conectado!', {
        remoteParticipants: this.room.remoteParticipants.size,
        roomName: this.room.name,
      });

      // 5) FALLBACK — pega tracks JÁ publicados pelos participantes que
      // estavam na sala antes do viewer conectar. Sem isso, se o evento
      // `TrackSubscribed` disparou ANTES do listener ser registrado
      // (improvável mas possível com timing) ou se o broadcaster usa
      // `dynacast` e demora pra ativar layers, o viewer fica preso em
      // "Conectando..." pra sempre. Aqui percorremos manualmente.
      const tentarAttachExistentes = () => {
        // Não muda `estado` aqui — `attachTrack` é quem decide promover
        // pra 'live' (só depois que track de vídeo entra de fato no
        // elemento). Senão o overlay "Conectando..." some no primeiro
        // áudio publicado e o usuário vê tela preta sem feedback.
        this.room?.remoteParticipants.forEach(participant => {
          participant.trackPublications.forEach(pub => {
            if (pub.track) {
              this.attachTrack(pub.track);
            }
          });
        });
      };
      // Roda imediatamente + repete 4× (250ms, 800ms, 2s, 4s) pra cobrir:
      //  - dynacast levando até alguns segundos pra ativar layers,
      //  - viewer entrando ANTES do broadcaster publicar (caso reload),
      //  - publicação tardia de áudio depois do vídeo (ou vice-versa).
      // Cada tick reattacha — `track.attach()` é idempotente (LiveKit
      // ignora attach duplicado no mesmo elemento).
      tentarAttachExistentes();
      setTimeout(tentarAttachExistentes, 250);
      setTimeout(tentarAttachExistentes, 800);
      setTimeout(tentarAttachExistentes, 2000);
      setTimeout(tentarAttachExistentes, 4000);
    } catch (err: unknown) {
      console.error('[Player] erro ao conectar', err);
      this.estado = 'erro';
      this.mensagemErro = (err instanceof Error) ? err.message : 'Falha ao conectar à transmissão.';
      this.cdr.detectChanges();
    }
  }

  /**
   * Liga um track remoto ao `<video>`. Funciona tanto pra Video quanto
   * pra Audio (LiveKit faz a multiplexação internamente quando você
   * passa o mesmo `HTMLMediaElement`). Só vira `estado = 'live'` quando
   * um track de VÍDEO foi attached — caso contrário o overlay "Conectando..."
   * some prematuramente e o usuário fica com tela preta sem feedback (já
   * que áudio pode publicar uns ms antes do vídeo). Retries por até ~3s
   * porque o `<video>` está dentro do `*ngIf="ativa$ | async"` e pode
   * demorar um CD cycle pra renderizar.
   */
  private attachTrack(track: RemoteTrack, tentativa = 0): void {
    const el = this.videoElRef?.nativeElement;
    if (!el) {
      if (tentativa < 30) {
        // ~3s total (30 × 100ms). Se passou disso, desisto e logo —
        // sinal de que o `*ngIf` não foi resolvido (provavelmente o doc
        // da transmissão sumiu durante a conexão).
        setTimeout(() => this.attachTrack(track, tentativa + 1), 100);
      } else {
        console.warn('[Player] <video> nunca renderizou — abortando attach', { kind: track.kind });
      }
      return;
    }
    if (track.kind === Track.Kind.Video) {
      (track as RemoteVideoTrack).attach(el);
      // Aplica qualidade selecionada pelo user (auto/alta/media/baixa)
      // na publication correspondente.
      this.aplicarQualidadeNaTrackAtual();
      // ═══ Otimizações de LATÊNCIA no elemento <video> do espectador ═══
      // Browsers HTML5 fazem buffer interno de 1-3s por padrão. Em
      // transmissão ao vivo isso é DELAY puro — vamos zerar.
      try {
        const v = el as HTMLVideoElement;
        // `preload='none'` previne pré-buffer.
        v.preload = 'none';
        v.playsInline = true;
        // Lê resolução real do vídeo quando metadata carrega.
        v.addEventListener('loadedmetadata', () => {
          if (v.videoWidth > 0 && v.videoHeight > 0) {
            this.resolucaoRecebida = { width: v.videoWidth, height: v.videoHeight };
            this.cdr.detectChanges();
          }
        }, { once: true });
        // Anti-drift: se acumular > 1s de buffer, pula pra ponta —
        // mantém live em vez de acumular delay.
        v.addEventListener('progress', () => {
          if (v.buffered.length > 0) {
            const ultimoBuffer = v.buffered.end(v.buffered.length - 1);
            const drift = ultimoBuffer - v.currentTime;
            if (drift > 1.0 && !v.paused) {
              v.currentTime = ultimoBuffer - 0.1;
            }
          }
        });
      } catch (err) {
        console.warn('[Player] otimização latência falhou', err);
      }
      // Só promove pra 'live' QUANDO vídeo de fato attachou — áudio
      // sozinho mantém overlay "Conectando..." porque o usuário ainda
      // não tem nada pra ver.
      if (this.estado !== 'live') {
        this.estado = 'live';
        this.cdr.detectChanges();
      }
    } else if (track.kind === Track.Kind.Audio) {
      track.attach(el);
      // Não troca o estado — espera o vídeo.
    }
  }

  /** Desconecta + limpa estado. */
  private async desconectar(): Promise<void> {
    if (this.room) {
      try { await this.room.disconnect(); } catch { /* ignore */ }
      this.room = undefined;
    }
    this.transmissaoAtualId = undefined;
    if (this.estado !== 'aguardando') {
      this.estado = 'aguardando';
      this.cdr.detectChanges();
    }
  }

  /** Toggle mute do áudio (não desconecta — apenas <video>.muted). */
  toggleMute(): void {
    this.mutado = !this.mutado;
    if (this.videoElRef?.nativeElement) {
      this.videoElRef.nativeElement.muted = this.mutado;
    }
    this.cdr.detectChanges();
  }

  /**
   * Toggle fullscreen com prioridade:
   *  1. Se já em fullscreen → exitFullscreen.
   *  2. Tenta fullscreen no ANCESTOR informado via `[fullscreenAncestor]`
   *     (mantém scoreboard + banner + outros overlays visíveis no fs).
   *  3. Cai pro `.tp-card` (próprio card do player com badges + footer).
   *  4. iOS Safari sem `requestFullscreen` no <html>: usa
   *     `webkitEnterFullscreen` direto no <video> — só vídeo vai, perde
   *     scoreboard (limitação fundamental do Safari iOS, só PWA resolve).
   */
  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* ignore */ }
      return;
    }

    const host = this.hostRef.nativeElement as HTMLElement;
    // 1) Tenta o ancestor passado pelo pai (scoreboard junto)
    let target: HTMLElement | null = null;
    if (this.fullscreenAncestor) {
      target = host.closest(this.fullscreenAncestor) as HTMLElement | null;
    }
    // 2) Cai pro próprio .tp-card do player
    if (!target) {
      target = host.querySelector('.tp-card') as HTMLElement | null;
    }
    // 3) Último fallback: o host inteiro
    if (!target) target = host;

    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen();
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyT = target as any;
      if (anyT.webkitRequestFullscreen) {
        anyT.webkitRequestFullscreen();
        return;
      }
    } catch (err) {
      console.info('[Player] requestFullscreen falhou — tentando <video>', err);
    }

    // 4) iOS Safari: só o <video> pode ir fullscreen (perde overlays).
    const v = this.videoElRef?.nativeElement;
    if (v) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyV = v as any;
      if (anyV.webkitEnterFullscreen) {
        try { anyV.webkitEnterFullscreen(); } catch { /* ignore */ }
      } else if (v.requestFullscreen) {
        try { await v.requestFullscreen(); } catch { /* ignore */ }
      }
    }
  }
}
