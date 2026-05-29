import { Component, inject, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Observable, combineLatest, filter, map, of, switchMap } from 'rxjs';
import { User } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';
import { CampeonatosService } from '../campeonatos/campeonatos.service';
import { CategoriasService } from '../campeonatos/categorias.service';
import { Campeonato } from '../campeonatos/campeonato.model';
import { Categoria } from '../campeonatos/categoria.model';
import { CampeonatoThemeService } from '../shared/campeonato-theme.service';
import { UsersService } from '../users/users.service';
import { startWith, catchError } from 'rxjs/operators';
import { AdminNavigationService } from '../shared/admin-navigation.service';
import { NavBackService } from '../shared/nav-back.service';
import { ModeradorPermissoesService, PermissoesEfetivas } from '../shared/moderador-permissoes.service';
import { TipoConta } from '../users/models/user-profile.model';

interface MenuItem {
  label: string;
  icon: string;
  path: string;
  /** Query params opcionais — usados pra passar contexto pra páginas
   *  globais que precisam saber de onde foram abertas (ex: patrocinadores
   *  do campeonato X). */
  queryParams?: Record<string, string>;
  /** Permissão necessária pra item aparecer — quando setado, o item só
   *  aparece se o user logado tiver essa permissão (dono/admin sempre
   *  veem). Usado pra esconder Config, Patrocinadores, Equipes etc
   *  pra moderadores sem `editarCampeonato`. */
  requirePerm?:
    | 'editarCampeonato'
    | 'gerenciarEquipes'
    | 'editarResultados'
    | 'enviarMidias'
    | 'gerenciarEnquetes';
  /** Esconde o item para esses tipos de conta (`users/{uid}.tipo`).
   *  Quando ausente, o item aparece pra todos. Útil pra esconder páginas
   *  exclusivas do organizador (cadastros, planos, arbitragem etc) pra
   *  moderadores/clientes/rachas. */
  hideForTipo?: TipoConta[];
}

type ShellMode = 'global' | 'campeonato' | 'categoria';

