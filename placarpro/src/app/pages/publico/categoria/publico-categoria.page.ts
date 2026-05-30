import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { EventoJogo, EventoTipo, Jogo } from '../../../campeonatos/models/jogo.model';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';
import { ConvitesEquipeService, MeuConvite } from '../../../campeonatos/convites-equipe.service';
import { ClassificacaoService, ClassificacaoGrupo } from '../../../campeonatos/classificacao.service';
import { RankingsService, LinhaRanking, TipoRanking } from '../../../campeonatos/rankings.service';
import { MidiasService } from '../../../campeonatos/midias.service';
import { Midia, MidiaTipo } from '../../../campeonatos/models/midia.model';
import { EnquetesService } from '../../../campeonatos/enquetes.service';
import { Enquete } from '../../../campeonatos/models/enquete.model';
import { ModalController, ToastController } from '@ionic/angular';
import { AuthService } from '../../../auth/auth.service';
import { UsersService } from '../../../users/users.service';
import { LoginModalComponent } from '../../../auth/login-modal/login-modal.component';
import { VotarModalComponent } from './votar-modal/votar-modal.component';
import { ViewerModalComponent } from '../../../shared/midia/viewer/viewer.modal';
import { NavBackService } from '../../../shared/nav-back.service';
import { RefreshService } from '../../../shared/refresh.service';

type Secao = 'inicio' | 'equipes' | 'jogos' | 'classificacao' | 'rankings' | 'midia' | 'jogo-detalhe' | 'minha-equipe';

/** Filtro do chip-bar acima do grid de mídias. */
type FiltroMidia = 'todas' | MidiaTipo;
interface FiltroOpcaoMidia {
  id: FiltroMidia;
  label: string;
  icon: string;
}

interface JogoView extends Jogo {
  nomeMandante: string;
  nomeVisitante: string;
  logoMandante?: string;
  logoVisitante?: string;
}

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

