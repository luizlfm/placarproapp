import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ActionModalService } from '../../../shared/components/action-modal/action-modal.service';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith, switchMap, tap } from 'rxjs/operators';
import { Timestamp } from '@angular/fire/firestore';
import { PatrocinadorJogoModalComponent } from './patrocinador-jogo-modal/patrocinador-jogo-modal.component';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import {
  EventoJogo,
  EventoTipo,
  Jogo,
  JogoStatus,
  PatrocinadorJogo,
  TempoJogoNome,
} from '../../../campeonatos/models/jogo.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { EditarInformacoesModalComponent } from './editar-informacoes-modal/editar-informacoes-modal.component';
import { EventoModalComponent } from './evento-modal/evento-modal.component';
import { EscalacaoModalComponent } from './escalacao-modal/escalacao-modal.component';
import { TransmissaoModalComponent } from '../../../shared/components/transmissao-modal/transmissao-modal.component';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';
import { dataHoraIsoParaBr } from '../../../shared/directives/mask.directive';
import { NavBackService } from '../../../shared/nav-back.service';
import {
  ModeradorPermissoesService,
  PermissoesEfetivas,
} from '../../../shared/moderador-permissoes.service';
import { PlanosService } from '../../../users/planos.service';
import { PwaInstallService } from '../../../shared/pwa-install.service';
import {
  precisaTutorialPwaIos,
  marcarTutorialPwaVisto,
} from '../../../shared/utils/pwa.utils';
import { IosPwaTutorialModalComponent } from '../../../shared/components/ios-pwa-tutorial-modal/ios-pwa-tutorial-modal.component';

interface EventoView extends EventoJogo {
  jogadorNome?: string;
  equipeNome: string;
  lado: 'mandante' | 'visitante';
}

interface JogadorEscalado {
  jogador: Jogador;
  gols: number;
  amarelos: number;
  vermelhos: number;
}

interface JogoView extends Jogo {
  nomeMandante: string;
  nomeVisitante: string;
  logoMandante?: string;
  logoVisitante?: string;
}

