import { Component, OnDestroy, OnInit, inject, ChangeDetectorRef, ElementRef, ViewChild, AfterViewInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Observable, of, Subscription } from 'rxjs';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import { Jogo, EventoJogo, TempoJogoNome } from '../../../../campeonatos/models/jogo.model';
import { Patrocinador } from '../../../../users/models/patrocinador.model';
import { PatrocinadorJogo } from '../../../../campeonatos/models/jogo.model';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { TransmissoesService } from '../../../../campeonatos/transmissoes.service';
import { Transmissao } from '../../../../campeonatos/models/transmissao.model';
import { PatrociniosService } from '../../../../campeonatos/patrocinios.service';
import { UsersService } from '../../../../users/users.service';
import { PlanosService } from '../../../../users/planos.service';
import { NavBackService } from '../../../../shared/nav-back.service';
import { ModeradorPermissoesService, PermissoesEfetivas } from '../../../../shared/moderador-permissoes.service';
import { ModalController, ToastController, AlertController } from '@ionic/angular';
import { TransmissaoModalComponent } from '../../../../shared/components/transmissao-modal/transmissao-modal.component';

/** EventoJogo enriquecido com info de jogador/time/assistente pra
 *  renderizar o feed visual rico. */
export interface EventoEnriquecido extends EventoJogo {
  jogadorNome?: string;
  jogadorNumero?: string;
  jogadorFotoUrl?: string;
  assistenteNome?: string;
  equipeNome?: string;
  equipeLogoUrl?: string;
  lado?: 'm' | 'v';
  /** Nome do goleiro do time ADVERSÁRIO — usado em `pen-defendido`
   *  pra mostrar quem defendeu o pênalti no popup ao vivo. */
  goleiroAdversarioNome?: string;
}

/** Jogador escalado com estatísticas dele na partida (gols/cartões). */
export interface JogadorEscaladoView {
  jogador: Jogador;
  gols: number;
  amarelos: number;
  vermelhos: number;
}

/**
 * Página de transmissão de jogo — player LiveKit (câmera) + overlay
 * com placar/escudos/cronômetro renderizado pelo PWA.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/jogo/:jogoId/transmissao`
 *
 * Stream real-time:
 *  - O jogo é assinado via Firestore onSnapshot — placar, status e golsX
 *    atualizam sem refresh.
 *  - Eventos (gols/cartões) aparecem como "feed" lateral em tempo real.
 *  - Patrocinadores do dono do campeonato rotacionam no rodapé.
 */