@Component({
  selector: 'app-publico-categoria',
  templateUrl: './publico-categoria.page.html',
  styleUrls: ['./publico-categoria.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PublicoCategoriaPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campSrv = inject(CampeonatosService);
  private readonly catSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly transmissoesSrv = inject(TransmissoesService);
  private readonly classifSrv = inject(ClassificacaoService);
  private readonly rankingsSrv = inject(RankingsService);
  private readonly midiasSrv = inject(MidiasService);
  private readonly enquetesSrv = inject(EnquetesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly authSrv = inject(AuthService);
  private readonly usersSrv = inject(UsersService);
  private readonly navBack = inject(NavBackService);
  private readonly refreshSrv = inject(RefreshService);
  private readonly convitesSrv = inject(ConvitesEquipeService);

  /** Estado do botão SEGUIR (true se o user logado já segue este campeonato). */
  segue = false;
  segueLoading = false;

  /** Visitante autenticado? Stream reativo (Firebase Auth resolve async). */
  readonly user$ = this.authSrv.user$;

  campeonato?: Campeonato;
  categoria?: Categoria;
  loading = true;
  erro = false;

  /** Viewport mobile? Sincronizado via matchMedia. Usado pra escolher
   *  entre logo/capa web vs mobile do campeonato. */
  ehMobile = false;

  /** Retorna o logo apropriado pra viewport (fallback no web). */
  logoCamp(c: Campeonato | null | undefined): string | null {
    if (!c) return null;
    if (this.ehMobile && c.logoMobileUrl) return c.logoMobileUrl;
    return c.logoUrl ?? null;
  }

  /** Retorna a capa apropriada — inclui fallback no `bannerUrl` legacy. */
  /** Banner padrão usado em qualquer hero sem imagem cadastrada. */
  readonly bannerPadrao = 'assets/branding/banner-default.svg';

  capaCamp(c: Campeonato | null | undefined): string {
    if (!c) return this.bannerPadrao;
    if (this.ehMobile && c.capaMobileUrl) return c.capaMobileUrl;
    return c.capaUrl || c.bannerUrl || this.bannerPadrao;
  }

  /**
   * Capa pro HERO da página da CATEGORIA — prioriza imagens da própria
   * categoria sobre as do campeonato. Esta é a página pública de UMA
   * categoria específica, então a capa da categoria deve aparecer
   * quando o organizador a configurou; cai pra capa do campeonato só
   * quando a categoria não tem capa própria.
   *
   * Ordem de prioridade (mobile-first dentro de cada nível):
   *   1. categoria.capaMobileUrl   (se mobile)
   *   2. categoria.capaUrl
   *   3. categoria.bannerUrl       (legacy)
   *   4. camp.capaMobileUrl        (se mobile)
   *   5. camp.capaUrl
   *   6. camp.bannerUrl            (legacy)
   *   7. null
   */
  capaHero(camp: Campeonato | null | undefined): string {
    const cat = this.categoria;
    if (cat) {
      if (this.ehMobile && cat.capaMobileUrl) return cat.capaMobileUrl;
      if (cat.capaUrl) return cat.capaUrl;
      if (cat.bannerUrl) return cat.bannerUrl;
    }
    return this.capaCamp(camp);
  }

  secao: Secao = 'inicio';
  menuMobileAberto = false;
  rankingTipo: TipoRanking = 'artilharia';

  /** ID do jogo selecionado pra exibir na seção "Início". */
  private readonly jogoSelSubject = new BehaviorSubject<string | null>(null);

  /** Filtros da sidebar direita */
  filtroFase = '';
  filtroRodada = '';

  /** Aba selecionada na tela de detalhe da partida.
   *  Padrão = 'lances' (prioriza o que importa: gols, cartões, eventos).
   *  Web e mobile sempre abrem na aba de Lances. */
  abaJogo: 'escalacao' | 'lances' = 'lances';

  /** Lado atualmente visível na aba Escalação. Em mobile, mostrar 2
   *  colunas (mandante|visitante) deixa cada uma muito estreita;
   *  segmentar pra mostrar 1 time por vez melhora a UX em telas
   *  pequenas. Default = mandante. */
  escalacaoLado: 'mandante' | 'visitante' = 'mandante';

  selecionarLadoEscalacao(lado: 'mandante' | 'visitante'): void {
    this.escalacaoLado = lado;
  }

  /**
   * Estado mantido por compat — antes alternava entre card e player
   * inline. Agora `iniciarAssistir()` navega direto pra rota pública
   * de transmissão (`/transmissao/:campId/:catId/:jogoId`), que é a
   * mesma usada pela TV admin/broadcaster (read-only pra espectadores).
   */
  assistindoJogo = false;

  /**
   * Cache de Observables `ativa$` por jogoId — usado pelo template
   * pra decidir se mostra o botão "ASSISTIR JOGO AO VIVO". Sem cache,
   * cada CD cycle criaria uma nova subscription Firestore (cara).
   *
   * Helper `temTransmissaoAtiva$(j)` retorna Observable<boolean>
   * filtrado a partir do `transmissoesSrv.ativa$()` — `true` quando
   * tem transmissão `ativa: true` no Firestore, `false` caso contrário.
   */
  private _ativaCache = new Map<string, Observable<boolean>>();

  temTransmissaoAtiva$(j: JogoView | null | undefined): Observable<boolean> {
    if (!j?.id || !this.campeonato?.id || !this.categoria?.id) return of(false);
    const key = `${this.campeonato.id}/${this.categoria.id}/${j.id}`;
    let obs = this._ativaCache.get(key);
    if (!obs) {
      obs = this.transmissoesSrv
        .ativa$(this.campeonato.id, this.categoria.id, j.id)
        .pipe(
          map(tx => !!tx?.ativa),
          startWith(false),
          catchError(() => of(false)),
        );
      this._ativaCache.set(key, obs);
    }
    return obs;
  }

  /**
   * Abre a rota PÚBLICA de transmissão num link. Antes o player era
   * renderizado inline embaixo do card; agora navegamos pra a
   * transmissao.page que tem todos os overlays (placar, banner,
   * feed, etc) — UX idêntica pro espectador e pro admin.
   *
   * Recebe o jogo atual pra montar a URL com os IDs corretos.
   */
  iniciarAssistir(jogoId?: string | null): void {
    const campId = this.campeonato?.id;
    const catId = this.categoria?.id;
    if (!campId || !catId || !jogoId) {
      console.warn('[PublicoCategoria] sem IDs pra abrir transmissão', {
        campId, catId, jogoId,
      });
      return;
    }
    this.router.navigate(['/transmissao', campId, catId, jogoId]);
  }

  equipes$: Observable<Equipe[]> = of([]);
  todosJogos$: Observable<JogoView[]> = of([]);
  jogosFiltrados$: Observable<JogoView[]> = of([]);
  fasesDisponiveis$: Observable<string[]> = of([]);
  rodadasDisponiveis$: Observable<number[]> = of([]);

  jogo$: Observable<JogoView | undefined> = of(undefined);
  eventos$: Observable<EventoView[]> = of([]);
  escalacaoMandante$: Observable<JogadorEscalado[]> = of([]);
  escalacaoVisitante$: Observable<JogadorEscalado[]> = of([]);

  classificacao$: Observable<ClassificacaoGrupo[]> = of([]);
  ranking$: Observable<LinhaRanking[]> = of([]);
  midias$: Observable<Midia[]> = of([]);

  /** Convites do usuário logado VINCULADOS a esta categoria.
   *  Usado pra mostrar (ou esconder) o item "Minha Equipe" no menu lateral
   *  e renderizar a lista de fichas que o usuário pode editar. */
  meusConvitesNestaCategoria$: Observable<MeuConvite[]> = of([]);
  /** Enquetes visíveis da categoria (carregadas na seção "Início"). */
  enquetes$: Observable<Enquete[]> = of([]);
  /** Map enqueteId → IDs das alternativas votadas pelo usuário atual. */
  meusVotos: Record<string, string[]> = {};
  /** Estado de "votando" para mostrar spinner/disable. */
  votando: Record<string, boolean> = {};

  // ─── Filtros do grid de Mídia (chip-bar acima dos cards) ───
  midiasFiltradas$: Observable<Midia[]> = of([]);
  contadores$: Observable<Record<FiltroMidia, number>> = of({
    todas: 0, foto: 0, video: 0, youtube: 0, noticia: 0, link: 0,
  });
  readonly filtroMidia$ = new BehaviorSubject<FiltroMidia>('todas');
  readonly filtrosMidia: FiltroOpcaoMidia[] = [
    { id: 'todas',   label: 'Todas',    icon: 'apps-outline' },
    { id: 'foto',    label: 'Fotos',    icon: 'image-outline' },
    { id: 'video',   label: 'Vídeos',   icon: 'film-outline' },
    { id: 'youtube', label: 'YouTube',  icon: 'logo-youtube' },
    { id: 'noticia', label: 'Notícias', icon: 'newspaper-outline' },
    { id: 'link',    label: 'Links',    icon: 'globe-outline' },
  ];

  /**
   * Aliases legados — o HTML anterior usava `tab` / `jogos$` / `jogadoresCount$`.
   * Mantemos como getters para o template antigo continuar funcionando enquanto
   * a refatoração para `secao` / `todosJogos$` é concluída.
   */
  get tab(): string { return this.secao; }
  set tab(v: string) { this.secao = v as Secao; }
  get jogos$(): Observable<JogoView[]> { return this.todosJogos$; }
  jogadoresCount$: Observable<Map<string, number>> = of(new Map<string, number>());

  trackByEquipeId(_i: number, e: Equipe): string {
    return e.id ?? '';
  }

  async ngOnInit(): Promise<void> {
    // matchMedia pra escolher logo/capa web vs mobile (≤ 767px = mobile).
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(max-width: 767px)');
      this.ehMobile = mql.matches;
      mql.addEventListener('change', ev => { this.ehMobile = ev.matches; });
    }
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    const catId = this.route.snapshot.paramMap.get('catId') ?? '';
    if (!slug || !catId) {
      this.erro = true;
      this.loading = false;
      return;
    }
    try {
      let c = await this.campSrv.getBySlug(slug);
      if (!c) {
        c = await new Promise<Campeonato | undefined>(resolve => {
          const sub = this.campSrv.get$(slug).subscribe(d => {
            resolve(d);
            setTimeout(() => sub.unsubscribe(), 0);
          });
        });
      }
      if (!c || c.publico === false) {
        this.erro = true;
        return;
      }
      this.campeonato = c;

      this.categoria = await new Promise<Categoria | undefined>(resolve => {
        const sub = this.catSrv.get$(c!.id!, catId).subscribe(d => {
          resolve(d);
          setTimeout(() => sub.unsubscribe(), 0);
        });
      });
      if (!this.categoria) {
        this.erro = true;
        return;
      }
      this.setupStreams(c.id!, catId);
      this.observarEstadoSegue();
      this.setupMeusConvites(c.id!, catId);
    } catch (err) {
      console.error('[PublicoCategoria] erro', err);
      this.erro = true;
    } finally {
      this.loading = false;
    }
  }

  private observarEstadoSegue(): void {
    const id = this.campeonato?.id;
    if (!id || !this.authSrv.currentUser) {
      this.segue = false;
      return;
    }
    const sub = this.usersSrv.segue$(id).subscribe(v => {
      this.segue = v;
      setTimeout(() => sub.unsubscribe(), 0);
    });
  }

  /**
   * Configura o stream `meusConvitesNestaCategoria$` — reage ao login/logout
   * do usuário e filtra os convites vinculados ao UID que pertencem a ESTE
   * campeonato + categoria. Usado pra mostrar/ocultar o item "Minha Equipe"
   * no menu lateral e renderizar a lista de fichas editáveis.
   */
  private setupMeusConvites(campId: string, catId: string): void {
    this.meusConvitesNestaCategoria$ = this.user$.pipe(
      switchMap(u => {
        if (!u) return of([] as MeuConvite[]);
        return this.convitesSrv.listMeusConvites$(u.uid).pipe(
          map(list => list.filter(c => c.campeonatoId === campId && c.categoriaId === catId)),
          catchError(() => of([] as MeuConvite[])),
        );
      }),
      startWith([] as MeuConvite[]),
    );
  }

  /** Abre a página pública de inscrição/edição da equipe (mesmo link que o
   *  organizador compartilha). A página `/inscricao/:token` já detecta que
   *  o usuário está logado e entra em modo edição automaticamente. */
  editarMinhaEquipe(token: string): void {
    if (!token) return;
    this.router.navigateByUrl(`/inscricao/${token}`);
  }

  private setupStreams(campId: string, catId: string): void {
    const safe = <T>(o$: Observable<T>, fb: T) =>
      o$.pipe(startWith(fb), catchError(() => of(fb)));

    const equipesObs = safe(this.equipesSrv.list$(campId, catId), [] as Equipe[]);
    const jogadoresObs = safe(this.jogadoresSrv.list$(campId, catId), [] as Jogador[]);
    const jogosBruto$ = safe(this.jogosSrv.list$(campId, catId), [] as Jogo[]);

    this.equipes$ = equipesObs;

    // Lista completa de jogos com nomes/logos
    this.todosJogos$ = combineLatest([jogosBruto$, equipesObs]).pipe(
      map(([js, eqs]) =>
        js.map(j => {
          const m = eqs.find(e => e.id === j.mandanteId);
          const v = eqs.find(e => e.id === j.visitanteId);
          return {
            ...j,
            nomeMandante: m?.nome ?? '?',
            nomeVisitante: v?.nome ?? '?',
            logoMandante: m?.logoUrl,
            logoVisitante: v?.logoUrl,
          } as JogoView;
        }),
      ),
    );

    // Fases distintas
    this.fasesDisponiveis$ = jogosBruto$.pipe(
      map(js => Array.from(new Set(js.map(j => j.fase ?? '').filter(f => f !== ''))).sort()),
    );

    // Rodadas filtradas pela fase atual
    this.rodadasDisponiveis$ = jogosBruto$.pipe(
      map(js => {
        const filtrados = this.filtroFase
          ? js.filter(j => (j.fase ?? '') === this.filtroFase)
          : js;
        return Array.from(
          new Set(filtrados.map(j => j.rodada).filter((r): r is number => r != null)),
        ).sort((a, b) => a - b);
      }),
    );

    // Jogos filtrados (sidebar direita)
    this.jogosFiltrados$ = this.todosJogos$.pipe(
      map(js => {
        let f = js;
        if (this.filtroFase) f = f.filter(j => (j.fase ?? '') === this.filtroFase);
        if (this.filtroRodada) f = f.filter(j => String(j.rodada ?? '') === this.filtroRodada);
        return f;
      }),
    );

    // Seleciona automaticamente o melhor jogo (em-andamento → próximo → primeiro)
    this.todosJogos$.subscribe(js => {
      if (this.jogoSelSubject.value || js.length === 0) return;
      const vivo = js.find(j => j.status === 'em-andamento');
      const naoEncerrado = js.find(j => j.status === 'agendado');
      const alvo = (vivo || naoEncerrado || js[0]).id;
      if (alvo) this.jogoSelSubject.next(alvo);
    });

    // Jogo em destaque
    this.jogo$ = combineLatest([this.todosJogos$, this.jogoSelSubject]).pipe(
      map(([js, id]) => (id ? js.find(j => j.id === id) : undefined)),
    );

    // Eventos do jogo em destaque
    this.eventos$ = this.jogoSelSubject.pipe(
      switchMap(id => {
        if (!id) return of([] as EventoView[]);
        return combineLatest([
          safe(this.jogosSrv.listEventos$(campId, catId, id), [] as EventoJogo[]),
          this.jogo$,
          equipesObs,
          jogadoresObs,
        ]).pipe(
          map(([evs, jogo, eqs, jgs]) => {
            if (!jogo) return [] as EventoView[];
            return evs.map(e => {
              const eq = eqs.find(x => x.id === e.equipeId);
              const jg = e.jogadorId ? jgs.find(j => j.id === e.jogadorId) : undefined;
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
        );
      }),
    );

    // Escalações
    this.escalacaoMandante$ = this.jogo$.pipe(
      switchMap(j => {
        if (!j?.id) return of<JogadorEscalado[]>([]);
        return combineLatest([
          safe(this.jogosSrv.escalacao$(campId, catId, j.id, j.mandanteId), [] as string[]),
          jogadoresObs,
          this.eventos$,
        ]).pipe(map(([ids, jgs, evs]) => this.montarEscalados(ids, jgs, evs, j.mandanteId)));
      }),
    );

    this.escalacaoVisitante$ = this.jogo$.pipe(
      switchMap(j => {
        if (!j?.id) return of<JogadorEscalado[]>([]);
        return combineLatest([
          safe(this.jogosSrv.escalacao$(campId, catId, j.id, j.visitanteId), [] as string[]),
          jogadoresObs,
          this.eventos$,
        ]).pipe(map(([ids, jgs, evs]) => this.montarEscalados(ids, jgs, evs, j.visitanteId)));
      }),
    );

    // Classificação
    this.classificacao$ = safe(
      this.classifSrv.classificacao$(campId, catId, null, false),
      [] as ClassificacaoGrupo[],
    );

    // Ranking
    this.ranking$ = safe(
      this.rankingsSrv.ranking$(campId, catId, this.rankingTipo),
      [] as LinhaRanking[],
    );

    // Mídias da categoria
    this.midias$ = safe(
      this.midiasSrv.list$(campId, catId),
      [] as Midia[],
    );
    // Contadores por tipo e lista filtrada (alimenta o chip-bar e o grid).
    this.contadores$ = this.midias$.pipe(map(mds => this.calcularContadoresMidia(mds)));
    this.midiasFiltradas$ = combineLatest([this.midias$, this.filtroMidia$]).pipe(
      map(([mds, f]) => (f === 'todas' ? mds : mds.filter(m => m.tipo === f))),
    );

    // Enquetes da categoria — só as marcadas como visíveis pelo organizador.
    // `safe` cai num array vazio se as Firestore Rules barrarem o anônimo.
    this.enquetes$ = safe(
      this.enquetesSrv.list$(campId, catId),
      [] as Enquete[],
    ).pipe(
      map(arr => arr.filter(e => e.visivel !== false)),
    );

    // Se o usuário está logado, carrega os votos dele para cada enquete
    // visível e popula `meusVotos` (usado pra esconder o select + mostrar
    // o resultado direto pra quem já votou).
    this.enquetes$
      .pipe(
        switchMap(enqs => {
          const uid = this.authSrv.currentUser?.uid;
          if (!uid || enqs.length === 0) return of({} as Record<string, string[]>);
          // Para cada enquete, busca o voto do uid (1 leitura por enquete visível).
          const obs = enqs.map(e =>
            this.enquetesSrv.meuVoto$(campId, catId, e.id!).pipe(
              map(v => [e.id!, v?.alternativaIds ?? []] as const),
              catchError(() => of([e.id!, []] as const)),
            ),
          );
          return combineLatest(obs).pipe(
            map(pares => Object.fromEntries(pares) as Record<string, string[]>),
          );
        }),
      )
      .subscribe(map_ => { this.meusVotos = map_; });
  }

  /**
   * Submete o voto do usuário numa enquete.
   * - Se não estiver logado, abre o modal de login (mesmo fluxo do botão Seguir).
   * - Se a enquete não permite múltipla escolha, manda 1 alternativaId.
   */
  async votarEnquete(enquete: Enquete, alternativaId: string): Promise<void> {
    if (!enquete.id) return;
    if (!enquete.votacaoAberta) return;
    const campId = this.campeonato?.id;
    const catId = this.categoria?.id;
    if (!campId || !catId) return;

    if (!this.authSrv.currentUser) {
      // Sem login → abre o modal de login (não navega)
      const modal = await this.modalCtrl.create({
        component: LoginModalComponent,
        cssClass: 'modal-login',
      });
      await modal.present();
      return;
    }

    // Toggle: se múltipla escolha, adiciona/remove. Se única, substitui.
    const atuais = this.meusVotos[enquete.id] ?? [];
    let novos: string[];
    if (enquete.multiplaEscolha) {
      novos = atuais.includes(alternativaId)
        ? atuais.filter(id => id !== alternativaId)
        : [...atuais, alternativaId];
      if (novos.length === 0) return; // não permite "desmarcar tudo" — exige ≥ 1
    } else {
      novos = [alternativaId];
    }

    this.votando[enquete.id] = true;
    try {
      await this.enquetesSrv.votar(campId, catId, enquete.id, novos);
      this.meusVotos = { ...this.meusVotos, [enquete.id]: novos };
    } catch (err) {
      console.error('[Enquete] votar erro', err);
      const t = await this.toastCtrl.create({
        message: (err as Error).message || 'Não foi possível registrar o voto.',
        duration: 2400,
        position: 'top',
        color: 'danger',
      });
      await t.present();
    } finally {
      this.votando[enquete.id] = false;
    }
  }

  /**
   * Abre o modal "Votar" pra o usuário escolher uma alternativa.
   * Se anônimo, dispara o login modal antes.
   * Após confirmar, o card da enquete atualiza pela stream do Firestore.
   */
  async abrirVotacaoModal(enquete: Enquete): Promise<void> {
    if (!enquete.id) return;
    if (!enquete.votacaoAberta) return;
    const campId = this.campeonato?.id;
    const catId = this.categoria?.id;
    if (!campId || !catId) return;

    if (!this.authSrv.currentUser) {
      const modal = await this.modalCtrl.create({
        component: LoginModalComponent,
        cssClass: 'modal-login',
      });
      await modal.present();
      return;
    }

    const modal = await this.modalCtrl.create({
      component: VotarModalComponent,
      componentProps: {
        enquete,
        campeonatoId: campId,
        categoriaId: catId,
        jaVotados: this.meusVotos[enquete.id] ?? [],
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ voted?: boolean; alternativaIds?: string[] }>();
    if (data?.voted && data.alternativaIds && enquete.id) {
      this.meusVotos = { ...this.meusVotos, [enquete.id]: data.alternativaIds };
    }
  }

  /** True se o usuário atual já votou nessa enquete. */
  jaVotou(enquete: Enquete): boolean {
    return !!enquete.id && (this.meusVotos[enquete.id]?.length ?? 0) > 0;
  }

  /** True se a alternativa está marcada nos votos do usuário. */
  votouNessa(enquete: Enquete, alternativaId: string): boolean {
    return !!enquete.id && (this.meusVotos[enquete.id] ?? []).includes(alternativaId);
  }

  /** % de votos de uma alternativa em relação ao total. */
  percentualEnq(enquete: Enquete, votos: number): number {
    const total = enquete.totalVotos ?? 0;
    if (total <= 0) return 0;
    return Math.round((votos / total) * 100);
  }

  trackByEnquete(_i: number, e: Enquete): string { return e.id ?? ''; }
  trackByAlternativa(_i: number, a: { id: string }): string { return a.id; }

  /** Chip-bar do filtro de mídias. */
  selecionarFiltroMidia(f: FiltroMidia): void {
    this.filtroMidia$.next(f);
  }

  private calcularContadoresMidia(mds: Midia[]): Record<FiltroMidia, number> {
    const c: Record<FiltroMidia, number> = {
      todas: mds.length, foto: 0, video: 0, youtube: 0, noticia: 0, link: 0,
    };
    for (const m of mds) c[m.tipo]++;
    return c;
  }

  trackByFiltroMidia(_i: number, f: FiltroOpcaoMidia): string {
    return f.id;
  }

  /** Thumbnail/imagem principal da mídia (foto/notícia/youtube). */
  thumbMidia(m: Midia): string | null {
    if (m.tipo === 'foto') return m.arquivoUrl ?? null;
    if (m.tipo === 'noticia') return m.capaUrl ?? null;
    if (m.tipo === 'youtube' && m.youtubeId) {
      return `https://i.ytimg.com/vi/${m.youtubeId}/hqdefault.jpg`;
    }
    return null;
  }

  iconeMidia(t: Midia['tipo']): string {
    switch (t) {
      case 'foto':    return 'image-outline';
      case 'video':   return 'film-outline';
      case 'youtube': return 'logo-youtube';
      case 'link':    return 'globe-outline';
      case 'noticia': return 'newspaper-outline';
    }
  }

  labelMidia(t: Midia['tipo']): string {
    switch (t) {
      case 'foto':    return 'Foto';
      case 'video':   return 'Vídeo';
      case 'youtube': return 'YouTube';
      case 'link':    return 'Link';
      case 'noticia': return 'Notícia';
    }
  }

  /**
   * Abre o `ViewerModalComponent` por cima da página em vez de redirecionar
   * pra outra aba. O viewer renderiza foto, vídeo, embed do youtube, notícia
   * (com capa + texto) ou um card central pro link externo.
   */
  async abrirMidia(m: Midia): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ViewerModalComponent,
      componentProps: { midia: m },
      cssClass: 'midia-viewer-modal',
    });
    await modal.present();
  }

  trackByMidia(_i: number, m: Midia): string {
    return m.id ?? `${_i}`;
  }

  selecionarAba(a: 'escalacao' | 'lances'): void {
    this.abaJogo = a;
  }

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

  selecionarJogo(jogoId: string): void {
    this.jogoSelSubject.next(jogoId);
    this.secao = 'jogo-detalhe';
    this.menuMobileAberto = false;
    // Scroll para o topo do conteúdo
    setTimeout(() => {
      const el = document.querySelector('.publico-conteudo');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  irPara(secao: Secao): void {
    this.secao = secao;
    this.menuMobileAberto = false;
  }

  trocarRanking(tipo: TipoRanking): void {
    if (tipo === this.rankingTipo) return;
    this.rankingTipo = tipo;
    if (this.campeonato?.id && this.categoria?.id) {
      this.ranking$ = this.rankingsSrv
        .ranking$(this.campeonato.id, this.categoria.id, tipo)
        .pipe(
          startWith([] as LinhaRanking[]),
          catchError(() => of([] as LinhaRanking[])),
        );
    }
  }

  onFiltroFase(value: string): void {
    this.filtroFase = value;
    this.filtroRodada = '';
    this.aplicarFiltros();
  }

  onFiltroRodada(value: string): void {
    this.filtroRodada = value;
    this.aplicarFiltros();
  }

  private aplicarFiltros(): void {
    // Re-emite o filtro pegando os streams base
    this.jogosFiltrados$ = this.todosJogos$.pipe(
      map(js => {
        let f = js;
        if (this.filtroFase) f = f.filter(j => (j.fase ?? '') === this.filtroFase);
        if (this.filtroRodada) f = f.filter(j => String(j.rodada ?? '') === this.filtroRodada);
        return f;
      }),
    );
    this.rodadasDisponiveis$ = this.todosJogos$.pipe(
      map(js => {
        const filtrados = this.filtroFase
          ? js.filter(j => (j.fase ?? '') === this.filtroFase)
          : js;
        return Array.from(
          new Set(filtrados.map(j => j.rodada).filter((r): r is number => r != null)),
        ).sort((a, b) => a - b);
      }),
    );
  }

  voltar(): void {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.navBack.back(['/', slug]);
  }

  voltarHome(): void {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.router.navigate(['/', slug]);
  }

  /** Volta para a tela anterior lógica:
   *  - Se logado → `/espectador` (Minhas Equipes — lista de convites do usuário)
   *  - Se NÃO logado → `/` (Home pública — landing com lista de campeonatos)
   *  Assim o botão "Voltar" sempre faz sentido, independente do auth. */
  voltarParaMinhasEquipes(): void {
    // Antes: `router.navigateByUrl(destino)` ignorava o histórico de
    // navegação — clicar Voltar SEMPRE jogava o usuário pra /espectador
    // (ou /), mesmo quando ele tinha vindo de outra tela (ex: home →
    // categoria; clicar Voltar deveria voltar pra home, não pular pra
    // "Minhas Equipes"). Agora usa `navBack.back()` que respeita o
    // histórico real, com fallback pro destino correto SE for primeira
    // tela da sessão (acesso via URL direta / refresh). Mesmo padrão
    // já usado em `publico.page.ts`. */
    const fallback = this.estaLogado ? '/espectador' : '/';
    this.navBack.back(fallback);
  }

  /** Helper de template — true se o usuário está logado. */
  get estaLogado(): boolean {
    return !!this.authSrv.currentUser;
  }

  async fazerLogin(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: LoginModalComponent,
      backdropDismiss: true,
      cssClass: 'modal-login',
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ saved?: boolean }>();
    if (data?.saved) {
      this.observarEstadoSegue();
    }
  }

  async sair(): Promise<void> {
    try {
      await this.authSrv.signOut();
      this.segue = false;
      // Volta pra tela principal (home pública) depois de deslogar.
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      console.error('[PublicoCategoria] signOut erro', err);
      await this.toastInfo('Erro ao sair.', 'danger');
    }
  }

  /** Pull-to-refresh: recarrega APENAS esta rota (Angular Router) — mantém
   *  o usuário aqui em vez de cair na rota fallback. */
  async onRefresh(ev: CustomEvent): Promise<void> {
    await this.refreshSrv.refreshAtual(ev);
  }

  async clickSeguir(): Promise<void> {
    if (this.segueLoading) return;
    if (!this.authSrv.currentUser) {
      // Não logado → abre modal de login. Se logar, re-faz o click pra seguir.
      await this.fazerLogin();
      if (this.authSrv.currentUser) {
        // Pós-login: já segue automaticamente
        await this.toggleSegue();
      }
      return;
    }
    await this.toggleSegue();
  }

  private async toggleSegue(): Promise<void> {
    const id = this.campeonato?.id;
    if (!id) return;
    this.segueLoading = true;
    try {
      if (this.segue) {
        await this.usersSrv.deixarDeSeguir(id);
        try { await this.campSrv.ajustarContadorSeguidores(id, -1); } catch { /* ignore */ }
        this.segue = false;
        await this.toastInfo('Você deixou de seguir.', 'success');
      } else {
        await this.usersSrv.seguir(id);
        try { await this.campSrv.ajustarContadorSeguidores(id, +1); } catch { /* ignore */ }
        this.segue = true;
        await this.toastInfo('Você agora segue este campeonato!', 'success');
      }
    } catch (err) {
      console.error('[PublicoCategoria] toggleSegue', err);
      await this.toastInfo('Falha ao atualizar. Tente novamente.', 'danger');
    } finally {
      this.segueLoading = false;
    }
  }

  private async toastInfo(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }

  /** Itens do menu lateral (público): Início → Equipes da categoria. */
  readonly menuPublico: { id: Secao; label: string; icon: string }[] = [
    { id: 'inicio',        label: 'Início',                   icon: 'home-outline' },
    { id: 'jogos',         label: 'Jogos',                    icon: 'calendar-outline' },
    { id: 'classificacao', label: 'Classificação',            icon: 'podium-outline' },
    { id: 'rankings',      label: 'Rankings e votações',      icon: 'stats-chart-outline' },
    { id: 'midia',         label: 'Fotos, Vídeos e notícias', icon: 'images-outline' },
  ];

  selecionarSecao(s: Secao): void {
    this.secao = s;
  }

  async compartilhar(): Promise<void> {
    if (!this.campeonato) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: this.categoria?.titulo ?? this.campeonato.titulo,
          text: 'Acompanhe este campeonato no PlacarPro',
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch { /* cancelado */ }
  }

  rotuloStatus(arg?: string | JogoView): string {
    const s = typeof arg === 'string' ? arg : arg?.status;
    switch (s) {
      case 'encerrado': return 'Encerrado';
      case 'em-andamento': return 'Ao Vivo';
      case 'cancelado': return 'Cancelado';
      case 'wo': return 'W.O.';
      default: return 'Agendado';
    }
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

  iconeTipo(t: EventoTipo): string {
    switch (t) {
      case 'gol':
      case 'gol-contra': return 'football-outline';
      case 'amarelo':
      case 'vermelho':
      case 'azul': return 'square';
      case 'falta': return 'hand-left-outline';
      case 'defesa': return 'hand-right-outline';
      default: return 'swap-horizontal-outline';
    }
  }

  corMedalha(pos: number): string | null {
    if (pos === 1) return '#FFD43B';
    if (pos === 2) return '#CED4DA';
    if (pos === 3) return '#E8A87C';
    return null;
  }

  trackByJogo(_i: number, j: JogoView): string {
    return j.id ?? '';
  }
  trackByEvento(_i: number, e: EventoView): string {
    return e.id ?? '';
  }
  trackByEscalado(_i: number, e: JogadorEscalado): string {
    return e.jogador.id ?? '';
  }
  trackByRanking(_i: number, l: LinhaRanking): string {
    return l.jogador.id ?? `${_i}`;
  }
  trackByGrupo(_i: number, g: ClassificacaoGrupo): string {
    return g.grupo?.id ?? `g-${_i}`;
  }
  trackByLinha(_i: number, l: { equipe: Equipe }): string {
    return l.equipe.id ?? `l-${_i}`;
  }
}