@Component({
  selector: 'app-jogo-detalhe',
  templateUrl: './jogo-detalhe.page.html',
  styleUrls: ['./jogo-detalhe.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class JogoDetalhePage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionCtrl = inject(ActionModalService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);
  private readonly modPerms = inject(ModeradorPermissoesService);
  private readonly planosSrv = inject(PlanosService);
  private readonly transmissoesSrv = inject(TransmissoesService);
  private readonly pwaInstall = inject(PwaInstallService);

  private readonly sanitizer = inject(DomSanitizer);

  // IDs de rota declarados ANTES de qualquer field reativa que dependa
  // deles (ex: `podeTransmissao$` abaixo). Em class field initializers
  // o TypeScript exige ordem topológica — se `podeTransmissao$` viesse
  // antes, `this.campeonatoId` ainda seria `undefined` na hora da
  // avaliação e o TS lança TS2729.
  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';
  readonly jogoId = this.route.snapshot.paramMap.get('jogoId') ?? '';

  /**
   * Stream — o organizador deste campeonato tem créditos de transmissão
   * disponíveis (plano + avulsos)?
   *
   * Usa o pool do DONO do campeonato (`ownerId`), não do usuário logado.
   * Assim organizador e moderadores compartilham os mesmos créditos.
   */
  readonly podeTransmissao$ = this.campeonatoId
    ? this.campeonatosSrv.get$(this.campeonatoId).pipe(
        switchMap(camp =>
          camp?.ownerId
            ? this.planosSrv.podeTransmitirComoOwner$(camp.ownerId)
            : of(false),
        ),
      )
    : of(false);

  /** Transmissão LiveKit ativa pra este jogo (Observable do Firestore).
   *  Usado no template pra decidir se mostra o LiveKit player NO LUGAR
   *  do iframe do YouTube no painel "Ao Vivo" abaixo do placar. Quando
   *  o broadcaster inicia transmissão, esse Observable emite e a UI
   *  troca de YouTube → LiveKit player automaticamente. */
  readonly transmissaoLiveAtiva$ = this.transmissoesSrv.ativa$(
    this.campeonatoId, this.categoriaId, this.jogoId,
  );

  /** Cronômetro reativo da partida (string formatada "MM:SS").
   *  Atualiza a cada segundo enquanto `j.status === 'em-andamento'`. */
  readonly tempoDecorrido = signal('00:00');
  /** Minutos decorridos (inteiro). Usado pra posicionar lances na
   *  timeline horizontal. */
  readonly minutosDecorridos = signal(0);
  private timerHandle?: ReturnType<typeof setInterval>;

  /** Quick action types disponíveis no painel ao vivo. Cada um chama
   *  `adicionarLance(lado, tipo)` que já abre o modal pré-preenchido. */
  readonly quickActions: ReadonlyArray<{
    tipo: EventoTipo;
    label: string;
    icon: string;
    cor: string;
  }> = [
    { tipo: 'gol',       label: 'Gol',      icon: 'football',          cor: '#16a34a' },
    { tipo: 'amarelo',   label: 'Amarelo',  icon: 'square',            cor: '#f1b500' },
    { tipo: 'vermelho',  label: 'Vermelho', icon: 'square',            cor: '#e55353' },
    { tipo: 'falta',     label: 'Falta',    icon: 'hand-left-outline', cor: '#94a3b8' },
    { tipo: 'defesa',    label: 'Defesa',   icon: 'hand-right-outline',cor: '#4dabf7' },
  ];

  /** URL embedável do YouTube (sanitizada). Computada uma vez na primeira
   *  vez que o `youtubeVideoId` aparece — armazenada em cache pra evitar
   *  re-sanitização a cada change detection. */
  private ytEmbedCache?: { id: string; url: SafeResourceUrl };

  youtubeEmbedUrl(videoId: string | undefined | null): SafeResourceUrl | null {
    if (!videoId) return null;
    if (this.ytEmbedCache?.id === videoId) return this.ytEmbedCache.url;
    const url = this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`,
    );
    this.ytEmbedCache = { id: videoId, url };
    return url;
  }

  /** Posicionamento percentual (0–100) de um lance na timeline. Default
   *  partida de 50 minutos (~25 cada tempo) — ajusta automaticamente se o
   *  jogo já passou desse limite (até 90'). */
  posicaoTimeline(minuto: number | undefined): number {
    if (minuto == null) return 0;
    const limite = Math.max(50, this.minutosDecorridos() + 5, 90);
    return Math.min(100, Math.max(0, (minuto / limite) * 100));
  }

  /** Permissões efetivas do user no campeonato. Esconde botões de edição
   *  (Iniciar/Encerrar partida, Editar escalação, Adicionar lance, etc)
   *  pra moderadores sem `editarResultados`. A tela continua acessível
   *  como leitura — só os controles de edição somem. */
  readonly permissoes$: Observable<PermissoesEfetivas> = this.campeonatoId
    ? this.modPerms.efetivas$(this.campeonatoId)
    : of<PermissoesEfetivas>({
        nivel: 'nenhum',
        editarCampeonato: false,
        gerenciarEquipes: false,
        editarResultados: false,
        enviarMidias: false,
        gerenciarEnquetes: false,
      });

  /** Aba ativa do detalhe (escalacao | lances). Padrão = lances (UX prioriza o jogo em si). */
  segmentAtivo: 'escalacao' | 'lances' = 'lances';

  /** Lado da escalação atualmente visível (mandante | visitante). Em mobile,
   *  mostrar 2 colunas grudadas é apertado; segment escolhe 1 time por vez. */
  escalacaoLado: 'mandante' | 'visitante' = 'mandante';

  selecionarLadoEscalacao(lado: 'mandante' | 'visitante'): void {
    this.escalacaoLado = lado;
  }

  readonly campeonato$ = this.campeonatoId
    ? this.campeonatosSrv.get$(this.campeonatoId)
    : of(undefined);

  readonly categoria$ = this.campeonatoId && this.categoriaId
    ? this.categoriasSrv.get$(this.campeonatoId, this.categoriaId)
    : of(undefined);

  private readonly equipes$ = this.campeonatoId && this.categoriaId
    ? this.equipesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Equipe[]>([]),
        catchError(() => of<Equipe[]>([])),
      )
    : of<Equipe[]>([]);

  private readonly jogos$ = this.campeonatoId && this.categoriaId
    ? this.jogosSrv.list$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Jogo[]>([]),
        catchError(() => of<Jogo[]>([])),
      )
    : of<Jogo[]>([]);

  readonly jogo$: Observable<JogoView | undefined> = this.jogoId
    ? combineLatest([
        this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
        this.equipes$,
      ]).pipe(
        map(([j, eqs]) => {
          if (!j) return undefined;
          const m = eqs.find(e => e.id === j.mandanteId);
          const v = eqs.find(e => e.id === j.visitanteId);
          return {
            ...j,
            nomeMandante: m?.nome ?? '?',
            nomeVisitante: v?.nome ?? '?',
            logoMandante: m?.logoUrl,
            logoVisitante: v?.logoUrl,
          };
        }),
        catchError(() => of(undefined)),
      )
    : of(undefined);

  private readonly jogadores$ = this.campeonatoId && this.categoriaId
    ? this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Jogador[]>([]),
        catchError(() => of<Jogador[]>([])),
        // Cache local pra lookup síncrono no template (histórico de pênaltis)
        tap(js => { this._jogadoresCache = js; }),
      )
    : of<Jogador[]>([]);

  readonly eventos$: Observable<EventoView[]> = this.jogoId
    ? combineLatest([
        this.jogosSrv.listEventos$(this.campeonatoId, this.categoriaId, this.jogoId).pipe(
          startWith<EventoJogo[]>([]),
          catchError(() => of<EventoJogo[]>([])),
        ),
        this.jogo$,
        this.equipes$,
        this.jogadores$,
      ]).pipe(
        map(([evs, jogo, eqs, jogadores]) => {
          if (!jogo) return [] as EventoView[];
          return evs.map(e => {
            const eq = eqs.find(x => x.id === e.equipeId);
            const jg = e.jogadorId ? jogadores.find(j => j.id === e.jogadorId) : undefined;
            const lado: 'mandante' | 'visitante' =
              e.equipeId === jogo.mandanteId ? 'mandante' : 'visitante';
            return {
              ...e,
              jogadorNome: jg?.nome,
              equipeNome: eq?.nome ?? '?',
              lado,
            };
          });
        }),
      )
    : of([] as EventoView[]);

  readonly escalacaoMandante$: Observable<JogadorEscalado[]> = this.jogo$.pipe(
    switchMap(j => {
      if (!j?.id) return of<JogadorEscalado[]>([]);
      return combineLatest([
        this.jogosSrv.escalacao$(this.campeonatoId, this.categoriaId, j.id, j.mandanteId).pipe(
          startWith<string[]>([]),
          catchError(() => of<string[]>([])),
        ),
        this.jogadores$,
        this.eventos$,
      ]).pipe(
        map(([ids, jogadores, evs]) =>
          this.montarEscalados(ids, jogadores, evs, j.mandanteId),
        ),
      );
    }),
  );

  readonly escalacaoVisitante$: Observable<JogadorEscalado[]> = this.jogo$.pipe(
    switchMap(j => {
      if (!j?.id) return of<JogadorEscalado[]>([]);
      return combineLatest([
        this.jogosSrv.escalacao$(this.campeonatoId, this.categoriaId, j.id, j.visitanteId).pipe(
          startWith<string[]>([]),
          catchError(() => of<string[]>([])),
        ),
        this.jogadores$,
        this.eventos$,
      ]).pipe(
        map(([ids, jogadores, evs]) =>
          this.montarEscalados(ids, jogadores, evs, j.visitanteId),
        ),
      );
    }),
  );

  private montarEscalados(
    ids: string[],
    jogadores: Jogador[],
    eventos: EventoView[],
    equipeId: string,
  ): JogadorEscalado[] {
    return ids
      .map(id => jogadores.find(j => j.id === id))
      .filter((j): j is Jogador => !!j)
      .map(j => {
        const meus = eventos.filter(e => e.jogadorId === j.id && e.equipeId === equipeId);
        return {
          jogador: j,
          gols: meus.filter(e => e.tipo === 'gol').length,
          amarelos: meus.filter(e => e.tipo === 'amarelo').length,
          vermelhos: meus.filter(e => e.tipo === 'vermelho').length,
        };
      });
  }

  private readonly filtroStorageKey = `jogo-detalhe:filtros:${this.categoriaId}`;
  private readonly filtroInicial = this.lerFiltrosSalvos();
  readonly filtroFase$ = new BehaviorSubject<string>(this.filtroInicial.fase);
  readonly filtroRodada$ = new BehaviorSubject<string>(this.filtroInicial.rodada);

  /** Lista de fases distintas (texto livre) — `''` representa "Todas". */
  readonly fasesDisponiveis$: Observable<string[]> = this.jogos$.pipe(
    map(js => Array.from(new Set(js.map(j => j.fase ?? '').filter(f => f !== ''))).sort()),
  );

  /** Lista de rodadas distintas (números) — `0` representa "Todas". */
  readonly rodadasDisponiveis$: Observable<number[]> = combineLatest([
    this.jogos$,
    this.filtroFase$,
  ]).pipe(
    map(([js, fase]) => {
      const filtrados = fase ? js.filter(j => (j.fase ?? '') === fase) : js;
      return Array.from(
        new Set(filtrados.map(j => j.rodada).filter((r): r is number => r != null)),
      ).sort((a, b) => a - b);
    }),
  );

  readonly outrosJogos$: Observable<JogoView[]> = combineLatest([
    this.jogos$,
    this.equipes$,
    this.filtroFase$,
    this.filtroRodada$,
  ]).pipe(
    map(([js, eqs, fase, rodada]) => {
      let filtrados = js;
      if (fase) filtrados = filtrados.filter(j => (j.fase ?? '') === fase);
      if (rodada) filtrados = filtrados.filter(j => String(j.rodada ?? '') === rodada);
      return filtrados.map(j => {
        const m = eqs.find(e => e.id === j.mandanteId);
        const v = eqs.find(e => e.id === j.visitanteId);
        return {
          ...j,
          nomeMandante: m?.nome ?? '?',
          nomeVisitante: v?.nome ?? '?',
          logoMandante: m?.logoUrl,
          logoVisitante: v?.logoUrl,
        };
      });
    }),
  );

  onFiltroFase(value: string): void {
    this.filtroFase$.next(value);
    // Reseta rodada quando muda fase pra evitar combinações vazias
    this.filtroRodada$.next('');
    this.salvarFiltros();
  }

  onFiltroRodada(value: string): void {
    this.filtroRodada$.next(value);
    this.salvarFiltros();
  }

  private salvarFiltros(): void {
    try {
      sessionStorage.setItem(
        this.filtroStorageKey,
        JSON.stringify({ fase: this.filtroFase$.value, rodada: this.filtroRodada$.value }),
      );
    } catch {
      /* sem-op */
    }
  }

  private lerFiltrosSalvos(): { fase: string; rodada: string } {
    try {
      const raw = sessionStorage.getItem(`jogo-detalhe:filtros:${this.categoriaId}`);
      if (!raw) return { fase: '', rodada: '' };
      const v = JSON.parse(raw) as { fase?: string; rodada?: string };
      return { fase: v.fase ?? '', rodada: v.rodada ?? '' };
    } catch {
      return { fase: '', rodada: '' };
    }
  }

  ngOnInit(): void {
    // ─── Cronômetro reativo ────────────────────────────────────────
    // Sobe um setInterval enquanto o jogo está em-andamento. Lê
    // `iniciadoEm` (Timestamp Firestore) pra calcular o offset.
    // Quando o status muda pra encerrado, segura o último valor.
    this.jogo$.subscribe(j => this.sincronizarCronometro(j));

    const action = this.route.snapshot.queryParamMap.get('action');
    if (!action) return;
    setTimeout(() => {
      if (action === 'info') void this.editarInformacoes();
      else if (action === 'resultado') void this.editarResultado();
      else if (action === 'equipes') void this.emBreve('Selecionar equipes');
      // Limpa o query param pra não reabrir no F5
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { action: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 200);
  }

  ngOnDestroy(): void {
    this.pararCronometro();
  }

  /** Sincroniza o estado do cronômetro com o jogo atual.
   *
   *  Prioridade do "início" pra contar o cronômetro:
   *   1. `tempoAtualIniciadoEm` — quando o período atual começou
   *      (reseta a cada troca de tempo). É o relógio "do tempo".
   *   2. `iniciadoEm` — fallback pra jogos antigos sem o novo campo.
   *
   *  Estados:
   *   - em-andamento + base válida → timer rodando
   *   - encerrado + base válida    → mostra duração final, parado
   *   - outros                     → zera */
  private sincronizarCronometro(j: {
    status?: string;
    iniciadoEm?: { toMillis?: () => number };
    tempoAtualIniciadoEm?: { toMillis?: () => number };
    tempoPausado?: boolean;
    tempoPausadoSegundos?: number;
  } | undefined): void {
    if (!j) {
      this.pararCronometro();
      this.tempoDecorrido.set('00:00');
      this.minutosDecorridos.set(0);
      return;
    }
    const baseMs =
      j.tempoAtualIniciadoEm?.toMillis?.() ??
      j.iniciadoEm?.toMillis?.() ??
      0;

    // PAUSADO: relógio congelado no valor `tempoPausadoSegundos`.
    // O setInterval é desligado e o display é setado uma vez.
    if (j.status === 'em-andamento' && j.tempoPausado) {
      this.pararCronometro();
      const segs = j.tempoPausadoSegundos ?? 0;
      this.atualizarTempoPorSegundos(segs);
      return;
    }

    if (j.status === 'em-andamento' && baseMs > 0) {
      this.iniciarCronometro(baseMs);
    } else {
      this.pararCronometro();
      if (j.status === 'encerrado' && baseMs > 0) {
        // Mostra a duração final (relógio congelado).
        this.atualizarTempo(baseMs, Date.now());
      } else {
        this.tempoDecorrido.set('00:00');
        this.minutosDecorridos.set(0);
      }
    }
  }

  /** Pinta o display a partir de um total de segundos (sem precisar do
   *  par baseMs/agoraMs). Usado quando o cronômetro está pausado. */
  private atualizarTempoPorSegundos(totalSec: number): void {
    const mm = Math.floor(totalSec / 60);
    const ss = Math.floor(totalSec) % 60;
    this.tempoDecorrido.set(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
    this.minutosDecorridos.set(mm);
  }

  private iniciarCronometro(iniciadoMs: number): void {
    this.pararCronometro();
    // Tick imediato pra evitar o "00:00" piscando.
    this.atualizarTempo(iniciadoMs, Date.now());
    this.timerHandle = setInterval(() => {
      this.atualizarTempo(iniciadoMs, Date.now());
    }, 1000);
  }

  private pararCronometro(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = undefined;
    }
  }

  private atualizarTempo(iniciadoMs: number, agoraMs: number): void {
    const totalSec = Math.max(0, Math.floor((agoraMs - iniciadoMs) / 1000));
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    this.tempoDecorrido.set(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
    this.minutosDecorridos.set(mm);
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogos',
    ]);
  }

  irPara(jogoId: string): void {
    if (jogoId === this.jogoId) return;
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      jogoId,
    ]);
  }

  irParaJogos(): void {
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogos',
    ]);
  }

  /** Abre a tela de edição de resultado (gols, cartões, lances). */
  editarResultado(): void {
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      this.jogoId,
      'editar',
    ]);
  }

  /** Abre a tela de transmissão (player YouTube + placar overlay). */
  abrirTransmissao(): void {
    // Abre direto — sem tutorial. A tela `/transmissao` é responsável
    // por mostrar a UX em tela cheia simulada quando aplicável.
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      this.jogoId,
      'transmissao',
    ]);
  }

  /**
   * Monta a URL PÚBLICA da transmissão. Esse link funciona pra qualquer
   * pessoa (sem login) — rota `/transmissao/:campId/:catId/:jogoId`,
   * tratada como pública no authGuard.
   */
  private montarLinkPublicoTransmissao(): string {
    const origin = (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '');
    return `${origin}/transmissao/${this.campeonatoId}/${this.categoriaId}/${this.jogoId}`;
  }

  /**
   * Compartilha o link da transmissão via Web Share API (nativo do
   * sistema — abre opções de WhatsApp, Telegram, etc.). Fallback pra
   * copiar no clipboard se o browser não suportar Web Share.
   */
  async compartilharLinkTransmissao(): Promise<void> {
    const url = this.montarLinkPublicoTransmissao();
    const titulo = 'Transmissão ao vivo';
    // Tenta puxar nome dos times via firstValueFrom no observable jogo$;
    // se falhar (ex: jogo ainda carregando), usa texto genérico.
    let texto = 'Assista ao vivo no PlacarPro';
    try {
      const { firstValueFrom } = await import('rxjs');
      const j = await firstValueFrom(this.jogo$);
      if (j) {
        texto = `Acompanhe ao vivo: ${j.nomeMandante} x ${j.nomeVisitante}`;
      }
    } catch { /* mantém texto genérico */ }

    // Tem Web Share API? (mobile + alguns desktops)
    const navAny = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (navAny.share) {
      try {
        await navAny.share({ title: titulo, text: texto, url });
        return;
      } catch (err) {
        // User cancelou — não mostra erro nem fallback (UX silenciosa).
        const code = (err as { name?: string })?.name ?? '';
        if (code === 'AbortError') return;
        console.warn('[JogoDetalhe] navigator.share falhou, caindo no fallback', err);
      }
    }

    // Fallback: copia o link
    await this.copiarLinkTransmissao();
  }

  /**
   * Copia o link público da transmissão pro clipboard. Mostra toast
   * de confirmação. Tem fallback pro caso do navegador não suportar
   * a Clipboard API (ex: iOS Safari < 13.4 fora de HTTPS).
   */
  async copiarLinkTransmissao(): Promise<void> {
    const url = this.montarLinkPublicoTransmissao();
    let copiou = false;

    // 1) Clipboard API moderno (HTTPS only)
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copiou = true;
      } catch (err) {
        console.warn('[JogoDetalhe] clipboard.writeText falhou', err);
      }
    }

    // 2) Fallback: textarea + execCommand (browsers antigos / iOS Safari)
    if (!copiou && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copiou = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch (err) {
        console.warn('[JogoDetalhe] fallback execCommand falhou', err);
      }
    }

    const toast = await this.toastCtrl.create({
      message: copiou ? '🔗 Link copiado!' : 'Não foi possível copiar. Tente compartilhar.',
      duration: 1800,
      position: 'top',
      color: copiou ? 'success' : 'danger',
    });
    await toast.present();
  }


  /**
   * Abre o modal de BROADCASTER LiveKit DIRETO — preview de câmera +
   * botão "INICIAR TRANSMISSÃO" + flip frontal/traseira.
   *
   * Antes navegava pra /transmissao e o usuário tinha que clicar de
   * novo "TRANSMITIR COM MINHA CÂMERA" lá dentro. Eliminamos esse
   * passo intermediário a pedido do usuário — clique único na CÂMERA
   * já abre o modal pronto pra começar a transmitir.
   *
   * Quando o admin confirma "INICIAR", o doc Firestore é criado com
   * `ativa: true` → o painel ao vivo desta mesma tela detecta via
   * `transmissaoLiveAtiva$` e mostra o player no lugar do YouTube.
   */
  async iniciarTransmissaoLive(): Promise<void> {
    // ── iOS Safari não-PWA: BLOQUEIA o modal de câmera ──
    // Em iOS Safari sem PWA instalado, transmitir não vale a pena
    // (sem fullscreen real). Em vez de abrir o modal, mostramos APENAS
    // o tutorial-modal ensinando a instalar como PWA. Depois de instalar
    // e abrir pelo ícone, ele cai já nesta tela em PWA standalone e
    // pode clicar em "Transmitir agora" pra abrir o modal normal.
    if (precisaTutorialPwaIos()) {
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
      marcarTutorialPwaVisto();
      return; // NÃO segue pra abrir modal de câmera
    }

    // Outros browsers (Android Chrome, PWA, Capacitor, desktop):
    // mostra prompt nativo de install (se houver) e abre o modal.
    await this.pwaInstall.mostrarPromptSeRelevante();

    const dados = await this.carregarJogoComEquipes();
    const rotulo = dados
      ? `${dados.mandante.nome ?? '?'} x ${dados.visitante.nome ?? '?'}`
      : 'Transmissão ao vivo';
    const modal = await this.modalCtrl.create({
      component: TransmissaoModalComponent,
      backdropDismiss: false,
      componentProps: {
        jogoId: this.jogoId,
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        rotulo,
      },
    });
    await modal.present();
  }

  async abrirMenu(ev: Event): Promise<void> {
    ev.stopPropagation();
    const sheet = await this.actionCtrl.create({
      header: 'Ações da partida',
      buttons: [
        {
          text: 'Editar informações',
          icon: 'create-outline',
          handler: () => { void this.editarInformacoes(); },
        },
        {
          text: 'Editar resultado',
          icon: 'football-outline',
          handler: () => { this.editarResultado(); },
        },
        {
          text: 'Selecionar equipes',
          icon: 'shield-half-outline',
          handler: () => { void this.emBreve('Selecionar equipes'); },
        },
        {
          text: 'Restaurar para agendado',
          icon: 'refresh-outline',
          handler: () => { void this.restaurar(); },
        },
        {
          text: 'Remover',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => { void this.remover(); },
        },
        { text: 'Cancelar', icon: 'close-outline', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  async editarInformacoes(): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const modal = await this.modalCtrl.create({
      component: EditarInformacoesModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogo,
      },
      cssClass: 'modal-editar-info',
      backdropDismiss: true,
    });
    await modal.present();
  }

  async restaurar(): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const status: JogoStatus = 'agendado';
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id, {
        status,
        golsMandante: null,
        golsVisitante: null,
      });
      await this.toast('Partida restaurada para agendada.', 'success');
    } catch (err) {
      console.error('[JogoDetalhe] restaurar erro', err);
      await this.toast('Erro ao restaurar.', 'danger');
    }
  }

  async remover(): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover partida?',
      message: `${jogo.nomeMandante} × ${jogo.nomeVisitante} será removido.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.jogosSrv.remover(this.campeonatoId, this.categoriaId, jogo.id!);
              this.voltar();
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async editarEscalacao(lado: 'mandante' | 'visitante'): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const equipeId = lado === 'mandante' ? jogo.mandanteId : jogo.visitanteId;
    const equipeNome = lado === 'mandante' ? jogo.nomeMandante : jogo.nomeVisitante;
    const equipeLogoUrl = lado === 'mandante' ? jogo.logoMandante : jogo.logoVisitante;
    const modal = await this.modalCtrl.create({
      component: EscalacaoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogoId: jogo.id,
        equipeId,
        equipeNome,
        equipeLogoUrl: equipeLogoUrl ?? '',
      },
      cssClass: 'modal-escalacao',
      backdropDismiss: true,
    });
    await modal.present();
  }

  trackByEscalado(_i: number, e: JogadorEscalado): string {
    return e.jogador.id ?? '';
  }

  /**
   * Busca jogo + equipes em paralelo, sem depender do startWith([]) interno.
   * Retorna null se uma das equipes não estiver atribuída ao jogo.
   */
  private async carregarJogoComEquipes(): Promise<
    { jogo: Jogo; mandante: Equipe; visitante: Equipe } | null
  > {
    const [jogo, equipes] = await Promise.all([
      firstValueFrom(
        this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
      ),
      firstValueFrom(
        this.equipesSrv.list$(this.campeonatoId, this.categoriaId),
      ),
    ]);
    if (!jogo?.id) return null;
    const m = equipes.find(e => e.id === jogo.mandanteId);
    const v = equipes.find(e => e.id === jogo.visitanteId);
    if (!m || !v) return null;
    return { jogo, mandante: m, visitante: v };
  }

  async adicionarLance(
    lado: 'mandante' | 'visitante' = 'mandante',
    tipo: EventoTipo = 'gol',
  ): Promise<void> {
    const dados = await this.carregarJogoComEquipes();
    if (!dados) {
      await this.toast('Defina as duas equipes antes de adicionar lances.', 'danger');
      return;
    }
    if (dados.jogo.status !== 'em-andamento') {
      await this.confirmarIniciarPartida(dados.jogo.status);
      return;
    }
    // Pré-preenche o minuto (cronômetro atual) e o tempo/período (1ºT,
    // 2ºT etc) automaticamente quando a partida está em andamento.
    // O modal mostra o minuto editável; o tempo vai como metadado.
    const minutoAtual = this.minutosDecorridos();
    const tempoAtual = dados.jogo.tempoAtual;
    const modal = await this.modalCtrl.create({
      component: EventoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogoId: dados.jogo.id,
        mandante: dados.mandante,
        visitante: dados.visitante,
        ladoPadrao: lado,
        tipoPadrao: tipo,
        minutoSugerido: minutoAtual > 0 ? minutoAtual : null,
        tempoSugerido: tempoAtual,
      },
      cssClass: 'modal-evento',
      backdropDismiss: true,
    });
    await modal.present();
  }

  /** Confirma se deve marcar partida como em-andamento antes de adicionar lance. */
  private async confirmarIniciarPartida(statusAtual: JogoStatus): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Partida não está em andamento',
      message:
        statusAtual === 'encerrado'
          ? 'Esta partida já foi encerrada. Para registrar lances, reabra (status: Em andamento).'
          : 'Inicie a partida (Em andamento) antes de registrar lances.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Iniciar partida',
          handler: async () => {
            await this.iniciarPartida();
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Marca a partida como em-andamento + define o tempo inicial.
   *
   * Quando chamado pela primeira vez (status='agendado'):
   *  - status → 'em-andamento'
   *  - tempoAtual → 'primeiro'
   *  - tempoAtualIniciadoEm → agora (cronômetro começa do 00:00)
   *  - iniciadoEm → agora (se ainda não tinha) — referência geral
   *  - duracaoPeriodoMin → mantém ou aplica default 45 se faltar
   *  - acrescimoAtualMin → 0
   *
   * Quando chamado em jogo encerrado: reabre + reseta cronômetro
   * (mas mantém o `iniciadoEm` original como histórico).
   */
  async iniciarPartida(): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;
    try {
      const agora = Timestamp.now();
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id, {
        status: 'em-andamento',
        tempoAtual: 'primeiro',
        tempoAtualIniciadoEm: agora,
        iniciadoEm: jogo.iniciadoEm ?? agora,
        duracaoPeriodoMin: jogo.duracaoPeriodoMin ?? 45,
        acrescimoAtualMin: 0,
      });
      await this.toast('Partida iniciada.', 'success');
    } catch (err) {
      console.error('[JogoDetalhe] iniciar erro', err);
      await this.toast('Erro ao iniciar partida.', 'danger');
    }
  }

  /**
   * Troca o tempo atual da partida (1ºT → INT → 2ºT → PROR → PEN → FIM).
   * Reseta o cronômetro pra 00:00 e zera acréscimos do período anterior.
   * Se o destino for `null` (Fim), encerra a partida.
   */
  async trocarTempo(tempo: TempoJogoNome | null): Promise<void> {
    if (tempo === null) {
      await this.encerrarPartida();
      return;
    }
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogoId, {
        tempoAtual: tempo,
        tempoAtualIniciadoEm: Timestamp.now(),
        acrescimoAtualMin: 0,
      });
    } catch (err) {
      console.error('[JogoDetalhe] trocarTempo erro', err);
      await this.toast('Falha ao trocar tempo.', 'danger');
    }
  }

  /**
   * Abre seletor de duração do período (15/20/25/30/35/40/45). A escolha
   * é aplicada AO TEMPO ATUAL e seguintes — não muda o que já passou.
   */
  async definirDuracao(): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;
    const opcoes = [15, 20, 25, 30, 35, 40, 45];
    const atual = jogo.duracaoPeriodoMin ?? 45;
    const alert = await this.alertCtrl.create({
      header: 'Duração de cada tempo',
      message: 'Quantos minutos tem cada tempo da partida?',
      inputs: opcoes.map(n => ({
        type: 'radio',
        label: `${n} min${n === 45 ? ' (oficial)' : ''}`,
        value: String(n),
        checked: n === atual,
      })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (valor: string) => {
            const min = Number(valor);
            if (!min || min < 1) return;
            try {
              await this.jogosSrv.atualizar(
                this.campeonatoId, this.categoriaId, this.jogoId,
                { duracaoPeriodoMin: min },
              );
              await this.toast(`Duração: ${min} min por tempo.`, 'success');
            } catch { await this.toast('Falha ao salvar.', 'danger'); }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Pausa ou retoma o cronômetro do tempo atual.
   *
   * - Pausar: salva `tempoPausadoSegundos = agora - tempoAtualIniciadoEm`
   *   e marca `tempoPausado = true`. O cronômetro congela.
   * - Retomar: calcula novo `tempoAtualIniciadoEm = agora - segundos
   *   acumulados`. Assim o relógio retoma do mesmo MM:SS em que parou,
   *   sem perder tempo nem ganhar.
   *
   * Útil em paradas técnicas, atendimento médico, briga etc.
   */
  async togglePausa(): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;
    const agoraMs = Date.now();
    const baseMs = jogo.tempoAtualIniciadoEm?.toMillis?.() ?? agoraMs;
    try {
      if (jogo.tempoPausado) {
        // RETOMAR — recua o tempoAtualIniciadoEm pelos segundos já
        // decorridos, preservando o MM:SS atual.
        const acumuladoSeg = jogo.tempoPausadoSegundos ?? 0;
        const novoInicioMs = agoraMs - acumuladoSeg * 1000;
        await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id, {
          tempoPausado: false,
          tempoAtualIniciadoEm: Timestamp.fromMillis(novoInicioMs),
        });
      } else {
        // PAUSAR — congela o relógio salvando os segundos decorridos.
        const decorridosSeg = Math.max(0, Math.floor((agoraMs - baseMs) / 1000));
        await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id, {
          tempoPausado: true,
          tempoPausadoSegundos: decorridosSeg,
        });
      }
    } catch (err) {
      console.error('[JogoDetalhe] togglePausa erro', err);
      await this.toast('Falha ao alternar pausa.', 'danger');
    }
  }

  /**
   * Permite o admin EDITAR o tempo decorrido do cronômetro manualmente
   * (clicando no MM:SS no live-head). Útil quando o admin esqueceu de
   * dar play no início, ou quando precisa corrigir o tempo após um
   * problema na partida.
   *
   * Estratégia:
   *  - Pede MM:SS em um alert prompt (formato livre: "12:34" ou só "12").
   *  - Recalcula `tempoAtualIniciadoEm = agora - MM:SS em ms`.
   *  - Se está PAUSADO, atualiza `tempoPausadoSegundos` ao invés
   *    (pra manter o relógio congelado no novo valor).
   */
  async editarTempoDecorrido(): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;

    // Pré-preenche com o tempo atual (mm:ss).
    const valorAtual = this.tempoDecorrido();

    const alert = await this.alertCtrl.create({
      header: 'Editar tempo',
      message: 'Digite o tempo no formato MM:SS (ex: 12:34) ou só minutos (ex: 12)',
      inputs: [
        {
          name: 'tempo',
          type: 'text',
          placeholder: '00:00',
          value: valorAtual,
          attributes: {
            inputmode: 'text',
            autocomplete: 'off',
            maxlength: 5,
          },
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data) => {
            const raw = (data?.tempo as string ?? '').trim();
            const parsed = this.parseTempoMmSs(raw);
            if (parsed === null) {
              await this.toast(
                'Tempo inválido. Use MM:SS (ex: 12:34) ou só minutos.',
                'danger',
              );
              return false; // mantém alert aberto
            }
            await this.aplicarNovoTempoDecorrido(parsed);
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Converte string "MM:SS" ou "MM" pra total de segundos.
   * Aceita formatos: "12", "12:34", "1:2" etc. Retorna `null` se inválido.
   */
  private parseTempoMmSs(raw: string): number | null {
    if (!raw) return null;
    // Aceita só dígitos e dois-pontos.
    if (!/^\d{1,3}(:\d{1,2})?$/.test(raw)) return null;
    const partes = raw.split(':');
    const mm = parseInt(partes[0], 10);
    const ss = partes.length > 1 ? parseInt(partes[1], 10) : 0;
    if (isNaN(mm) || isNaN(ss) || mm < 0 || ss < 0 || ss > 59) return null;
    return mm * 60 + ss;
  }

  /**
   * Aplica o novo tempo decorrido no Firestore — recalcula a base do
   * cronômetro (`tempoAtualIniciadoEm`) ou atualiza `tempoPausadoSegundos`
   * conforme o estado atual da partida.
   */
  private async aplicarNovoTempoDecorrido(novoTotalSeg: number): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;

    try {
      if (jogo.tempoPausado) {
        // Pausado: congelado no novo valor.
        await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id, {
          tempoPausadoSegundos: novoTotalSeg,
        });
      } else {
        // Em andamento: define `tempoAtualIniciadoEm = agora - novoTotal`.
        // Resultado: cronômetro continua contando, mas a partir do novo valor.
        const agoraMs = Date.now();
        const novoInicioMs = agoraMs - novoTotalSeg * 1000;
        await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id, {
          tempoAtualIniciadoEm: Timestamp.fromMillis(novoInicioMs),
        });
      }
      await this.toast(`Tempo ajustado pra ${Math.floor(novoTotalSeg / 60)}:${String(novoTotalSeg % 60).padStart(2, '0')}.`, 'success');
    } catch (err) {
      console.error('[JogoDetalhe] editar tempo erro', err);
      await this.toast('Falha ao salvar novo tempo.', 'danger');
    }
  }

  /**
   * Adiciona N minutos de acréscimo ao tempo atual. Acumulativo —
   * passar `1` aumenta em 1, passar `-1` diminui. Não vai abaixo de 0.
   */
  async ajustarAcrescimo(delta: number): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;
    const atual = jogo.acrescimoAtualMin ?? 0;
    const novo = Math.max(0, atual + delta);
    if (novo === atual) return;
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogoId, {
        acrescimoAtualMin: novo,
      });
    } catch (err) {
      console.error('[JogoDetalhe] acréscimo erro', err);
      await this.toast('Falha ao registrar acréscimo.', 'danger');
    }
  }

  /** Label curta pra exibir nos cards de lance ("1ºT", "INT", "2ºT"...). */
  labelTempoCurto(t: TempoJogoNome | undefined | null): string {
    switch (t) {
      case 'primeiro':    return '1ºT';
      case 'intervalo':   return 'INT';
      case 'segundo':     return '2ºT';
      case 'prorrog-1':   return 'PROR 1';
      case 'prorrog-int': return 'INT PR';
      case 'prorrog-2':   return 'PROR 2';
      case 'penaltis':    return 'PEN';
      default:            return '';
    }
  }

  /** Label legível pra cada tempo. */
  labelTempo(t: TempoJogoNome | undefined | null): string {
    switch (t) {
      case 'primeiro':    return '1º Tempo';
      case 'intervalo':   return 'Intervalo';
      case 'segundo':     return '2º Tempo';
      case 'prorrog-1':   return 'Prorrog. 1º';
      case 'prorrog-int': return 'Interv. Prorrog.';
      case 'prorrog-2':   return 'Prorrog. 2º';
      case 'penaltis':    return 'Pênaltis';
      default:            return '—';
    }
  }

  /** Tempos disponíveis pra trocar — usado no segmented. */
  readonly tempos: ReadonlyArray<{ id: TempoJogoNome; label: string; curto: string }> = [
    { id: 'primeiro',    label: '1º Tempo',         curto: '1ºT' },
    { id: 'intervalo',   label: 'Intervalo',        curto: 'INT' },
    { id: 'segundo',     label: '2º Tempo',         curto: '2ºT' },
    { id: 'prorrog-1',   label: 'Prorrog. 1º',      curto: 'PROR 1' },
    { id: 'prorrog-int', label: 'Interv. Prorrog.', curto: 'INT PR' },
    { id: 'prorrog-2',   label: 'Prorrog. 2º',      curto: 'PROR 2' },
    { id: 'penaltis',    label: 'Pênaltis',         curto: 'PEN' },
  ];

  /** Marca a partida como encerrada (depois de registrar todos os lances). */
  async encerrarPartida(): Promise<void> {
    const jogo = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId),
    );
    if (!jogo?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Encerrar partida?',
      message: 'O resultado atual será fixado e a partida deixará de aceitar novos lances.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Encerrar',
          handler: async () => {
            try {
              await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogo.id!, {
                status: 'encerrado',
              });
              await this.toast('Partida encerrada.', 'success');
            } catch {
              await this.toast('Erro ao encerrar.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async editarLance(e: EventoView): Promise<void> {
    const dados = await this.carregarJogoComEquipes();
    if (!dados) {
      await this.toast('Defina as equipes antes de editar lances.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: EventoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogoId: dados.jogo.id,
        mandante: dados.mandante,
        visitante: dados.visitante,
        eventoExistente: e,
      },
      cssClass: 'modal-evento',
      backdropDismiss: true,
    });
    await modal.present();
  }

  labelTipo(t: EventoTipo): string {
    switch (t) {
      case 'gol': return 'GOOL!';
      case 'gol-contra': return 'GOL CONTRA';
      case 'amarelo': return 'CARTÃO AMARELO';
      case 'vermelho': return 'CARTÃO VERMELHO';
      case 'azul': return 'CARTÃO AZUL';
      case 'falta': return 'FALTA';
      case 'defesa': return 'DEFESA';
      case 'sub-entrou': return 'ENTROU';
      case 'sub-saiu': return 'SAIU';
      case 'pen-convertido': return 'PÊNALTI CONVERTIDO';
      case 'pen-perdido': return 'PÊNALTI PERDIDO';
      case 'pen-defendido': return 'PÊNALTI DEFENDIDO';
    }
  }

  iconeTipo(t: EventoTipo): string {
    switch (t) {
      case 'gol':
      case 'gol-contra':
        return 'football-outline';
      case 'amarelo':
      case 'vermelho':
      case 'azul':
        return 'square';
      case 'falta':
        return 'hand-left-outline';
      case 'defesa':
        return 'hand-right-outline';
      case 'sub-entrou':
      case 'sub-saiu':
        return 'swap-horizontal-outline';
      case 'pen-convertido':
        return 'football';
      case 'pen-perdido':
      case 'pen-defendido':
        return 'close-circle-outline';
    }
  }

  classeTipo(t: EventoTipo): string {
    switch (t) {
      case 'gol': return 'tipo-gol';
      case 'gol-contra': return 'tipo-gol-contra';
      case 'amarelo': return 'tipo-amarelo';
      case 'vermelho': return 'tipo-vermelho';
      case 'azul': return 'tipo-azul';
      case 'falta': return 'tipo-falta';
      case 'defesa': return 'tipo-defesa';
      default: return 'tipo-sub';
    }
  }

  trackByEvento(_i: number, e: EventoView): string {
    return e.id ?? '';
  }

  private async emBreve(label: string): Promise<void> {
    await this.toast(`"${label}" em desenvolvimento.`, 'medium');
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'top',
      color,
    });
    await t.present();
  }

  rotuloStatus(j: JogoView): string {
    switch (j.status) {
      case 'encerrado': return 'Encerrado';
      case 'em-andamento': return 'Em andamento';
      case 'cancelado': return 'Cancelado';
      case 'wo': return 'W.O.';
      default: return 'Agendado';
    }
  }

  trackByJogo(_i: number, j: JogoView): string {
    return j.id ?? '';
  }

  /** Formata "2026-05-10T15:30" → "10/05/2026 15:30". Devolve original se inválido. */
  formatarDataBr(iso?: string | null): string {
    if (!iso) return '';
    return dataHoraIsoParaBr(iso) || iso;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CRONÔMETRO — Pausar / Retomar
  // ───────────────────────────────────────────────────────────────────────
  //  Pra parada técnica, atendimento médico, briga, etc. Diferente de
  //  trocar de tempo (1ºT → INT), aqui o tempo continua sendo do MESMO
  //  período — só congelado.
  //
  //  Implementação:
  //   - PAUSAR: grava `tempoPausado: true` + `tempoPausadoSegundos` (offset
  //     atual em segundos). UI congela no valor.
  //   - RETOMAR: recalcula `tempoAtualIniciadoEm` recuado pra preservar
  //     os segundos decorridos (cronômetro continua de onde parou),
  //     limpa as flags. Reativa o setInterval.
  // ═══════════════════════════════════════════════════════════════════════

  async pausarTempo(): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id || jogo.tempoPausado) return;
    const baseMs =
      (jogo.tempoAtualIniciadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ??
      (jogo.iniciadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ??
      0;
    if (!baseMs) {
      await this.toast('Partida ainda não foi iniciada.', 'medium');
      return;
    }
    const segs = Math.max(0, Math.floor((Date.now() - baseMs) / 1000));
    try {
      await this.jogosSrv.atualizar(
        this.campeonatoId, this.categoriaId, jogo.id,
        {
          tempoPausado: true,
          tempoPausadoSegundos: segs,
        },
      );
      await this.toast('Cronômetro pausado.', 'success');
    } catch (err) {
      console.error('[JogoDetalhe] pausarTempo erro', err);
      await this.toast('Falha ao pausar.', 'danger');
    }
  }

  async retomarTempo(): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id || !jogo.tempoPausado) return;
    const segs = jogo.tempoPausadoSegundos ?? 0;
    // Novo `tempoAtualIniciadoEm` = agora - segundos já decorridos.
    // Assim o cronômetro continua de onde parou em vez de zerar.
    const novoInicioMs = Date.now() - segs * 1000;
    try {
      await this.jogosSrv.atualizar(
        this.campeonatoId, this.categoriaId, jogo.id,
        {
          tempoPausado: false,
          tempoPausadoSegundos: 0,
          tempoAtualIniciadoEm: Timestamp.fromMillis(novoInicioMs),
        },
      );
      await this.toast('Cronômetro retomado.', 'success');
    } catch (err) {
      console.error('[JogoDetalhe] retomarTempo erro', err);
      await this.toast('Falha ao retomar.', 'danger');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PÊNALTIS — seleção do jogador cobrador (estado local)
  // ───────────────────────────────────────────────────────────────────────
  //  Bindados via `[(ngModel)]` aos `<select>` no painel de pênaltis.
  //  Após cobrar, o select volta pra "" pra evitar que a próxima cobrança
  //  herde o jogador errado por engano. Cobrança SEM jogador selecionado
  //  ainda funciona (jogadorId fica undefined no evento).
  // ═══════════════════════════════════════════════════════════════════════
  penJogadorMandanteId = '';
  penJogadorVisitanteId = '';

  // ═══════════════════════════════════════════════════════════════════════
  //  PÊNALTIS — Decisão por penalidades
  // ───────────────────────────────────────────────────────────────────────
  //  Cada cobrança vira um evento (`pen-convertido` / `pen-perdido` /
  //  `pen-defendido`) gravado em `eventos` do jogo. Os campos
  //  `penaltisMandante` e `penaltisVisitante` no doc do jogo são
  //  recalculados a cada cobrança pra exibir o placar de pênaltis sem
  //  precisar carregar a lista de eventos toda vez.
  //
  //  Regras automáticas:
  //   - Alternância: mandante cobra → visitante cobra → mandante → ...
  //   - 5 cobranças por lado nas regulares; se empatado, sudden death
  //     (1 cobrança por lado por vez até alguém ficar à frente).
  // ═══════════════════════════════════════════════════════════════════════

  /** Filtra os eventos de pênalti de uma equipe e devolve a sequência de
   *  resultados ('c' = convertido, 'p' = perdido, 'd' = defendido). */
  cobrancasPen(eventos: EventoJogo[] | null | undefined, equipeId: string | undefined):
    Array<'c' | 'p' | 'd'> {
    if (!eventos || !equipeId) return [];
    return eventos
      .filter(e => e.equipeId === equipeId
        && (e.tipo === 'pen-convertido'
            || e.tipo === 'pen-perdido'
            || e.tipo === 'pen-defendido'))
      .sort((a, b) => {
        // criadoEm pode não estar disponível (criação local) — fallback
        // pra ordem original (estável o suficiente pra UX).
        const ta = (a.criadoEm as { seconds?: number } | undefined)?.seconds ?? 0;
        const tb = (b.criadoEm as { seconds?: number } | undefined)?.seconds ?? 0;
        return ta - tb;
      })
      .map(e => e.tipo === 'pen-convertido' ? 'c'
                : e.tipo === 'pen-perdido' ? 'p'
                : 'd');
  }

  /** Quem deve cobrar agora — alterna mandante/visitante. Mandante
   *  começa por padrão; depois quem tem MENOS cobranças vai. Empate
   *  em quantidade = alterna por paridade. */
  proximoCobradorPen(
    eventos: EventoJogo[] | null | undefined,
    mandanteId: string | undefined,
    visitanteId: string | undefined,
  ): 'mandante' | 'visitante' {
    const m = this.cobrancasPen(eventos, mandanteId).length;
    const v = this.cobrancasPen(eventos, visitanteId).length;
    // Mandante cobra primeiro; ele só "passa a vez" quando já cobrou
    // mais que o visitante. Se m === v, é vez do mandante.
    return m <= v ? 'mandante' : 'visitante';
  }

  /** Soma de penaltis convertidos por equipe (placar de pênaltis). */
  placarPen(eventos: EventoJogo[] | null | undefined, equipeId: string | undefined): number {
    return this.cobrancasPen(eventos, equipeId).filter(r => r === 'c').length;
  }

  /**
   * Versão detalhada de cobrancasPen — retorna os EVENTOS completos
   * (com jogadorId) ordenados cronologicamente. Usado pra renderizar
   * histórico rico (nome do jogador + nº da cobrança + resultado).
   */
  cobrancasPenDetalhe(
    eventos: EventoJogo[] | null | undefined,
    equipeId: string | undefined,
  ): EventoJogo[] {
    if (!eventos || !equipeId) return [];
    return eventos
      .filter(e => e.equipeId === equipeId
        && (e.tipo === 'pen-convertido'
            || e.tipo === 'pen-perdido'
            || e.tipo === 'pen-defendido'))
      .sort((a, b) => {
        const ta = (a.criadoEm as { seconds?: number } | undefined)?.seconds ?? 0;
        const tb = (b.criadoEm as { seconds?: number } | undefined)?.seconds ?? 0;
        return ta - tb;
      });
  }

  /** Nome do jogador (ou apelido) pra exibir no histórico de pênaltis.
   *  Retorna `null` se não tiver jogadorId ou se não achar o jogador. */
  nomeJogadorPen(jogadorId: string | undefined): string | null {
    if (!jogadorId) return null;
    // Busca em jogadores das duas equipes (carregados no signal/observable)
    const j = this._jogadoresCache.find(x => x.id === jogadorId);
    if (!j) return null;
    return j.apelido || j.nome || null;
  }
  /** Cache local de jogadores pra lookup rápido no histórico de pênaltis. */
  private _jogadoresCache: Jogador[] = [];

  /**
   * Decide se a decisão por pênaltis já ACABOU matematicamente:
   *  - Best-of-N (cada time tem até N cobranças — configurado em
   *     `jogo.serieMaximaPenaltis`, default 5):
   *     se um time tem mais convertidos do que o outro pode ainda alcançar
   *     mesmo convertendo todas restantes — acabou.
   *  - Sudden death (após NxN igual): se ambos cobraram o mesmo nº E um
   *     converteu e o outro errou na última rodada — acabou.
   *
   * Retorna `'mandante' | 'visitante' | null` (null = ainda em decisão).
   */
  vencedorPenaltis(
    eventos: EventoJogo[] | null | undefined,
    mandanteId: string | undefined,
    visitanteId: string | undefined,
    serieMax = 5,
  ): 'mandante' | 'visitante' | null {
    if (!mandanteId || !visitanteId) return null;
    const cM = this.cobrancasPen(eventos, mandanteId);
    const cV = this.cobrancasPen(eventos, visitanteId);
    const golsM = cM.filter(r => r === 'c').length;
    const golsV = cV.filter(r => r === 'c').length;
    const totalM = cM.length;
    const totalV = cV.length;
    const SERIE = Math.max(1, serieMax);

    // Fase de SUDDEN DEATH (após N cobranças cada lado)
    if (totalM > SERIE || totalV > SERIE) {
      if (totalM === totalV && totalM > SERIE && golsM !== golsV) {
        return golsM > golsV ? 'mandante' : 'visitante';
      }
      return null;
    }

    // Fase de BEST-OF-N — fim antecipado se um time já não tem como
    // ser alcançado mesmo convertendo todas as cobranças restantes.
    const faltaM = SERIE - totalM;
    const faltaV = SERIE - totalV;
    if (golsM > golsV + faltaV) return 'mandante';
    if (golsV > golsM + faltaM) return 'visitante';
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PATROCINADORES DA PARTIDA
  // ───────────────────────────────────────────────────────────────────────
  //  Sponsors específicos desta partida (logo + nome). Aparecem na esteira
  //  de banners da transmissão ao vivo. Admin pode adicionar, visualizar
  //  e remover — sem afetar os patrocinadores globais do organizador.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Abre o modal de novo/editar patrocinador da partida.
   * Recebe `idx = -1` para novo, ou o índice do item para edição.
   */
  async adicionarPatrocinadorJogo(idx = -1): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;

    const modal = await this.modalCtrl.create({
      component: PatrocinadorJogoModalComponent,
      componentProps: {
        campeonatoId:   this.campeonatoId,
        categoriaId:    this.categoriaId,
        jogoId:         jogo.id,
        patrocinadores: [...(jogo.patrocinadores ?? [])],
        idx,
      },
      cssClass: 'modal-patrocinador-jogo',
      backdropDismiss: true,
    });
    await modal.present();
  }

  /** Remove um patrocinador pelo índice, com confirmação. */
  async removerPatrocinadorJogo(idx: number): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const pats = [...(jogo.patrocinadores ?? [])];
    const pat  = pats[idx];
    if (!pat) return;

    const alert = await this.alertCtrl.create({
      header: 'Remover patrocinador?',
      message: `"${pat.nome}" será removido desta partida.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            pats.splice(idx, 1);
            try {
              await this.jogosSrv.atualizar(
                this.campeonatoId, this.categoriaId, jogo.id!,
                { patrocinadores: pats },
              );
              await this.toast('Patrocinador removido.', 'success');
            } catch {
              await this.toast('Erro ao remover patrocinador.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** True se a decisão por pênaltis já tem vencedor matemático. */
  decisaoPenaltisAcabou(
    eventos: EventoJogo[] | null | undefined,
    mandanteId: string | undefined,
    visitanteId: string | undefined,
    serieMax = 5,
  ): boolean {
    return this.vencedorPenaltis(eventos, mandanteId, visitanteId, serieMax) !== null;
  }

  /**
   * Abre prompt pra configurar quantas cobranças por lado a decisão
   * usa antes da morte súbita (best-of-N). Salva em
   * `jogo.serieMaximaPenaltis`. Opções: 3, 5 (padrão), 7, 10.
   */
  async configurarSeriePenaltis(jogoAtual: JogoView): Promise<void> {
    if (!jogoAtual.id) return;
    const atual = jogoAtual.serieMaximaPenaltis || 5;
    const alert = await this.alertCtrl.create({
      header: 'Cobranças por lado',
      message: 'Quantidade de cobranças que cada time pode bater antes da morte súbita.',
      inputs: [
        { type: 'radio', label: '3 cobranças', value: 3, checked: atual === 3 },
        { type: 'radio', label: '5 cobranças (padrão FIFA)', value: 5, checked: atual === 5 },
        { type: 'radio', label: '7 cobranças', value: 7, checked: atual === 7 },
        { type: 'radio', label: '10 cobranças', value: 10, checked: atual === 10 },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (val: number) => {
            if (!val || val === atual) return;
            try {
              await this.jogosSrv.atualizar(
                this.campeonatoId, this.categoriaId, jogoAtual.id!,
                { serieMaximaPenaltis: val },
              );
            } catch (err) {
              console.error('[Pen] configurarSerie erro', err);
              this.toast('Falha ao salvar configuração.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Registra uma cobrança de pênalti. Adiciona o evento + atualiza
   *  `penaltisMandante`/`penaltisVisitante` no doc do jogo. O jogador
   *  é OPCIONAL — quando informado, é gravado pra aparecer no histórico
   *  (timeline, tooltips, lista de cobranças). */
  async cobrarPenalti(
    jogo: JogoView,
    lado: 'mandante' | 'visitante',
    resultado: 'convertido' | 'perdido' | 'defendido',
  ): Promise<void> {
    const equipeId = lado === 'mandante' ? jogo.mandanteId : jogo.visitanteId;
    if (!jogo.id || !equipeId) return;
    const tipoEvento: EventoTipo =
      resultado === 'convertido' ? 'pen-convertido'
      : resultado === 'perdido'  ? 'pen-perdido'
      : 'pen-defendido';
    // Jogador selecionado no select do lado correspondente — pode ser
    // vazio (cobrança sem identificar jogador).
    const jogadorId = lado === 'mandante'
      ? this.penJogadorMandanteId
      : this.penJogadorVisitanteId;
    try {
      await this.jogosSrv.adicionarEvento(
        this.campeonatoId, this.categoriaId, jogo.id,
        {
          tipo: tipoEvento,
          equipeId,
          // Só inclui jogadorId quando preenchido (Firestore rejeita undefined).
          ...(jogadorId ? { jogadorId } : {}),
          tempo: 'penaltis',
        },
      );
      // Limpa o select pra próxima cobrança não herdar o jogador anterior.
      if (lado === 'mandante') this.penJogadorMandanteId = '';
      else this.penJogadorVisitanteId = '';
      // Atualiza o placar de pênaltis denormalizado (count de convertidos
      // por lado). Como `adicionarEvento` chama recalcularPlacar() —
      // que NÃO conhece pen-* — atualizamos manualmente o doc.
      if (resultado === 'convertido') {
        const eventosAtuais = await firstValueFrom(
          this.jogosSrv.listEventos$(this.campeonatoId, this.categoriaId, jogo.id),
        );
        const novo = this.placarPen(eventosAtuais, equipeId);
        const patch: Partial<Jogo> = lado === 'mandante'
          ? { penaltisMandante: novo }
          : { penaltisVisitante: novo };
        await this.jogosSrv.atualizar(
          this.campeonatoId, this.categoriaId, jogo.id, patch,
        );
      }
    } catch (err) {
      console.error('[JogoDetalhe] cobrarPenalti erro', err);
      await this.toast('Falha ao registrar cobrança.', 'danger');
    }
  }

  /** Desfaz a última cobrança de pênalti (qualquer lado). */
  async desfazerUltimoPenalti(
    jogo: JogoView,
    eventos: EventoJogo[] | null | undefined,
  ): Promise<void> {
    if (!jogo.id || !eventos) return;
    const pensOrdenados = [...eventos]
      .filter(e => e.tipo === 'pen-convertido'
                || e.tipo === 'pen-perdido'
                || e.tipo === 'pen-defendido')
      .sort((a, b) => {
        const ta = (a.criadoEm as { seconds?: number } | undefined)?.seconds ?? 0;
        const tb = (b.criadoEm as { seconds?: number } | undefined)?.seconds ?? 0;
        return tb - ta; // mais novo primeiro
      });
    const ultimo = pensOrdenados[0];
    if (!ultimo?.id) {
      await this.toast('Nenhuma cobrança pra desfazer.', 'medium');
      return;
    }
    try {
      await this.jogosSrv.removerEvento(
        this.campeonatoId, this.categoriaId, jogo.id, ultimo.id,
      );
      // Recalcula placar de pênaltis após remover.
      if (ultimo.tipo === 'pen-convertido') {
        const eventosNovos = await firstValueFrom(
          this.jogosSrv.listEventos$(this.campeonatoId, this.categoriaId, jogo.id),
        );
        const m = this.placarPen(eventosNovos, jogo.mandanteId);
        const v = this.placarPen(eventosNovos, jogo.visitanteId);
        await this.jogosSrv.atualizar(
          this.campeonatoId, this.categoriaId, jogo.id,
          { penaltisMandante: m, penaltisVisitante: v },
        );
      }
      await this.toast('Cobrança desfeita.', 'success');
    } catch (err) {
      console.error('[JogoDetalhe] desfazerUltimoPenalti erro', err);
      await this.toast('Falha ao desfazer.', 'danger');
    }
  }
}