@Component({
  selector: 'app-shell',
  templateUrl: './shell.page.html',
  styleUrls: ['./shell.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ShellPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly campTheme = inject(CampeonatoThemeService);
  private readonly usersSrv = inject(UsersService);
  private readonly adminNav = inject(AdminNavigationService);
  private readonly navBack = inject(NavBackService);
  private readonly modPerms = inject(ModeradorPermissoesService);

  /** Signal exposto pro template — true enquanto o admin "veio do painel".
   *  Quando true, mostra a faixa flutuante "Voltar pro Painel Admin" no
   *  topo do shell, em qualquer rota `/app/*` exceto a própria `/app/admin`. */
  readonly voltandoDoAdmin = this.adminNav.navegando;

  readonly user$: Observable<User | null> = this.auth.user$;

  /** True APENAS quando o UID logado está hardcoded em
   *  `environment.adminMasterUids`. Usado pra mostrar o item "Painel Admin"
   *  no menu lateral.
   *
   *  Antes usávamos `isMaster$()` (que considera o campo `isMaster: true` no
   *  doc Firestore também), mas isso vazava o item pra organizadores antigos
   *  que se promoveram via o código de convite `admin-master` (vetor agora
   *  fechado no signup, mas docs antigos persistem). A checagem hardcoded
   *  garante que só os super-admins permanentes vejam o item, independente
   *  do estado do doc.
   *
   *  NOTA: usuários com `isMaster: true` ainda conseguem ACESSAR `/app/admin`
   *  via URL direta (o adminGuard aceita os dois caminhos). Pra fechar isso
   *  também, dá pra trocar `isMasterAsync` no adminGuard pelo isHardcoded —
   *  mas mantemos por enquanto pra não quebrar o painel de admins promovidos
   *  legítimos (caso existam). */
  readonly isMaster$: Observable<boolean> = this.usersSrv.isHardcodedAdmin$().pipe(
    startWith(false),
    catchError(() => of(false)),
  );

  /** Modo da sidebar baseado na rota atual. */
  readonly mode = signal<ShellMode>('global');
  readonly campeonatoId = signal<string | null>(null);
  readonly categoriaId = signal<string | null>(null);

  /** No mobile (≤ 767px) a sidebar é off-canvas. true = visível. */
  readonly sidebarAberta = signal<boolean>(false);

  /** Indica se a tela está em largura mobile. Atualiza no resize. */
  readonly mobile = signal<boolean>(
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );

  /** Stream do campeonato atual (reage a mudanças do signal). */
  readonly campeonato$: Observable<Campeonato | undefined> = toObservable(this.campeonatoId).pipe(
    switchMap(id => (id ? this.campeonatosSrv.get$(id) : of(undefined))),
  );

  /** Signal do tipo do campeonato atual ('unico' | 'com-categorias').
   *  Alimentado pelo subscribe do `campeonato$` no constructor.
   *  Usado pelo `menuCategoriaBase` pra decidir se o item "Configurações"
   *  do menu lateral aponta pro config do CAMPEONATO (quando único — não
   *  há categoria pra configurar separada) ou da CATEGORIA. */
  readonly campeonatoTipo = signal<Campeonato['tipo'] | undefined>(undefined);

  readonly categoria$: Observable<Categoria | undefined> = combineLatest([
    toObservable(this.campeonatoId),
    toObservable(this.categoriaId),
  ]).pipe(
    switchMap(([cId, catId]) =>
      cId && catId ? this.categoriasSrv.get$(cId, catId) : of(undefined),
    ),
  );

  /**
   * Menu global (lateral esquerda nas rotas `/app/*` sem campeonato selecionado).
   *
   * Items com `hideForTipo` são automaticamente filtrados pra contas que NÃO
   * são organizador (moderador, cliente, racha não precisam ver cadastros,
   * planos, arbitragem etc). A filtragem acontece em `menuGlobal$`.
   *
   * Itens sempre visíveis (sem `hideForTipo`):
   *  - Meus campeonatos (moderador vê os campeonatos que modera; cliente
   *    vê vazio mas mantém pra UX consistente)
   *  - Campeonatos seguindo (qualquer um pode seguir)
   *  - Configurações (do próprio perfil)
   */
  private readonly menuGlobalBase: MenuItem[] = [
    { label: 'Meus campeonatos', icon: 'trophy-outline', path: '/app/meus-campeonatos' },
    { label: 'Cadastro de equipes', icon: 'list-outline', path: '/app/equipes', hideForTipo: ['cliente', 'moderador', 'racha'] },
    { label: 'Cadastro de jogadores', icon: 'people-outline', path: '/app/jogadores', hideForTipo: ['cliente', 'moderador', 'racha'] },
    { label: 'Página do organizador', icon: 'business-outline', path: '/app/organizador', hideForTipo: ['cliente', 'moderador', 'racha'] },
    { label: 'Planos de assinatura', icon: 'card-outline', path: '/app/planos', hideForTipo: ['cliente', 'moderador', 'racha'] },
    { label: 'Campeonatos seguindo', icon: 'thumbs-up-outline', path: '/app/seguindo' },
    { label: 'Arbitragem', icon: 'person-outline', path: '/app/arbitragem', hideForTipo: ['cliente', 'moderador', 'racha'] },
    /* "Apoios e Patrocinadores" foi movido pro menu contextual da categoria
       (`menuCategoria`) — só aparece quando o usuário está navegando dentro
       de uma categoria específica. A página continua sendo a mesma global
       em `/app/patrocinadores` (dados são por user, não por categoria). */
    { label: 'Locais de jogo', icon: 'location-outline', path: '/app/locais', hideForTipo: ['cliente', 'moderador', 'racha'] },
    { label: 'Formulário', icon: 'document-text-outline', path: '/app/formulario', hideForTipo: ['cliente', 'moderador', 'racha'] },
    { label: 'Configurações', icon: 'settings-outline', path: '/app/configuracoes' },
  ];

  /** Menu global filtrado pelo tipo de conta do user logado. Stream pra
   *  reagir a mudanças de perfil (raro, mas mantém consistência). */
  readonly menuGlobal$: Observable<MenuItem[]> = this.usersSrv.profile$().pipe(
    startWith(undefined),
    map(profile => {
      const tipo = profile?.tipo;
      return this.menuGlobalBase.filter(item => {
        if (!item.hideForTipo || !tipo) return true;
        return !item.hideForTipo.includes(tipo);
      });
    }),
    catchError(() => of(this.menuGlobalBase)),
  );

  /** Menus base (TODOS os itens, sem filtro) — fonte da verdade.
   *  `menuCampeonato$`/`menuCategoria$` filtram esses arrays via
   *  permissões do user logado. */
  private readonly menuCampeonatoBase = computed<MenuItem[]>(() => {
    const id = this.campeonatoId();
    if (!id) return [];

    // Campeonato tipo "único": como só tem 1 categoria (auto-criada),
    // o menu do nível campeonato é redundante — o usuário navega tudo
    // pelo menu da categoria (que já inclui Configurações apontando
    // pro config do campeonato, ver menuCategoriaBase). Retornar []
    // esconde tanto a sidebar desktop quanto a tab-bar mobile.
    if (this.campeonatoTipo() === 'unico') return [];

    const base = `/app/campeonato/${id}`;
    return [
      { label: 'Início', icon: 'home-outline', path: `${base}/inicio` },
      {
        label: 'Fotos, Vídeos e notícias',
        icon: 'images-outline',
        path: `${base}/midia`,
        requirePerm: 'enviarMidias',
      },
      {
        label: 'Apoios e Patrocinadores',
        icon: 'megaphone-outline',
        path: '/app/patrocinadores',
        queryParams: { campeonatoId: id },
        requirePerm: 'editarCampeonato',
      },
      {
        label: 'Configurações',
        icon: 'settings-outline',
        path: `${base}/config`,
        requirePerm: 'editarCampeonato',
      },
    ];
  });

  private readonly menuCategoriaBase = computed<MenuItem[]>(() => {
    const id = this.campeonatoId();
    const catId = this.categoriaId();
    if (!id || !catId) return [];
    const base = `/app/campeonato/${id}/categoria/${catId}`;

    // Quando o campeonato é "único" (sem categorias), o config da
    // CATEGORIA é redundante — o usuário pensa nele como um campeonato
    // só, então o item "Configurações" do menu lateral aponta pro
    // config do CAMPEONATO em vez do config da CATEGORIA. Quando o
    // campeonato é "com-categorias", aí faz sentido configurar cada
    // categoria separadamente.
    const tipo = this.campeonatoTipo();
    const configPath = tipo === 'unico'
      ? `/app/campeonato/${id}/config`
      : `${base}/config`;

    const items: MenuItem[] = [
      { label: 'Início', icon: 'home-outline', path: `${base}/inicio` },
      {
        label: 'Equipes',
        icon: 'shield-outline',
        path: `${base}/equipes`,
        requirePerm: 'gerenciarEquipes',
      },
      {
        label: 'Jogos',
        icon: 'calendar-outline',
        path: `${base}/jogos`,
        requirePerm: 'editarResultados',
      },
      { label: 'Classificação', icon: 'podium-outline', path: `${base}/classificacao` },
      { label: 'Rankings e votações', icon: 'stats-chart-outline', path: `${base}/rankings` },
      {
        label: 'Fotos, Vídeos e notícias',
        icon: 'images-outline',
        path: `${base}/midia`,
        requirePerm: 'enviarMidias',
      },
      { label: 'Relatórios', icon: 'print-outline', path: `${base}/relatorios` },
    ];

    // Quando o campeonato é "único", o `menuCampeonato` retorna [] —
    // o user navega tudo pelo menu da categoria. Por isso "Apoios e
    // Patrocinadores" (que normalmente vive no menu campeonato) precisa
    // aparecer aqui também, senão fica inacessível pela sidebar nesse
    // tipo de campeonato. Em "com-categorias" o item continua só no
    // menuCampeonato pra não duplicar.
    if (tipo === 'unico') {
      items.push({
        label: 'Apoios e Patrocinadores',
        icon: 'megaphone-outline',
        path: '/app/patrocinadores',
        queryParams: { campeonatoId: id },
        requirePerm: 'editarCampeonato',
      });
    }

    items.push({
      label: 'Configurações',
      icon: 'settings-outline',
      path: configPath,
      requirePerm: 'editarCampeonato',
    });

    return items;
  });

  /** Stream das permissões do user logado no campeonato atual. Atualiza
   *  conforme o usuário navega entre campeonatos diferentes. */
  readonly permissoesCampAtual$: Observable<PermissoesEfetivas> = toObservable(this.campeonatoId).pipe(
    switchMap(id => (id ? this.modPerms.efetivas$(id) : of<PermissoesEfetivas>({
      nivel: 'nenhum',
      editarCampeonato: false,
      gerenciarEquipes: false,
      editarResultados: false,
      enviarMidias: false,
      gerenciarEnquetes: false,
    }))),
  );

  /** Menu do campeonato filtrado — só mostra items que o user pode acessar.
   *  Dono/admin enxergam tudo (todas as perms vêm true). */
  readonly menuCampeonato$: Observable<MenuItem[]> = combineLatest([
    toObservable(this.campeonatoId),
    this.permissoesCampAtual$,
  ]).pipe(
    map(([, perms]) => this.filtrarMenu(this.menuCampeonatoBase(), perms)),
  );

  readonly menuCategoria$: Observable<MenuItem[]> = combineLatest([
    toObservable(this.campeonatoId),
    toObservable(this.categoriaId),
    this.permissoesCampAtual$,
  ]).pipe(
    map(([, , perms]) => this.filtrarMenu(this.menuCategoriaBase(), perms)),
  );

  private filtrarMenu(items: MenuItem[], perms: PermissoesEfetivas): MenuItem[] {
    return items.filter(it => {
      if (!it.requirePerm) return true;
      return perms[it.requirePerm] === true;
    });
  }

  constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        this.updateMode();
        // Auto-fecha a sidebar ao navegar no mobile
        if (this.mobile()) this.sidebarAberta.set(false);

        // CRÍTICO: força clear do tema do campeonato SEMPRE que entrar
        // numa rota global. Antes dependia só do `campeonato$` re-emitir
        // — mas quando o stream estava em cache do RxJS e não re-emitia
        // ao navegar pra global, o sidebar/header ficava com a cor do
        // último campeonato visitado. Resultado: tons "perdidos" mesmo
        // com a página em modo global. Agora a limpeza acontece SEMPRE
        // no NavigationEnd, independente do estado do observable.
        if (this.mode() === 'global') {
          this.campTheme.clear();
        }
      });
    this.updateMode();
    // Também aplica no boot inicial — se o user abrir direto numa URL
    // global, o tema fica garantido limpo desde o primeiro frame.
    if (this.mode() === 'global') {
      this.campTheme.clear();
    }

    // Sincroniza a cor do campeonato com o tema visual da rota corrente.
    // Também atualiza o `campeonatoTipo` signal — usado no menuCategoriaBase
    // pra decidir se "Configurações" aponta pro config do campeonato (único)
    // ou da categoria.
    this.campeonato$.subscribe(camp => {
      this.campeonatoTipo.set(camp?.tipo);
      if (this.mode() === 'global' || !camp) {
        this.campTheme.clear();
      } else {
        this.campTheme.setCor(camp.cor ?? null);
      }
    });

    // Atualiza estado mobile ao redimensionar
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        const isMobile = window.matchMedia('(max-width: 767px)').matches;
        this.mobile.set(isMobile);
        if (!isMobile) this.sidebarAberta.set(false);
      });
    }
  }

  toggleSidebar(): void {
    this.sidebarAberta.update(v => !v);
  }

  fecharSidebar(): void {
    this.sidebarAberta.set(false);
  }

  /** Volta pro Painel Admin (chamado pela faixa flutuante). Limpa o flag. */
  voltarParaAdmin(): void {
    this.adminNav.encerrar();
    this.router.navigateByUrl('/app/admin');
  }

  /** Helper template — true se NÃO estamos na rota /app/admin
   *  (não faz sentido mostrar a faixa lá). */
  get podeMostrarFaixaAdmin(): boolean {
    return !this.router.url.startsWith('/app/admin');
  }

  private updateMode(): void {
    const url = this.router.url;
    const cat = url.match(/^\/app\/campeonato\/([^/]+)\/categoria\/([^/]+)/);
    const camp = url.match(/^\/app\/campeonato\/([^/]+)/);

    if (cat) {
      this.campeonatoId.set(cat[1]);
      this.categoriaId.set(cat[2]);
      this.mode.set('categoria');
      return;
    }
    if (camp) {
      this.campeonatoId.set(camp[1]);
      this.categoriaId.set(null);
      this.mode.set('campeonato');
      return;
    }

    // Rotas GLOBAIS que aceitam `?campeonatoId=XXX` pra ficar no contexto
    // do campeonato (ex: /app/patrocinadores). Quando o param tá presente,
    // mantemos o menu lateral do campeonato em vez de cair pro menu geral.
    // Sem isso, clicar em "Apoios e Patrocinadores" pela sidebar do
    // campeonato fazia o menu mudar pra "Meus campeonatos / Equipes / ..."
    // como se o usuário tivesse saído do campeonato.
    const queryCampId = this.extrairCampeonatoIdDaQuery(url);
    if (queryCampId) {
      this.campeonatoId.set(queryCampId);
      this.categoriaId.set(null);
      this.mode.set('campeonato');
      return;
    }

    this.campeonatoId.set(null);
    this.categoriaId.set(null);
    this.mode.set('global');
  }

  /** Extrai `campeonatoId` da query string da URL (ex: `?campeonatoId=abc`).
   *  Usado pra manter modo "campeonato" em rotas globais que recebem o ID
   *  via query param. Retorna `null` se não encontrar. */
  private extrairCampeonatoIdDaQuery(url: string): string | null {
    const idx = url.indexOf('?');
    if (idx < 0) return null;
    try {
      const params = new URLSearchParams(url.slice(idx + 1));
      const id = params.get('campeonatoId');
      return id && id.trim() ? id.trim() : null;
    } catch {
      return null;
    }
  }

  voltarParaLista(): void {
    this.navBack.back('/app/meus-campeonatos');
  }

  voltarParaCampeonato(): void {
    const id = this.campeonatoId();
    this.navBack.back(id ? ['/app/campeonato', id] : '/app/meus-campeonatos');
  }

  /**
   * Abre a página pública do campeonato em nova aba.
   * Usa slug/shortCode/ID — o resolver da rota pública aceita os 3.
   */
  abrirPaginaPublica(): void {
    const id = this.campeonatoId();
    if (!id) return;
    const sub = this.campeonato$.subscribe(camp => {
      const ident = camp?.slug || camp?.shortCode || id;
      const url = `${window.location.origin}/${ident}`;
      window.open(url, '_blank', 'noopener');
      setTimeout(() => sub.unsubscribe(), 0);
    });
  }

  async confirmLogout(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sair da conta?',
      message: 'Você precisará entrar novamente para acessar.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Sair', role: 'destructive', handler: () => this.doLogout() },
      ],
    });
    await alert.present();
  }

  private async doLogout(): Promise<void> {
    // Limpa o flag de "navegando do admin" pra próxima sessão começar limpa
    this.adminNav.encerrar();
    await this.auth.signOut();
    // Volta pra home pública (tela principal). Antes ia direto pra /login,
    // mas o padrão esperado é cair na landing — daí o usuário escolhe se
    // quer logar de novo ou só navegar como visitante.
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }

  initials(user: User | null): string {
    return (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  }
}