@Component({
  selector: 'app-transmissao',
  templateUrl: './transmissao.page.html',
  styleUrls: ['./transmissao.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class TransmissaoPage implements OnInit, OnDestroy, AfterViewInit {
  /** Container do PÔSTER de fim de jogo (capturado via html2canvas
   *  pra gerar PNG baixável). */
  @ViewChild('posterCaptura') posterCaptura?: ElementRef<HTMLDivElement>;
  /** Flag pra desabilitar botão de download enquanto gera o PNG. */
  baixandoPoster = false;

  /** Container do feed lateral de eventos — usado pra fazer scroll
   *  automático pro topo (onde aparece o evento mais recente) sempre
   *  que entrar lance novo. Setado quando segmentAtivo === 'eventos'. */
  @ViewChild('feedList') feedList?: ElementRef<HTMLDivElement>;
  /** Auto-scroll fica ON enquanto o user está perto do topo (≤ 60px).
   *  Se o user rolou pra ver eventos antigos, desativa pra não puxar
   *  ele de volta — reativa quando ele volta perto do topo. */
  private autoScrollFeed = true;
  /** Quantidade de eventos no snapshot anterior — usada pra detectar
   *  se houve novo evento (e só aí scrollar). */
  private ultimoCountEventos = 0;

  /** Highlight visual do evento que foi "Ver lance" (animação flash). */
  eventoDestacadoId?: string;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly transmissoesSrv = inject(TransmissoesService);
  private readonly patrSrv = inject(PatrociniosService);
  private readonly usersSrv = inject(UsersService);
  private readonly planosSrv = inject(PlanosService);
  private readonly navBack = inject(NavBackService);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly permissoesSrv = inject(ModeradorPermissoesService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';
  readonly jogoId       = this.route.snapshot.paramMap.get('jogoId') ?? '';

  campeonato?: Campeonato;
  categoria?: Categoria;
  jogo?: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  /** Jogadores das duas equipes (enriquece os eventos com nome/foto). */
  jogadores: Jogador[] = [];
  /** Eventos enriquecidos com nome do jogador + escudo do time. */
  eventos: EventoEnriquecido[] = [];
  patrocinadores: Patrocinador[] = [];

  /** Tab ativa do painel lateral: eventos ou escalação. */
  segmentAtivo: 'eventos' | 'escalacao' = 'eventos';

  /** Sub-tab da escalação: mandante (m) ou visitante (v). */
  escTimeAtivo: 'm' | 'v' = 'm';

  /** Escalação de cada equipe (com estatísticas computadas dos eventos). */
  escalacaoMandante: JogadorEscaladoView[] = [];
  escalacaoVisitante: JogadorEscaladoView[] = [];

  /** Cor dominante extraída da logo de cada equipe (usada em borders/acentos).
   *  Defaults neutros — substituídos pela cor real da logo (canvas) ou,
   *  se CORS bloquear, por uma cor derivada determinística do nome do time. */
  corMandante = '#8b94a3';
  corVisitante = '#8b94a3';

  /** Transmissão LiveKit ATIVA pro jogo (ou null se ninguém transmitindo).
   *  Inicializado em `ngOnInit` após termos campeonatoId/categoriaId/jogoId. */
  transmissaoAtiva$: Observable<Transmissao | null> = of(null);

  /** Permissões efetivas do usuário no campeonato (owner/moderador/visitante).
   *  Usado pra decidir se mostra o botão "Iniciar Transmissão" no empty state
   *  e o botão "Encerrar transmissão" pra broadcasters. */
  permissoes$: Observable<PermissoesEfetivas> = of({
    nivel: 'nenhum' as const,
    editarCampeonato: false,
    gerenciarEquipes: false,
    editarResultados: false,
    enviarMidias: false,
    gerenciarEnquetes: false,
  });

  /** ID da transmissão LiveKit que estou monitorando (pro broadcaster encerrar
   *  via botão "Encerrar transmissão" na page sem precisar reabrir modal). */
  transmissaoAtivaId?: string;

  /** Flag pra disparar `iniciarPatrociniosDoJogo` UMA vez por sessão da
   *  página quando detectamos transmissão ativa. A função do service é
   *  idempotente (só toca patrocínios com status='agendado'), mas evita
   *  re-execução desnecessária em todo emit do observable. */
  private patrociniosIniciados = false;

  /** True quando a janela PREMIUM está aberta (6s). */
  premiumOverlayAtivo = false;
  onPremiumOverlayMudou(visivel: boolean): void {
    this.premiumOverlayAtivo = visivel;
    // Alterna classe no <body> pra esconder o FAB do feed (que tem
    // position:fixed e ficaria no canto inferior direito competindo
    // visualmente com o banner premium vertical).
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('premium-on-stage', visivel);
    }
    this.cdr.markForCheck();
  }

  loading = true;
  erro = false;

  /** Patrocinador atualmente exibido (banner esteira: rotaciona a cada 6s).
   *  `patrocinadorAnteriorIdx` é usado pra animar o card que está saindo
   *  pra esquerda enquanto o novo entra pela direita. */
  patrocinadorAtualIdx = 0;
  patrocinadorAnteriorIdx = -1;
  private rotacaoTimer?: number;

  /** Toast de evento ao vivo (overlay grande sobre o vídeo).
   *  Mostrado por ~5s quando um novo lance é registrado. */
  eventoToast: EventoEnriquecido | null = null;
  private eventoToastTimer?: number;
  /** IDs de eventos já vistos — usado pra detectar "novos" entre snapshots
   *  (evita disparar toast pros eventos que já existiam na carga inicial). */
  private _eventosVistos = new Set<string>();
  private _eventosInicializado = false;

  /** Mudo do som de notificação de evento (persistido em localStorage). */
  somMudo = false;
  /** AudioContext lazy — só é criado na 1ª tentativa de tocar som. */
  private audioCtx?: AudioContext;

  /** Sons customizados por tipo de evento (URL ou data: base64).
   *  Quando definido, substitui o beep sintetizado.
   *  Persistido em localStorage por usuário/dispositivo.
   *  Chaves usadas: 'gol', 'pen-convertido', 'amarelo', 'vermelho', etc. */
  somsCustom: Record<string, string> = {};
  /** Cache de elementos Audio pra evitar recriar a cada toque. */
  private audioCache: Record<string, HTMLAudioElement> = {};

  /** Toggle do painel de configuração de sons (abre via botão no toolbar). */
  mostrarSonsPanel = false;

  /** Toggle do painel lateral (eventos/escalação) — recolhe ele no mobile
   *  pra dar mais espaço pro vídeo. Persistido em localStorage. */
  feedRecolhido = false;
  /** Lista de tipos configuráveis (na ordem em que aparecem no painel). */
  readonly tiposSonsConfig: Array<{ tipo: string; label: string; icon: string; cor: string }> = [
    { tipo: 'gol',             label: 'Gol',                icon: 'football',              cor: '#7CC61D' },
    { tipo: 'pen-convertido',  label: 'Pênalti convertido', icon: 'football-outline',      cor: '#7CC61D' },
    { tipo: 'pen-perdido',     label: 'Pênalti perdido',    icon: 'close-circle-outline',  cor: '#eb445a' },
    { tipo: 'pen-defendido',   label: 'Pênalti defendido',  icon: 'hand-right-outline',    cor: '#4DABF7' },
    { tipo: 'amarelo',         label: 'Cartão amarelo',     icon: 'square',                cor: '#f5c518' },
    { tipo: 'vermelho',        label: 'Cartão vermelho',    icon: 'square',                cor: '#eb445a' },
    { tipo: 'azul',            label: 'Cartão azul',        icon: 'square',                cor: '#4DABF7' },
    { tipo: 'falta',           label: 'Falta',              icon: 'hand-left-outline',     cor: '#8b94a3' },
    { tipo: 'defesa',          label: 'Defesa',             icon: 'hand-right-outline',    cor: '#8b94a3' },
  ];

  /** Cronômetro do tempo atual (MM:SS) — exibido no overlay da transmissão.
   *  Atualizado a cada 1s a partir de `jogo.tempoAtualIniciadoEm`. */
  readonly tempoDecorrido = signal('00:00');
  private cronoTimer?: ReturnType<typeof setInterval>;

  private subs: Subscription[] = [];

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) {
      this.erro = true;
      this.loading = false;
      return;
    }

    // ─── GATE DE PLANO: transmissão ao vivo é feature paga ─────────────
    // SÓ APLICA na rota AUTENTICADA (/app/campeonato/.../transmissao) —
    // a rota PÚBLICA (/transmissao/:id/:catId/:jogoId) é compartilhável
    // e aberta a qualquer torcedor SEM login. Quem paga é o ORGANIZADOR
    // que INICIA a transmissão pela câmera; quem ASSISTE não precisa de plano.
    //
    // Detecta o contexto pela URL: prefixo `/app/` = área autenticada;
    // prefixo `/transmissao/` = público.
    const ehRotaPublica = this.router.url.startsWith('/transmissao/');
    if (!ehRotaPublica) {
      const podeTransmissao = await firstValueFrom(
        this.planosSrv.podeTransmissaoAoVivo$(),
      );
      if (!podeTransmissao) {
        const minimo = this.planosSrv.planoMinimoParaTransmissao();
        const t = await this.toastCtrl.create({
          message: `Transmissão ao vivo disponível no plano ${minimo.label}+.`,
          duration: 3500,
          position: 'top',
          color: 'warning',
          buttons: [{ text: 'Ver planos', role: 'cancel' }],
        });
        await t.present();
        this.router.navigateByUrl('/app/planos');
        return;
      }
    }

    // Restaura preferência de som (persistida entre transmissões)
    try {
      this.somMudo = localStorage.getItem('placarpro.transmissao.somMudo') === '1';
      // Carrega sons customizados salvos pelo usuário
      const json = localStorage.getItem('placarpro.transmissao.somsCustom');
      if (json) this.somsCustom = JSON.parse(json);
      // Estado do painel lateral (recolhido/expandido)
      this.feedRecolhido = localStorage.getItem('placarpro.transmissao.feedRecolhido') === '1';
    } catch { /* localStorage indisponível em alguns contexts */ }

    // Inicializa observables que dependem dos params da rota.
    // - `transmissaoAtiva$` → reativo, controla se o player LiveKit aparece
    //   (e se mostra "Encerrar transmissão" pro broadcaster).
    // - `permissoes$` → owner/moderador podem ver botão "Iniciar transmissão"
    //   no empty state quando não há transmissão LiveKit ativa.
    this.transmissaoAtiva$ = this.transmissoesSrv.ativa$(
      this.campeonatoId, this.categoriaId, this.jogoId,
    );
    const subAtiva = this.transmissaoAtiva$.subscribe(t => {
      this.transmissaoAtivaId = t?.id;
      // Quando uma transmissão ATIVA aparece pela primeira vez nessa
      // sessão da página, dispara o "start" dos patrocínios pagos:
      // marca todos com status='agendado' como 'ativo' e calcula
      // expiraEm = agora + 60min. Idempotente — se rodar duas vezes
      // não duplica, mas evitamos chamar a cada emit do observable.
      if (t && !this.patrociniosIniciados) {
        this.patrociniosIniciados = true;
        this.patrSrv
          .iniciarPatrociniosDoJogo(this.campeonatoId, this.categoriaId, this.jogoId)
          .catch(err => console.warn('[Transmissao] erro ao iniciar patrocínios', err));
      }
      this.cdr.markForCheck();
    });
    this.subs.push(subAtiva);
    this.permissoes$ = this.permissoesSrv.efetivas$(this.campeonatoId);

    try {
      // Carga inicial paralela (campeonato + categoria) — ownerId vem do
      // campeonato e é usado depois pra buscar patrocinadores.
      const [camp, cat] = await Promise.all([
        firstValueFrom(this.campsSrv.get$(this.campeonatoId)),
        firstValueFrom(this.catsSrv.get$(this.campeonatoId, this.categoriaId))
          .catch(() => undefined),
      ]);
      this.campeonato = camp;
      this.categoria = cat;

      // Subscribe realtime ao jogo (placar/status atualizam ao vivo).
      // Também re-sincroniza patrocinadores da partida, pra refletir add/remove
      // feitos no editor sem precisar reload da página da transmissão.
      const subJogo = this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId)
        .subscribe(j => {
          this.jogo = j;
          this.sincronizarCronometro();
          this.sincronizarPatrocinadores();
          this.cdr.markForCheck();
        });
      this.subs.push(subJogo);

      // Carrega equipes + jogadores em paralelo (jogadores enriquecem eventos)
      const [equipes, jogadores] = await Promise.all([
        firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId))
          .catch(() => [] as Jogador[]),
      ]);
      this.jogadores = jogadores ?? [];
      await new Promise<void>(resolve => setTimeout(() => {
        if (this.jogo) {
          this.mandante = equipes.find(e => e.id === this.jogo!.mandanteId);
          this.visitante = equipes.find(e => e.id === this.jogo!.visitanteId);
        }
        resolve();
      }, 0));

      // Define cor da equipe pra usar como acento nas bordas dos cards.
      // 1) Tenta extrair cor dominante da logo via canvas (precisa CORS OK).
      // 2) Se falhar (CORS ou imagem inválida), gera cor determinística
      //    a partir do ID/nome do time (cada equipe sempre cai na mesma cor).
      const definirCor = (e: Equipe | undefined, alvo: 'm' | 'v') => {
        if (!e) return;
        // Cor fallback determinística baseada no ID/nome — garante que
        // cada equipe tem uma cor distinta mesmo se a extração falhar.
        const fallback = this.corDeterministica(e.id || e.nome || alvo);
        if (alvo === 'm') this.corMandante = fallback; else this.corVisitante = fallback;
        this.cdr.markForCheck();
        // Tenta upgrade pra cor real da logo
        if (e.logoUrl) {
          this.extrairCorDominante(e.logoUrl).then(cor => {
            if (!cor) return;
            if (alvo === 'm') this.corMandante = cor; else this.corVisitante = cor;
            this.cdr.markForCheck();
          });
        }
      };
      definirCor(this.mandante, 'm');
      definirCor(this.visitante, 'v');

      // Subscribe eventos do jogo (feed lateral) — enriquece com nome
      // do jogador + escudo do time + assistente em tempo real.
      // E recalcula a escalação (stats por jogador dependem dos eventos).
      const subEv = this.jogosSrv.listEventos$(this.campeonatoId, this.categoriaId, this.jogoId)
        .subscribe(evs => {
          const lista = evs ?? [];
          this.eventos = lista
            .slice()
            // Ordena por timestamp de CRIAÇÃO (desc) — mais novo em cima.
            // Antes era só por `minuto`, mas se vários lances acontecem no
            // mesmo minuto (gols em sequência), eles ficam fora de ordem.
            // criadoEm é o source-of-truth de "quando aconteceu". Fallback
            // pro minuto * 60000 quando criadoEm ainda não foi gravado
            // (corrida com serverTimestamp na primeira leitura).
            .sort((a, b) => this.tsEvento(b) - this.tsEvento(a))
            .map(ev => this.enriquecerEvento(ev));
          // Atualiza escalação (gols/cartões por jogador são derivados dos eventos)
          this.atualizarEscalacao(lista);
          // Detecta eventos NOVOS (não existiam no snapshot anterior) e
          // dispara o toast ao vivo pro mais recente. Na primeira carga,
          // apenas populamos o cache sem mostrar nada (evita spam inicial).
          this.detectarEventoNovo(lista);
          this.cdr.markForCheck();
          // Auto-scroll pro topo (mais novo) quando houver evento novo.
          // Aguarda o ciclo de render pra ter o DOM atualizado.
          if (lista.length > this.ultimoCountEventos) {
            this.scrollFeedParaTopoSeAtivo();
          }
          this.ultimoCountEventos = lista.length;
        });
      this.subs.push(subEv);

      // Subscribe escalação de cada equipe (em tempo real — admin pode
      // editar quem entrou no time durante o jogo).
      if (this.jogo) {
        const subEscM = this.jogosSrv.escalacao$(
          this.campeonatoId, this.categoriaId, this.jogoId, this.jogo.mandanteId,
        ).subscribe(ids => {
          this.escalacaoMandante = this.montarEscalados(ids ?? [], this.jogo!.mandanteId);
          this.cdr.markForCheck();
        });
        const subEscV = this.jogosSrv.escalacao$(
          this.campeonatoId, this.categoriaId, this.jogoId, this.jogo.visitanteId,
        ).subscribe(ids => {
          this.escalacaoVisitante = this.montarEscalados(ids ?? [], this.jogo!.visitanteId);
          this.cdr.markForCheck();
        });
        this.subs.push(subEscM, subEscV);
      }

      // (Patrocinadores são re-sincronizados em `subJogo` acima, reativamente.)
    } catch (err) {
      console.error('[Transmissao] erro init', err);
      this.erro = true;
    } finally {
      this.loading = false;
    }
  }

  ngAfterViewInit(): void {
    // Auto fullscreen + landscape no primeiro TOQUE/CLIQUE em mobile.
    // Browsers (incluindo Chrome Android, Firefox, Safari) exigem user
    // gesture pra disparar `requestFullscreen()` e `orientation.lock()`,
    // então NÃO podemos chamar no ngAfterViewInit direto. Esperamos o
    // primeiro touchstart/click — qualquer toque na tela serve como
    // gesture. Listener com `{ once: true }` se desregistra sozinho.
    //
    // iOS Safari não suporta `screen.orientation.lock` (silenciosamente
    // ignora) e `requestFullscreen()` no `<html>` também é bloqueado —
    // ali a única forma é PWA standalone (Adicionar à Tela de Início).
    // Por isso a função abaixo é best-effort: se funcionar, ótimo; se
    // não, página renderiza normal.
    if (this.ehDispositivoMobile && typeof window !== 'undefined') {
      this._autoFsHandler = () => { void this.autoFullscreenLandscape(); };
      document.addEventListener('touchstart', this._autoFsHandler, { once: true, passive: true });
      document.addEventListener('click', this._autoFsHandler, { once: true });
    }
  }

  /** Handler do "primeiro toque" — limpo em ngOnDestroy se nunca disparar. */
  private _autoFsHandler?: () => void;

  /**
   * Best-effort: dispara fullscreen + landscape lock. Chamado no primeiro
   * user gesture (touchstart/click). Erros são esperados (iOS Safari,
   * desktop sem suporte) e ficam só como info no console.
   */
  private async autoFullscreenLandscape(): Promise<void> {
    try {
      const el = document.documentElement;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyEl = el as any;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (anyEl.webkitRequestFullscreen) {
        anyEl.webkitRequestFullscreen();
      }
    } catch (err) {
      console.info('[Transmissao] auto-fullscreen falhou', err);
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const screenAny = screen as any;
      if (screenAny?.orientation?.lock) {
        await screenAny.orientation.lock('landscape');
      }
    } catch (err) {
      console.info('[Transmissao] orientation.lock falhou (iOS Safari não suporta)', err);
    }
  }

  /** No-op — `onFullscreenChange` ficou aqui só pra evitar TS errors em
   *  refs antigas. O gate `precisaAtivarTelaCheia` foi removido. */
  private onFullscreenChange = (): void => { /* no-op */ };

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    if (this.rotacaoTimer) window.clearInterval(this.rotacaoTimer);
    if (this.eventoToastTimer) window.clearTimeout(this.eventoToastTimer);
    // Garante que a classe `premium-on-stage` não fica grudada no <body>
    // se sairmos da página durante uma janela premium ativa.
    if (typeof document !== 'undefined') {
      document.body.classList.remove('premium-on-stage');
    }
    this.pararCronometro();
    try { this.audioCtx?.close(); } catch { /* ignore */ }
    // Destrava landscape ao sair da página (pra não afetar outras telas)
    this.destravarLandscape();
    // Limpa listener de fullscreenchange
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    // Limpa listener do primeiro toque se nunca disparou
    if (this._autoFsHandler) {
      document.removeEventListener('touchstart', this._autoFsHandler);
      document.removeEventListener('click', this._autoFsHandler);
      this._autoFsHandler = undefined;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // LANDSCAPE LOCK — força orientação horizontal em mobile
  // ════════════════════════════════════════════════════════════════════

  /** True quando o lock foi bem-sucedido; false se falhou (Safari iOS,
   *  sem fullscreen, etc). Usado pra mostrar botão "Tela cheia" como
   *  fallback caso o lock automático não funcione. */
  landscapeLockOk = false;
  /** True enquanto a tentativa de lock está em andamento — esconde o
   *  botão de fallback pra não piscar. */
  private landscapeTentando = false;
  /** True se este dispositivo é mobile (width ≤768px na primeira detecção). */
  get ehDispositivoMobile(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= 768;
  }

  /**
   * True quando precisa exibir o MODAL "Tela cheia" cobrindo toda a tela
   * (em mobile, antes do lock landscape ser ativado). Bloqueia visão do
   * conteúdo da transmissão até o usuário clicar pra entrar em fullscreen.
   *
   * Vira `false` quando:
   *  - Lock landscape funcionou (automático em PWA/Capacitor) → ngAfterViewInit
   *  - Usuário clicou no botão "Entrar em Tela Cheia"
   *  - Não é mobile (desktop ignora — não precisa de fullscreen)
   *
   * Vira `true` de novo quando:
   *  - Usuário saiu de fullscreen pelo botão do browser (ESC, gesture)
   */
  precisaAtivarTelaCheia = false;

  /**
   * Tenta travar a orientação em landscape (modo horizontal). Funciona em:
   *  - PWA instalada (tela cheia automática)
   *  - Capacitor nativo (Android/iOS app)
   *  - Browser depois de `requestFullscreen()`
   *
   * NÃO funciona em Safari iOS browser comum (Apple não suporta a API).
   * Nesse caso, mostra botão "Tela cheia" pro usuário entrar manualmente.
   */
  async travarLandscape(): Promise<void> {
    if (!this.ehDispositivoMobile) return;
    if (this.landscapeTentando || this.landscapeLockOk) return;
    this.landscapeTentando = true;

    try {
      // 1) Tenta entrar em fullscreen (requisito da API em browsers)
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
        msRequestFullscreen?: () => Promise<void>;
      };
      const reqFs =
        el.requestFullscreen?.bind(el) ??
        el.webkitRequestFullscreen?.bind(el) ??
        el.msRequestFullscreen?.bind(el);
      if (reqFs && !document.fullscreenElement) {
        await reqFs().catch(() => { /* user negou ou Safari */ });
      }

      // 2) Trava orientação landscape (precisa da API ScreenOrientation)
      const screenAny = screen as Screen & {
        orientation?: {
          lock?: (orientation: string) => Promise<void>;
          unlock?: () => void;
        };
      };
      if (screenAny.orientation?.lock) {
        await screenAny.orientation.lock('landscape');
        this.landscapeLockOk = true;
      }
      // Mesmo se a API de lock não existe (Safari iOS), se entrou em
      // fullscreen, considera "tela cheia ok" — escondemos o modal.
      if (document.fullscreenElement) {
        this.precisaAtivarTelaCheia = false;
      }
    } catch (err) {
      console.info('[Transmissao] Lock landscape falhou (Safari iOS ou sem permissão)', err);
      this.landscapeLockOk = false;
    } finally {
      this.landscapeTentando = false;
      this.cdr.markForCheck();
    }
  }

  /** Destrava orientação + sai de fullscreen (chamado em ngOnDestroy). */
  private destravarLandscape(): void {
    try {
      const screenAny = screen as Screen & {
        orientation?: { unlock?: () => void };
      };
      screenAny.orientation?.unlock?.();
    } catch { /* ignore */ }
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => { /* ignore */ });
      }
    } catch { /* ignore */ }
    this.landscapeLockOk = false;
  }


  /** Rotaciona patrocinadores em modo esteira a cada 6s. O card anterior
   *  desliza pra esquerda e o novo entra pela direita (CSS faz a animação). */
  private iniciarRotacao(): void {
    if (this.rotacaoTimer) window.clearInterval(this.rotacaoTimer);
    this.rotacaoTimer = window.setInterval(() => {
      if (this.patrocinadores.length < 2) return;
      this.patrocinadorAnteriorIdx = this.patrocinadorAtualIdx;
      this.patrocinadorAtualIdx =
        (this.patrocinadorAtualIdx + 1) % this.patrocinadores.length;
      this.cdr.markForCheck();
    }, 6000);
  }

  /** Para a rotação dos patrocinadores. Chamado quando a lista cai
   *  pra 0 ou 1 item (sem necessidade de rotacionar). */
  private pararRotacao(): void {
    if (this.rotacaoTimer) {
      window.clearInterval(this.rotacaoTimer);
      this.rotacaoTimer = undefined;
    }
  }

  /** Helper template — abre site do patrocinador (se tiver). */
  abrirPatrocinador(p: Patrocinador): void {
    if (p.site) window.open(p.site, '_blank', 'noopener');
  }

  voltar(): void {
    // Detecta se está no contexto público (/transmissao/...) ou autenticado
    // (/app/campeonato/...) pra escolher o fallback correto.
    const url = this.router.url;
    const fallbackPublico = '/';  // home pública
    const fallbackApp = ['/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId, 'jogo', this.jogoId];
    if (url.startsWith('/transmissao/')) {
      this.navBack.back(fallbackPublico);
    } else {
      this.navBack.back(fallbackApp);
    }
  }

  /** Compartilha a URL PÚBLICA (`/transmissao/:campId/:catId/:jogoId`) —
   *  abre sem login, qualquer torcedor pode acessar. */
  async compartilhar(): Promise<void> {
    const url = `${window.location.origin}/transmissao/${this.campeonatoId}/${this.categoriaId}/${this.jogoId}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${this.mandante?.nome ?? '?'} x ${this.visitante?.nome ?? '?'}`,
          text: 'Acompanhe a transmissão ao vivo no PlacarPro',
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert('Link copiado!');
      }
    } catch { /* cancelado */ }
  }

  /**
   * Abre o modal de broadcaster LiveKit — preview da câmera + botão iniciar.
   * Quando o admin confirma "INICIAR TRANSMISSÃO", o modal cria o doc Firestore
   * (ativa: true) → o `transmissaoAtiva$` desta página detecta e renderiza
   * o `app-transmissao-player`. Modal continua aberto pra o broadcaster
   * ver os controles (mute mic, cam toggle, stop).
   */
  async iniciarTransmissaoCamera(): Promise<void> {
    const rotulo = `${this.mandante?.nome ?? '?'} x ${this.visitante?.nome ?? '?'}`;
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

  /**
   * Encerra a transmissão LiveKit ativa via doc Firestore. Usado pelo botão
   * "Encerrar transmissão" que aparece pra broadcasters NA própria tela
   * (sem precisar reabrir o modal). Mostra confirmação antes pra evitar
   * acidente — espectadores são desconectados ao confirmar.
   *
   * NÃO desconecta o Room do LiveKit aqui — isso é responsabilidade do
   * componente que está conectado (o modal do broadcaster, se aberto).
   * Marcando o doc como `ativa: false` é o suficiente pra o player dos
   * espectadores desconectar automaticamente via observable do Firestore.
   */
  async encerrarTransmissao(): Promise<void> {
    // Antes era `if (!this.transmissaoAtivaId) return;` — botão ficava
    // inerte quando o observable `transmissaoAtiva$` ainda não tinha
    // emitido (ex: índice do Firestore em construção, erro de rede,
    // emit `null` por catchError). Agora seguimos sempre, e na hora
    // de encerrar usamos um fallback que varre o histórico do jogo
    // pra achar TODAS as transmissões com `ativa: true` e encerrá-las.
    // Garante que o broadcaster sempre tem como interromper, mesmo
    // num estado meio quebrado.
    const alert = await this.alertCtrl.create({
      header: 'Encerrar transmissão?',
      message: 'Os espectadores serão desconectados imediatamente. Você pode iniciar uma nova depois.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Encerrar',
          role: 'destructive',
          handler: async () => {
            try {
              const idsParaEncerrar: string[] = [];
              if (this.transmissaoAtivaId) {
                idsParaEncerrar.push(this.transmissaoAtivaId);
              } else {
                // Fallback — `transmissaoAtiva$` não tinha o doc em
                // memória. Lê o histórico (ordenado por `iniciadoEm
                // desc`, não depende do índice problemático) e fecha
                // tudo que ainda está `ativa: true`.
                const historico = await firstValueFrom(
                  this.transmissoesSrv.historico$(
                    this.campeonatoId, this.categoriaId, this.jogoId,
                  ),
                );
                for (const t of historico) {
                  if (t.ativa && t.id) idsParaEncerrar.push(t.id);
                }
              }

              if (idsParaEncerrar.length === 0) {
                const t = await this.toastCtrl.create({
                  message: 'Nenhuma transmissão ativa pra encerrar.',
                  duration: 2200, position: 'top', color: 'medium',
                });
                await t.present();
                return;
              }

              await Promise.all(idsParaEncerrar.map(id =>
                this.transmissoesSrv.encerrar(
                  this.campeonatoId, this.categoriaId, this.jogoId, id,
                )
              ));

              const t = await this.toastCtrl.create({
                message: idsParaEncerrar.length === 1
                  ? 'Transmissão encerrada.'
                  : `${idsParaEncerrar.length} transmissões encerradas.`,
                duration: 2200, position: 'top', color: 'success',
              });
              await t.present();
            } catch (err) {
              console.error('[Transmissao] erro ao encerrar', err);
              const t = await this.toastCtrl.create({
                message: 'Falha ao encerrar — tente novamente.',
                duration: 2500, position: 'top', color: 'danger',
              });
              await t.present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Detecta eventos NOVOS comparando o snapshot atual com o cache de IDs
   * vistos anteriormente. Na primeira execução só popula o cache (não
   * mostra nada — eventos pré-existentes não devem virar toast).
   * Quando encontra um ID novo, escolhe o mais recente e dispara o toast.
   */
  private detectarEventoNovo(lista: EventoJogo[]): void {
    if (!this._eventosInicializado) {
      for (const ev of lista) if (ev.id) this._eventosVistos.add(ev.id);
      this._eventosInicializado = true;
      return;
    }
    const novos = lista.filter(ev => ev.id && !this._eventosVistos.has(ev.id));
    for (const ev of novos) if (ev.id) this._eventosVistos.add(ev.id);
    if (novos.length === 0) return;
    // O campo no modelo é `criadoEm` (Timestamp). Usa minuto como
    // tie-breaker se faltar timestamp (eventos legados).
    const maisRecente = novos.reduce((acc, cur) => {
      const a = (acc.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? acc.minuto ?? 0;
      const c = (cur.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.() ?? cur.minuto ?? 0;
      return c > a ? cur : acc;
    });
    this.mostrarEventoToast(this.enriquecerEvento(maisRecente));
  }

  /** Exibe o toast/popup grande do evento sobre o vídeo por ~5s.
   *  Também toca um som curto (gerado via Web Audio) específico do tipo
   *  do lance — exceto se o usuário tiver mutado. */
  private mostrarEventoToast(ev: EventoEnriquecido): void {
    if (this.eventoToastTimer) window.clearTimeout(this.eventoToastTimer);
    this.eventoToast = ev;
    this.cdr.markForCheck();
    this.eventoToastTimer = window.setTimeout(() => {
      this.eventoToast = null;
      this.cdr.markForCheck();
    }, 5000);
    // Som de notificação (não bloqueia o toast se falhar)
    this.tocarSomEvento(ev.tipo);
  }

  /** Fecha o toast manualmente (clique no X). */
  fecharEventoToast(): void {
    if (this.eventoToastTimer) window.clearTimeout(this.eventoToastTimer);
    this.eventoToast = null;
    this.cdr.markForCheck();
  }

  /**
   * Toca o áudio customizado se o usuário definiu um pro tipo de lance.
   * Retorna true se tocou (caller deve pular o beep sintetizado).
   * Aceita data URL (base64) ou URL externa (precisa CORS).
   */
  private tocarSomCustomSeDefinido(tipo: string): boolean {
    const url = this.somsCustom[tipo];
    if (!url) return false;
    try {
      let audio = this.audioCache[tipo];
      if (!audio) {
        audio = new Audio(url);
        audio.preload = 'auto';
        this.audioCache[tipo] = audio;
      }
      audio.currentTime = 0;
      audio.volume = 0.85;
      // play() retorna Promise — pode rejeitar se browser bloquear
      void audio.play().catch(() => { /* autoplay bloqueado */ });
      return true;
    } catch { return false; }
  }

  /**
   * Abre file picker pra escolher MP3/áudio customizado pra um tipo de
   * lance. Lê como base64 (data URL) pra evitar precisar de Storage —
   * fica salvo no localStorage do dispositivo.
   * Limite de 200KB pra não estourar localStorage (5MB total).
   */
  configurarSomCustom(tipo: string): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 200_000) {
        alert('Áudio muito grande. Use um arquivo de até 200KB (≈ 2-3 segundos de MP3).');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        this.somsCustom = { ...this.somsCustom, [tipo]: dataUrl };
        // Invalida cache do tipo pra próxima execução criar novo Audio
        delete this.audioCache[tipo];
        try {
          localStorage.setItem('placarpro.transmissao.somsCustom', JSON.stringify(this.somsCustom));
        } catch (err) {
          console.warn('[Transmissao] não foi possível salvar som custom (storage cheio?)', err);
        }
        // Toca de preview
        this.tocarSomCustomSeDefinido(tipo);
        this.cdr.markForCheck();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  /** Abre/fecha o painel de configuração de sons (toolbar). */
  toggleSonsPanel(): void {
    this.mostrarSonsPanel = !this.mostrarSonsPanel;
  }

  /** Recolhe/expande o painel lateral de eventos+escalação.
   *  Útil no mobile pra dar mais espaço pro vídeo.
   *
   *  Funciona TAMBÉM em fullscreen porque o ancestor de FS é `.tr-stage`
   *  (que envolve vídeo + painel) — ambos entram juntos na tela cheia. */
  toggleFeed(): void {
    this.feedRecolhido = !this.feedRecolhido;
    try {
      localStorage.setItem('placarpro.transmissao.feedRecolhido', this.feedRecolhido ? '1' : '0');
    } catch { /* ignora */ }
  }

  /** True se o tipo tem som custom configurado. */
  temSomCustom(tipo: string): boolean {
    return !!this.somsCustom[tipo];
  }

  /** Toca preview do som de um tipo (custom OU sintetizado, conforme estado). */
  preverSom(tipo: string): void {
    // Força tocar mesmo se mudo (preview é ação explícita)
    const eraMudo = this.somMudo;
    this.somMudo = false;
    if (this.tocarSomCustomSeDefinido(tipo)) {
      // tocou custom
    } else {
      // tocarSomEvento dispara o synth correspondente
      this._tocarSyntheticDirect(tipo);
    }
    this.somMudo = eraMudo;
  }

  /** Helper interno: chama tocarSomEvento ignorando o gate de mudo
   *  (já tratado no caller). Mantém a separação preview vs natural. */
  private _tocarSyntheticDirect(tipo: string): void {
    const eraMudo = this.somMudo;
    this.somMudo = false;
    try { this.tocarSomEvento(tipo); } finally { this.somMudo = eraMudo; }
  }

  /** Remove o som customizado de um tipo (volta ao beep sintetizado). */
  removerSomCustom(tipo: string): void {
    if (!this.somsCustom[tipo]) return;
    const novo = { ...this.somsCustom };
    delete novo[tipo];
    this.somsCustom = novo;
    delete this.audioCache[tipo];
    try {
      localStorage.setItem('placarpro.transmissao.somsCustom', JSON.stringify(this.somsCustom));
    } catch { /* ignora */ }
    this.cdr.markForCheck();
  }

  /** Alterna mudo do som de eventos. Salva preferência em localStorage. */
  toggleSom(): void {
    this.somMudo = !this.somMudo;
    try {
      localStorage.setItem('placarpro.transmissao.somMudo', this.somMudo ? '1' : '0');
    } catch { /* ignora */ }
    // Quando re-liga, toca um "ding" curto pra feedback (sem delay)
    if (!this.somMudo) this.tocarBeep(880, 0.12, 'sine', 0.18, 0);
  }

  /**
   * Toca um som sintético curto baseado no tipo do lance. Usa Web Audio
   * API (não precisa de assets) — diferentes tipos têm timbres distintos:
   *  - Gol: arpejo crescente C-E-G (estilo "uhul")
   *  - Cartão vermelho/azul: beep grave + harsh
   *  - Cartão amarelo: beep médio curto
   *  - Outros: ding neutro
   */
  private tocarSomEvento(tipo: string): void {
    if (this.somMudo) return;
    // Se o usuário definiu um MP3 customizado pra esse tipo, usa ele
    if (this.tocarSomCustomSeDefinido(tipo)) return;
    try {
      switch (tipo) {
        case 'gol':
        case 'gol-contra':
        case 'pen-convertido':
          // Arpejo crescente — celebração de gol (pênalti convertido = mesma vibe)
          this.tocarBeep(523.25, 0.12, 'triangle', 0.25, 0);    // C5
          this.tocarBeep(659.25, 0.12, 'triangle', 0.25, 120);  // E5
          this.tocarBeep(783.99, 0.22, 'triangle', 0.28, 240);  // G5 (mais longo)
          this.tocarBeep(1046.5, 0.30, 'triangle', 0.22, 460);  // C6 (oitava)
          break;
        case 'amarelo':
          this.tocarBeep(440, 0.10, 'square', 0.18, 0);   // A4
          this.tocarBeep(440, 0.10, 'square', 0.18, 130); // A4 (dupla)
          break;
        case 'vermelho':
          this.tocarBeep(220, 0.18, 'sawtooth', 0.22, 0);   // A3 (grave)
          this.tocarBeep(180, 0.25, 'sawtooth', 0.22, 200); // F#3 (desce)
          break;
        case 'azul':
          this.tocarBeep(587.33, 0.10, 'square', 0.18, 0);   // D5
          this.tocarBeep(493.88, 0.14, 'square', 0.18, 120); // B4
          break;
        case 'falta':
          this.tocarBeep(330, 0.18, 'sawtooth', 0.18, 0); // E4 grave
          break;
        case 'defesa':
          this.tocarBeep(880, 0.10, 'sine', 0.18, 0);   // A5
          this.tocarBeep(1318.51, 0.14, 'sine', 0.18, 100); // E6
          break;
        case 'pen-perdido':
          // "Aaaaww...": dois beeps descendentes, frustração
          this.tocarBeep(523.25, 0.18, 'triangle', 0.20, 0);   // C5
          this.tocarBeep(415.30, 0.25, 'triangle', 0.22, 180); // G#4
          this.tocarBeep(311.13, 0.40, 'triangle', 0.22, 400); // D#4 (desce)
          break;
        case 'pen-defendido':
          // Defesa do goleiro — som heroico crescente curto + "thud"
          this.tocarBeep(659.25, 0.10, 'sine', 0.22, 0);    // E5
          this.tocarBeep(987.77, 0.14, 'sine', 0.24, 90);   // B5 (sobe rápido)
          this.tocarBeep(146.83, 0.22, 'sawtooth', 0.18, 230); // D3 (thud grave)
          break;
        case 'sub-entrou':
        case 'sub-saiu':
          this.tocarBeep(523, 0.10, 'sine', 0.18, 0);
          this.tocarBeep(659, 0.14, 'sine', 0.18, 110);
          break;
        default:
          this.tocarBeep(660, 0.15, 'sine', 0.20, 0); // ding neutro
      }
    } catch { /* AudioContext bloqueado ou indisponível */ }
  }

  /**
   * Gera um beep curto via Web Audio API com envelope ADSR simples
   * (fade-in 5ms, sustain, fade-out 30ms) pra evitar clicks.
   * Lazy-inicia o AudioContext na 1ª chamada.
   */
  private tocarBeep(
    freq: number,
    durSeg: number,
    onda: OscillatorType,
    volume: number,
    delayMs: number,
  ): void {
    if (typeof window === 'undefined') return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!this.audioCtx) this.audioCtx = new Ctx();
    const ctx = this.audioCtx!;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const start = ctx.currentTime + (delayMs / 1000);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = onda;
    osc.frequency.setValueAtTime(freq, start);
    // Envelope: fade-in 5ms, plateau, fade-out
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.005);
    gain.gain.setValueAtTime(volume, start + durSeg - 0.030);
    gain.gain.linearRampToValueAtTime(0, start + durSeg);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durSeg + 0.05);
  }

  /** Enriquece um EventoJogo com nome do jogador + escudo + assistente
   *  pra renderizar o card rico no feed. */
  private enriquecerEvento(ev: EventoJogo): EventoEnriquecido {
    const jogador = ev.jogadorId
      ? this.jogadores.find(j => j.id === ev.jogadorId)
      : undefined;
    const assistente = ev.assistenteId
      ? this.jogadores.find(j => j.id === ev.assistenteId)
      : undefined;
    const ehMandante = ev.equipeId === this.jogo?.mandanteId;
    const equipe = ehMandante ? this.mandante : this.visitante;
    // Em pênaltis defendidos, buscamos o goleiro do TIME ADVERSÁRIO
    // (quem cobrou é do time `equipeId`, quem defendeu é do outro).
    let goleiroAdversarioNome: string | undefined;
    if (ev.tipo === 'pen-defendido') {
      goleiroAdversarioNome = this.acharGoleiroAdversario(ev.equipeId);
    }
    return {
      ...ev,
      jogadorNome: jogador?.nome,
      jogadorNumero: jogador?.numeroCamisa,
      jogadorFotoUrl: jogador?.fotoUrl,
      assistenteNome: assistente?.nome,
      equipeNome: equipe?.nome,
      equipeLogoUrl: equipe?.logoUrl,
      lado: ehMandante ? 'm' : 'v',
      goleiroAdversarioNome,
    };
  }

  /**
   * Acha o goleiro do time ADVERSÁRIO ao `equipeIdCobranca` (i.e., quem
   * defendeu o pênalti). Prioriza:
   *  1. Jogador escalado com flag `goleiro: true`
   *  2. Qualquer jogador com flag `goleiro: true` da equipe adversária
   *  3. Jogador com posição contendo "gol" (fallback texto livre)
   * Retorna `undefined` se não encontrar.
   */
  private acharGoleiroAdversario(equipeIdCobranca: string): string | undefined {
    if (!this.jogo) return undefined;
    const advId = equipeIdCobranca === this.jogo.mandanteId
      ? this.jogo.visitanteId
      : this.jogo.mandanteId;
    // 1) Escalados desse time
    const escalacao = advId === this.jogo.mandanteId
      ? this.escalacaoMandante
      : this.escalacaoVisitante;
    const escGoleiro = escalacao.find(e => e.jogador.estatisticas?.goleiro);
    if (escGoleiro) return escGoleiro.jogador.nome;
    // 2) Qualquer jogador goleiro do time adversário
    const goleiro = this.jogadores.find(j =>
      j.equipeId === advId && j.estatisticas?.goleiro,
    );
    if (goleiro) return goleiro.nome;
    // 3) Fallback: posição texto livre contendo "gol"
    const porPosicao = this.jogadores.find(j =>
      j.equipeId === advId &&
      typeof j.posicao === 'string' &&
      /gol/i.test(j.posicao),
    );
    return porPosicao?.nome;
  }

  /** Recalcula a escalação de ambas as equipes quando os eventos mudam.
   *  As IDs vêm dos subscribes de `escalacao$`; este método só atualiza
   *  os stats (gols/cartões) baseado nos eventos mais recentes. */
  private atualizarEscalacao(eventos: EventoJogo[]): void {
    if (!this.jogo) return;
    // Mantém os IDs atuais e recomputa as stats
    const idsM = this.escalacaoMandante.map(e => e.jogador.id!).filter(Boolean);
    const idsV = this.escalacaoVisitante.map(e => e.jogador.id!).filter(Boolean);
    this.escalacaoMandante = this.montarEscaladosComEventos(idsM, this.jogo.mandanteId, eventos);
    this.escalacaoVisitante = this.montarEscaladosComEventos(idsV, this.jogo.visitanteId, eventos);
  }

  /** Monta a lista de escalados a partir das IDs (usa eventos cacheados). */
  private montarEscalados(ids: string[], equipeId: string): JogadorEscaladoView[] {
    return this.montarEscaladosComEventos(ids, equipeId, this.eventos);
  }

  private montarEscaladosComEventos(
    ids: string[],
    equipeId: string,
    eventos: EventoJogo[],
  ): JogadorEscaladoView[] {
    return ids
      .map(id => this.jogadores.find(j => j.id === id))
      .filter((j): j is Jogador => !!j)
      .map(j => {
        const meus = eventos.filter(e => e.jogadorId === j.id && e.equipeId === equipeId);
        return {
          jogador: j,
          gols: meus.filter(e => e.tipo === 'gol').reduce((s, e) => s + (e.quantidade ?? 1), 0),
          amarelos: meus.filter(e => e.tipo === 'amarelo').length,
          vermelhos: meus.filter(e => e.tipo === 'vermelho').length,
        };
      });
  }

  /** Troca o segment ativo (eventos / escalação). */
  selecionarSegment(s: 'eventos' | 'escalacao'): void {
    this.segmentAtivo = s;
  }

  /** Troca o time exibido na escalação (sub-tab). */
  selecionarEscTime(t: 'm' | 'v'): void {
    this.escTimeAtivo = t;
  }

  trackByJogador(_i: number, e: JogadorEscaladoView): string {
    return e.jogador.id ?? '';
  }

  /**
   * Gera uma cor determinística (sempre a mesma para a mesma seed) a
   * partir de uma string. Usado como fallback quando a extração via
   * canvas falha por CORS — assim cada equipe tem uma cor distinta.
   * Usa hue espalhado pelo círculo cromático, saturação alta e luminância
   * média (cores vivas mas legíveis sobre fundo escuro).
   */
  private corDeterministica(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = ((h << 5) - h) + seed.charCodeAt(i);
      h |= 0;
    }
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  /**
   * Extrai a cor dominante de uma imagem (logo de equipe) usando canvas.
   * Faz amostragem dos pixels, descarta tons cinzas/brancos/pretos próximos
   * e devolve a cor mais saturada e frequente. Retorna `null` se falhar
   * (CORS, imagem inválida, etc) — nesse caso o consumidor usa o default.
   *
   * Roda totalmente client-side, sem dependência externa.
   */
  private extrairCorDominante(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const size = 48;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(null);
            ctx.drawImage(img, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;

            // Bucketiza cores em 5 bits por canal (0..31) e prioriza
            // pixels com saturação razoável (descarta cinza/branco/preto).
            const buckets = new Map<number, { r: number; g: number; b: number; w: number }>();
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
              if (a < 200) continue; // semi-transparente / borda
              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const sat = max === 0 ? 0 : (max - min) / max;
              // Ignora quase-cinza, quase-branco e quase-preto
              if (sat < 0.25) continue;
              if (max < 40) continue;
              if (min > 230) continue;
              const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
              const peso = sat * (max / 255);
              const cur = buckets.get(key);
              if (cur) {
                cur.r += r * peso; cur.g += g * peso; cur.b += b * peso; cur.w += peso;
              } else {
                buckets.set(key, { r: r * peso, g: g * peso, b: b * peso, w: peso });
              }
            }

            if (buckets.size === 0) return resolve(null);
            let melhor: { r: number; g: number; b: number; w: number } | null = null;
            for (const v of buckets.values()) {
              if (!melhor || v.w > melhor.w) melhor = v;
            }
            if (!melhor) return resolve(null);
            const r = Math.round(melhor.r / melhor.w);
            const g = Math.round(melhor.g / melhor.w);
            const b = Math.round(melhor.b / melhor.w);
            const hex = '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
            resolve(hex);
          } catch { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      } catch { resolve(null); }
    });
  }

  // ============ Helpers template ============

  /** Cor do círculo do evento conforme o tipo. */
  corEvento(tipo: string): string {
    switch (tipo) {
      case 'gol':         return '#7CC61D';
      case 'gol-contra':  return '#e74c3c';
      case 'amarelo':     return '#ffc409';
      case 'vermelho':    return '#e74c3c';
      case 'azul':        return '#4DABF7';
      case 'falta':       return '#94a3b8';
      default:            return '#000000';
    }
  }
  iconEvento(tipo: string): string {
    switch (tipo) {
      case 'gol':         return 'football';
      case 'gol-contra':  return 'football-outline';
      case 'amarelo':     return 'square';
      case 'vermelho':    return 'square';
      case 'azul':        return 'square';
      case 'falta':       return 'alert-circle-outline';
      case 'sub-entrou':  return 'arrow-down-outline';
      case 'sub-saiu':    return 'arrow-up-outline';
      default:            return 'flash-outline';
    }
  }
  labelEvento(tipo: string): string {
    switch (tipo) {
      case 'gol':             return 'GOOL!';
      case 'gol-contra':      return 'GOL CONTRA';
      case 'amarelo':         return 'CARTÃO AMARELO';
      case 'vermelho':        return 'CARTÃO VERMELHO';
      case 'azul':            return 'CARTÃO AZUL';
      case 'falta':           return 'FALTA';
      case 'defesa':          return 'DEFESA';
      case 'sub-entrou':      return 'ENTROU';
      case 'sub-saiu':        return 'SAIU';
      // Pênaltis (decisão) — labels enfáticos pro broadcast
      case 'pen-convertido':  return 'GOOOOLL!';
      case 'pen-perdido':     return 'PERDEUU!';
      case 'pen-defendido':   return 'DEFENDEUU!';
      default:                return tipo.toUpperCase();
    }
  }

  /** Classe CSS por tipo de evento (idêntica ao jogo-detalhe pra reusar estilos). */
  classeTipo(tipo: string): string {
    switch (tipo) {
      case 'gol':             return 'tipo-gol';
      case 'gol-contra':      return 'tipo-gol-contra';
      case 'amarelo':         return 'tipo-amarelo';
      case 'vermelho':        return 'tipo-vermelho';
      case 'azul':            return 'tipo-azul';
      case 'falta':           return 'tipo-falta';
      case 'defesa':          return 'tipo-defesa';
      // Pênaltis — reusam paleta de gol/vermelho/azul + classe específica
      case 'pen-convertido':  return 'tipo-gol tipo-pen-convertido';
      case 'pen-perdido':     return 'tipo-vermelho tipo-pen-perdido';
      case 'pen-defendido':   return 'tipo-azul tipo-pen-defendido';
      default:                return 'tipo-sub';
    }
  }
  ladoEvento(equipeId: string): 'm' | 'v' | null {
    if (!this.jogo) return null;
    if (equipeId === this.jogo.mandanteId) return 'm';
    if (equipeId === this.jogo.visitanteId) return 'v';
    return null;
  }

  rotuloStatus(): string {
    switch (this.jogo?.status) {
      case 'em-andamento': return 'AO VIVO';
      case 'encerrado':    return 'ENCERRADO';
      case 'cancelado':    return 'CANCELADO';
      case 'wo':           return 'W.O.';
      default:             return 'AGENDADO';
    }
  }

  /**
   * Gera PNG do pôster de fim de jogo via html2canvas e dispara
   * download no navegador. Útil pra postar o resultado nas redes
   * sem precisar tirar screenshot manualmente.
   *
   * Lib `html2canvas` é dinâmico-importada (não infla o bundle inicial).
   */
  async baixarPoster(): Promise<void> {
    if (this.baixandoPoster || !this.posterCaptura?.nativeElement) return;
    this.baixandoPoster = true;
    this.cdr.markForCheck();
    try {
      const { default: html2canvas } = await import('html2canvas');
      const el = this.posterCaptura.nativeElement;
      const canvas = await html2canvas(el, {
        backgroundColor: '#050810',
        scale: 2, // 2x pra ficar nítido em retina
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const m = (this.mandante?.nome || 'mandante').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const v = (this.visitante?.nome || 'visitante').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const placar = `${this.jogo?.golsMandante ?? 0}x${this.jogo?.golsVisitante ?? 0}`;
      link.download = `placarpro_${m}_${placar}_${v}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('[Transmissao] baixarPoster erro', err);
      try {
        const t = await this.toastCtrl?.create?.({
          message: 'Falha ao gerar imagem do pôster.',
          duration: 2500, color: 'danger', position: 'bottom',
        });
        await t?.present?.();
      } catch { /* sem toastCtrl é ok */ }
    } finally {
      this.baixandoPoster = false;
      this.cdr.markForCheck();
    }
  }

  /** Resultado final da partida (pra pôster de fim): 'm' mandante venceu,
   *  'v' visitante venceu, 'e' empate. Usa pênaltis pra desempatar. */
  resultadoFinal(): 'm' | 'v' | 'e' {
    const gm = this.jogo?.golsMandante ?? 0;
    const gv = this.jogo?.golsVisitante ?? 0;
    if (gm > gv) return 'm';
    if (gv > gm) return 'v';
    // Empate no tempo normal — usa pênaltis pra desempatar
    const pm = this.jogo?.penaltisMandante ?? 0;
    const pv = this.jogo?.penaltisVisitante ?? 0;
    if (pm > pv) return 'm';
    if (pv > pm) return 'v';
    return 'e';
  }

  /** Label legível do tempo atual da partida (1º Tempo, Intervalo, etc).
   *  Usado no overlay do scoreboard junto com o cronômetro. */
  labelTempo(t: TempoJogoNome | undefined | null): string {
    switch (t) {
      case 'primeiro':    return '1º Tempo';
      case 'intervalo':   return 'Intervalo';
      case 'segundo':     return '2º Tempo';
      case 'prorrog-1':   return 'Prorrog. 1º';
      case 'prorrog-int': return 'Interv. Prorrog.';
      case 'prorrog-2':   return 'Prorrog. 2º';
      case 'penaltis':    return 'Pênaltis';
      default:            return '';
    }
  }

  /**
   * Re-sincroniza a lista de patrocinadores da partida com base no `this.jogo`
   * atual. Chamado a cada emissão do snapshot do jogo (subscribe realtime),
   * pra refletir add/remove feitos no editor sem precisar reload da página.
   *
   * Detecta se o conteúdo MUDOU (compara IDs/nomes/URLs) antes de re-iniciar
   * a rotação — assim updates não-relacionados a patrocinador (placar, status,
   * cronômetro) não resetam o carrossel à toa.
   */
  private sincronizarPatrocinadores(): void {
    const novaLista: Patrocinador[] = (this.jogo?.patrocinadores ?? [])
      .filter((p: PatrocinadorJogo) => p.logoUrl || p.nome)
      .map((p: PatrocinadorJogo): Patrocinador => ({
        ownerId: '',
        nome: p.nome,
        logoUrl: p.logoUrl,
      }));

    // Compara assinatura (nome+logo) — se idêntico, não mexe na rotação.
    const sigAtual = this.patrocinadores
      .map(p => `${p.nome}|${p.logoUrl ?? ''}`).join('::');
    const sigNova = novaLista.map(p => `${p.nome}|${p.logoUrl ?? ''}`).join('::');
    if (sigAtual === sigNova) return;

    this.patrocinadores = novaLista;
    this.patrocinadorAtualIdx = 0;
    this.patrocinadorAnteriorIdx = -1;
    // Mantém rotação rodando — método já é idempotente (limpa interval antes).
    if (this.patrocinadores.length > 1) {
      this.iniciarRotacao();
    } else {
      this.pararRotacao();
    }
  }

  /**
   * Liga/desliga o cronômetro conforme o estado do jogo.
   * - em-andamento + tempoAtualIniciadoEm → roda timer 1s
   * - encerrado → mostra duração final fixa
   * - outros → zera
   */
  private sincronizarCronometro(): void {
    const j = this.jogo;
    if (!j) {
      this.pararCronometro();
      this.tempoDecorrido.set('00:00');
      return;
    }
    // PAUSADO: relógio congelado no valor `tempoPausadoSegundos`.
    // Espelha o comportamento da tela admin pra o overlay ficar em sync.
    if (j.tempoPausado) {
      this.pararCronometro();
      const seg = j.tempoPausadoSegundos ?? 0;
      const mm = Math.floor(seg / 60);
      const ss = seg % 60;
      this.tempoDecorrido.set(
        `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
      );
      return;
    }
    const baseMs =
      j.tempoAtualIniciadoEm?.toMillis?.() ??
      j.iniciadoEm?.toMillis?.() ??
      0;
    if (j.status === 'em-andamento' && baseMs > 0) {
      this.iniciarCronometro(baseMs);
    } else {
      this.pararCronometro();
      if (j.status === 'encerrado' && baseMs > 0) {
        this.atualizarTempo(baseMs, Date.now());
      } else {
        this.tempoDecorrido.set('00:00');
      }
    }
  }

  private iniciarCronometro(baseMs: number): void {
    this.pararCronometro();
    this.atualizarTempo(baseMs, Date.now());
    this.cronoTimer = setInterval(() => {
      this.atualizarTempo(baseMs, Date.now());
      this.cdr.markForCheck();
    }, 1000);
  }

  private pararCronometro(): void {
    if (this.cronoTimer) {
      clearInterval(this.cronoTimer);
      this.cronoTimer = undefined;
    }
  }

  private atualizarTempo(baseMs: number, agoraMs: number): void {
    const totalSec = Math.max(0, Math.floor((agoraMs - baseMs) / 1000));
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    this.tempoDecorrido.set(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
  }

  trackByEvento(_i: number, e: EventoJogo): string {
    return e.id ?? `${e.tipo}-${e.minuto}-${e.jogadorId}`;
  }

  /**
   * Timestamp em ms pra ordenar eventos do mais novo pro mais antigo.
   *  - `criadoEm` (Firestore Timestamp) é o source-of-truth
   *  - Fallback pro `minuto` (multiplicado pra ms) enquanto o
   *    serverTimestamp não foi gravado (primeira leitura otimista)
   *  - Ordenação estável: eventos com mesmo ts mantêm ordem de chegada
   */
  private tsEvento(e: EventoJogo): number {
    const ts = (e.criadoEm as unknown as { seconds?: number; toMillis?: () => number } | undefined);
    if (ts?.toMillis) return ts.toMillis();
    if (ts?.seconds) return ts.seconds * 1000;
    return (e.minuto ?? 0) * 60000;
  }

  /**
   * Handler do (scroll) no #feedList — controla se o auto-scroll
   * pro topo está ativo. Se o user rolou pra baixo (longe do topo),
   * desativa pra não puxar de volta. Volta a ativar quando o user
   * rola perto do topo (≤ 60px).
   *
   * Funciona porque, com a ordem desc (novo no topo), `scrollTop === 0`
   * significa "está vendo o evento mais recente". Distanciar-se do
   * topo = user quer ler eventos antigos.
   */
  onFeedScroll(ev: Event): void {
    const el = ev.target as HTMLElement;
    this.autoScrollFeed = el.scrollTop <= 60;
  }

  /** Rola o feed pro topo se o auto-scroll estiver ativo. Usa rAF pra
   *  garantir que o DOM já foi atualizado com o novo evento (ngFor). */
  private scrollFeedParaTopoSeAtivo(): void {
    if (!this.autoScrollFeed) return;
    // dupla rAF: 1ª pra Angular renderizar, 2ª pra o navegador layoutar
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = this.feedList?.nativeElement;
      if (!el) return;
      el.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  /**
   * Escolhe a melhor imagem pra cartela do patrocinador na transmissão.
   *
   * Estratégia: prioriza o banner GRANDE pra o publico ver a peça
   * publicitária inteira. Em mobile prefere a versão mobile (mais
   * legível em telas pequenas). Logo vira fallback final pra
   * patrocinadores que ainda não cadastraram banner.
   *
   *  Mobile (≤767px): bannerAppMobileUrl > bannerAppUrl > logoUrl
   *  Desktop:         bannerAppUrl > bannerAppMobileUrl > logoUrl
   */
  urlBannerPatrocinador(p: Patrocinador): string {
    const mobile =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(max-width: 767px)').matches;
    if (mobile) {
      return p.bannerAppMobileUrl || p.bannerAppUrl || p.logoUrl || '';
    }
    return p.bannerAppUrl || p.bannerAppMobileUrl || p.logoUrl || '';
  }

  /**
   * Retorna a lista de cobranças de pênalti de uma equipe na ordem
   * em que foram registradas. Cada cobrança vira um item com `convertido`
   * = true (gol) ou false (perdido/defendido), pra ser pintado como
   * bolinha verde ou vermelha no overlay.
   *
   * Filtra apenas os tipos `pen-convertido`, `pen-perdido`, `pen-defendido`
   * — gols normais (`gol`) NÃO entram aqui mesmo se forem do tempo
   * pênaltis, porque a UI desses é diferente.
   */
  cobrancasPenaltis(lado: 'm' | 'v'): Array<{ convertido: boolean }> {
    return this.eventos
      .filter(ev => ev.lado === lado)
      .filter(ev =>
        ev.tipo === 'pen-convertido' ||
        ev.tipo === 'pen-perdido' ||
        ev.tipo === 'pen-defendido',
      )
      .map(ev => ({ convertido: ev.tipo === 'pen-convertido' }));
  }

  /**
   * Último lance MARCANTE de um lado (mandante/visitante). Usado nas
   * pills inferiores do scoreboard estilo broadcast TV — mostra
   * "GOL · 25' · NOME" do último gol marcado por cada equipe.
   *
   * Prioriza GOLS (gol, gol-contra, pen-convertido) — são os lances
   * que o público quer ver destacados na overlay de transmissão.
   * Retorna `null` se ainda não houve gol pro lado.
   *
   * Como `this.eventos` já vem ordenado do mais NOVO pro mais ANTIGO,
   * basta pegar o primeiro que bater o filtro.
   */
  ultimoLanceLado(lado: 'm' | 'v'): EventoEnriquecido | null {
    return this.eventos
      .filter(ev => ev.lado === lado)
      .find(ev =>
        ev.tipo === 'gol' ||
        ev.tipo === 'gol-contra' ||
        ev.tipo === 'pen-convertido',
      ) ?? null;
  }
}
