import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { User } from '@angular/fire/auth';
import { AuthService } from '../../auth/auth.service';
import {
  CollectionReference,
  Firestore,
  Timestamp,
  collection,
  collectionData,
  collectionGroup,
  query,
  orderBy,
  limit,
} from '@angular/fire/firestore';
import { Injector, runInInjectionContext } from '@angular/core';
import { Observable, combineLatest, of, BehaviorSubject, firstValueFrom } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { UsersService } from '../../users/users.service';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { UserProfile, TipoConta } from '../../users/models/user-profile.model';
import { Inscricao } from '../../campeonatos/models/inscricao.model';
import { Categoria } from '../../campeonatos/categoria.model';
import { Equipe } from '../../campeonatos/models/equipe.model';
import { Jogador } from '../../campeonatos/models/jogador.model';
import { Jogo } from '../../campeonatos/models/jogo.model';
import { UserDetailModalComponent } from './user-detail-modal/user-detail-modal.component';
import { CampeonatoDetailModalComponent } from './campeonato-detail-modal/campeonato-detail-modal.component';
import { AdminNavigationService } from '../../shared/admin-navigation.service';
import { RefreshService } from '../../shared/refresh.service';
import { PlanosService, PlanoDef, PlanoId, Periodicidade } from '../../users/planos.service';
import { CobrancasService } from '../../users/cobrancas.service';
import { ConfigGlobalService, ConfigGlobal } from '../../users/config-global.service';
import { ConfigComercialService, ConfigComercial } from '../../users/config-comercial.service';
import { LogsService } from '../../users/logs.service';
import { RachaService } from '../../racha/racha.service';
import { RachaPlanosService } from '../../racha/racha-planos.service';
import { PlanoRachaId } from '../../users/models/cobranca.model';
import { Racha } from '../../racha/models/racha.model';
import {
  LogAuditoria,
  LogAcao,
  LOG_ACAO_LABEL,
  LOG_ACAO_COR,
} from '../../users/models/log-auditoria.model';
import {
  Cobranca,
  CobrancaStatus,
  COBRANCA_STATUS_LABEL,
  COBRANCA_STATUS_COR,
  METODO_PAGAMENTO_LABEL,
  MetodoPagamento,
} from '../../users/models/cobranca.model';

type SecaoAdmin =
  | 'dashboard'
  | 'usuarios'
  | 'campeonatos'
  | 'inscricoes'
  | 'organizadores'
  | 'rachas'
  | 'planos'
  | 'valores'
  | 'cobrancas'
  | 'financeiro'
  | 'configuracoes'
  | 'logs';

/** Linha da tabela de rachas no admin — racha enriquecido com o dono. */
export interface RachaLinha {
  racha: Racha;
  donoNome?: string;
  donoEmail?: string;
}

/** Linha da tabela de planos no admin — user enriquecido com a def do plano. */
export interface LinhaPlano {
  usuario: UserProfile;
  planoDef: PlanoDef;
}

/** Linha do agrupamento "Por Organizador" — um organizador + seus campeonatos. */
export interface GrupoOrganizador {
  organizador: UserProfile;
  campeonatos: Campeonato[];
  totalSeguidores: number;
}

interface AdminStats {
  totalUsuarios: number;
  totalOrganizadores: number;
  totalClientes: number;
  totalModeradores: number;
  /** Contas tipo `racha` (organizadores de pelada — pickup soccer). */
  totalRachas: number;
  totalAdmins: number;
  totalCampeonatos: number;
  campeonatosPublicos: number;
  campeonatosPrivados: number;
  totalInscricoes: number;
  totalEquipes: number;
  totalJogadores: number;
  totalJogos: number;
  jogosEmAndamento: number;
  // ===== Rachas (documentos em /rachas) =====
  /** Total de rachas (peladas) cadastrados — docs em /rachas. */
  totalRachasDocs: number;
  /** Rachas com status 'ativo'. */
  rachasAtivos: number;
  /** Rachas públicos. */
  rachasPublicos: number;
  /** Soma de seguidores de todos os rachas. */
  seguidoresRacha: number;
  /** Distribuição de rachas por plano. */
  rachasPorPlano: Record<PlanoRachaId, number>;
}

interface CampeonatoLinha extends Campeonato {
  donoNome?: string;
}

/** Fatia de um gráfico (donut ou barra). */
export interface ChartItem {
  label: string;
  valor: number;
  cor: string;
  /** % do total (0-100). */
  pct: number;
}

/** Dados prontos pra um gráfico donut (gradient + legenda). */
export interface DonutData {
  /** String pronta pra `background: conic-gradient(...)`. */
  gradient: string;
  total: number;
  legenda: ChartItem[];
}

/** Barra de gráfico mensal (12 últimos meses). */
export interface MesGrafico {
  label: string;     // "Jan/26"
  valorCentavos: number;
  altura: number;    // % normalizado (0-100) pra altura da barra
}

/** Top pagante. */
export interface TopPagante {
  usuarioId: string;
  nome: string;
  email?: string;
  totalCentavos: number;
  cobrancasCount: number;
}

/** Resumo financeiro agregado pro dashboard. */
export interface FinanceiroResumo {
  /** Receita recorrente mensal — soma dos planos ativos normalizado por mês. */
  mrr: number;
  /** Receita anual recorrente — MRR × 12. */
  arr: number;
  /** Ticket médio das cobranças pagas. */
  ticketMedio: number;
  /** Quantos usuários têm pelo menos uma cobrança paga. */
  totalPagantes: number;
  /** Receita total já paga (lifetime). */
  receitaTotal: number;
  cobrancasPagas: number;
  cobrancasAguardando: number;
  cobrancasAtrasadas: number;
  /** Últimos 12 meses pra gráfico de barras. */
  mesesGrafico: MesGrafico[];
  /** Top 10 pagantes ordenado por valor total. */
  topPagantes: TopPagante[];
  // ===== Split por origem (campeonato × racha) =====
  /** MRR só de assinaturas de campeonato. */
  mrrCampeonatos: number;
  /** MRR só de assinaturas de racha. */
  mrrRachas: number;
  /** ARR (×12) de campeonatos. */
  arrCampeonatos: number;
  /** ARR (×12) de rachas. */
  arrRachas: number;
  /** Receita total (lifetime) de campeonatos. */
  receitaCampeonatos: number;
  /** Receita total (lifetime) de rachas. */
  receitaRachas: number;
}

interface InscricaoLinha extends Inscricao {
  // o id já existe no modelo
}

/**
 * Painel Admin Master — visão completa do sistema (todos os usuários,
 * todos os campeonatos, todas as inscrições).
 *
 * Acessível apenas pra usuários com `isMaster: true` no perfil.
 * Protegido pelo `adminGuard` na rota `/app/admin`.
 *
 * Layout: cabeçalho com tabs (Dashboard / Usuários / Campeonatos /
 * Inscrições) e área de conteúdo abaixo. Tudo é READ-ONLY por enquanto
 * (apenas listagem e link-out para entrar em cada item).
 */
@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class AdminPage implements OnInit {
  private readonly campsSrv = inject(CampeonatosService);
  private readonly usersSrv = inject(UsersService);
  private readonly router = inject(Router);
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly adminNav = inject(AdminNavigationService);
  private readonly refreshSrv = inject(RefreshService);
  private readonly planosSrv = inject(PlanosService);
  private readonly cobrancasSrv = inject(CobrancasService);
  private readonly configSrv = inject(ConfigGlobalService);
  private readonly configComercialSrv = inject(ConfigComercialService);
  private readonly logsSrv = inject(LogsService);
  private readonly rachaSrv = inject(RachaService);
  private readonly rachaPlanosSrv = inject(RachaPlanosService);
  private readonly auth = inject(AuthService);

  /** Usuário logado — exibido no header do painel (avatar + nome + Sair). */
  readonly user$: Observable<User | null> = this.auth.user$;

  /** Expostos pro template. */
  readonly LOG_ACAO_LABEL = LOG_ACAO_LABEL;
  readonly LOG_ACAO_COR = LOG_ACAO_COR;

  /** Expostos pro template (constantes de labels/cores de cobranças). */
  readonly COBRANCA_STATUS_LABEL = COBRANCA_STATUS_LABEL;
  readonly COBRANCA_STATUS_COR = COBRANCA_STATUS_COR;
  readonly METODO_PAGAMENTO_LABEL = METODO_PAGAMENTO_LABEL;

  /** Catálogo completo de planos (com overrides do admin já aplicados).
   *  Getter pra refletir mudanças após salvar valores em config/comercial. */
  get catalogoPlanos(): ReadonlyArray<PlanoDef> { return this.planosSrv.planos; }

  /** Seção atualmente aberta (5 tabs). */
  secao: SecaoAdmin = 'dashboard';

  // ============ Streams base (alimentam tudo) ============
  usuarios$: Observable<UserProfile[]> = of([]);
  campeonatos$: Observable<Campeonato[]> = of([]);
  /** Inscrições agregadas via collectionGroup — todas as fichas do sistema. */
  inscricoes$: Observable<Inscricao[]> = of([]);
  /** Coleções via collectionGroup pra contagens system-wide. */
  equipes$: Observable<Equipe[]> = of([]);
  jogadores$: Observable<Jogador[]> = of([]);
  jogos$: Observable<Jogo[]> = of([]);

  /** Estatísticas computadas pra Dashboard. */
  stats$: Observable<AdminStats> = of({
    totalUsuarios: 0, totalOrganizadores: 0, totalClientes: 0, totalModeradores: 0,
    totalRachas: 0,
    totalAdmins: 0, totalCampeonatos: 0, campeonatosPublicos: 0, campeonatosPrivados: 0,
    totalInscricoes: 0, totalEquipes: 0, totalJogadores: 0, totalJogos: 0, jogosEmAndamento: 0,
    totalRachasDocs: 0, rachasAtivos: 0, rachasPublicos: 0, seguidoresRacha: 0,
    rachasPorPlano: { gratis: 0, premium: 0, pro: 0 },
  });

  /** Grupos por organizador — agrupa campeonatos por ownerId. */
  organizadores$: Observable<GrupoOrganizador[]> = of([]);
  /** Estado de expansão dos cards de organizador (por uid). */
  expandidos = new Set<string>();

  /** Contagem de usuários por plano (pros cards do header da aba Planos). */
  contagemPlanos$: Observable<Record<PlanoId, number>> = of({
    gratis: 0, pequeno: 0, medio: 0, grande: 0, profissional: 0,
  });
  /** Linhas da tabela de planos (enriquece cada user com sua def de plano). */
  linhasPlanos$: Observable<LinhaPlano[]> = of([]);
  /** Filtro de busca da aba Planos. */
  private readonly buscaPlanos$ = new BehaviorSubject<string>('');
  linhasPlanosFiltradas$: Observable<LinhaPlano[]> = of([]);

  /** Listas filtradas (reagem ao input de busca). */
  usuariosFiltrados$: Observable<UserProfile[]> = of([]);
  campeonatosFiltrados$: Observable<CampeonatoLinha[]> = of([]);
  inscricoesFiltradas$: Observable<InscricaoLinha[]> = of([]);

  // ============ Cobranças ============
  cobrancas$: Observable<Cobranca[]> = of([]);
  cobrancasFiltradas$: Observable<Cobranca[]> = of([]);
  /** Filtro de status atual (null = todos). */
  filtroStatusCobranca: CobrancaStatus | null = null;
  /** Filtro de ORIGEM da cobrança (separa campeonato × racha). */
  filtroOrigemCobranca: 'todas' | 'campeonato' | 'racha' = 'todas';
  private readonly buscaCobrancas$ = new BehaviorSubject<string>('');
  private readonly filtroStatusCobranca$ = new BehaviorSubject<CobrancaStatus | null>(null);
  private readonly filtroOrigemCobranca$ = new BehaviorSubject<'todas' | 'campeonato' | 'racha'>('todas');

  /** Form inline "Nova Cobrança" (admin pode criar manualmente). */
  novaCobAberta = false;
  salvandoNovaCob = false;
  novaCob = {
    usuarioId: '',
    planoId: 'pequeno' as PlanoId,
    periodicidade: 'mensal' as Periodicidade,
    vencimento: '',
    metodoPagamento: 'pix' as MetodoPagamento,
    observacao: '',
  };

  // ============ Financeiro ============
  financeiro$: Observable<FinanceiroResumo> = of({
    mrr: 0, arr: 0, ticketMedio: 0, totalPagantes: 0,
    receitaTotal: 0, cobrancasPagas: 0, cobrancasAguardando: 0,
    cobrancasAtrasadas: 0, mesesGrafico: [],
    topPagantes: [],
    mrrCampeonatos: 0, mrrRachas: 0, arrCampeonatos: 0, arrRachas: 0,
    receitaCampeonatos: 0, receitaRachas: 0,
  });

  // ============ Rachas (admin) ============
  rachas$: Observable<Racha[]> = of([]);
  rachasFiltrados$: Observable<RachaLinha[]> = of([]);
  contagemRachaPlanos$: Observable<Record<PlanoRachaId, number>> = of({ gratis: 0, premium: 0, pro: 0 });
  private readonly buscaRachas$ = new BehaviorSubject<string>('');
  filtroStatusRacha: 'todos' | 'rascunho' | 'ativo' | 'pausado' | 'encerrado' = 'todos';
  filtroPlanoRacha: 'todos' | PlanoRachaId = 'todos';
  filtroVisibilidadeRacha: 'todos' | 'publico' | 'privado' = 'todos';
  private readonly filtroStatusRacha$ = new BehaviorSubject<typeof this.filtroStatusRacha>('todos');
  private readonly filtroPlanoRacha$ = new BehaviorSubject<typeof this.filtroPlanoRacha>('todos');
  private readonly filtroVisibilidadeRacha$ = new BehaviorSubject<typeof this.filtroVisibilidadeRacha>('todos');
  /** Sub-aba da seção Planos: campeonatos × racha. */
  abaPlanos: 'campeonatos' | 'racha' = 'campeonatos';

  // ============ Gráficos do Dashboard ============
  /** Donut de usuários por tipo. */
  usuariosChart$: Observable<DonutData> = of({ gradient: '', total: 0, legenda: [] });
  /** Donut de campeonatos público × privado. */
  campChart$: Observable<DonutData> = of({ gradient: '', total: 0, legenda: [] });
  /** Donut de rachas por plano. */
  rachaPlanoChart$: Observable<DonutData> = of({ gradient: '', total: 0, legenda: [] });
  /** Barras de distribuição dos planos de campeonato (por usuários). */
  planosCampBars$: Observable<ChartItem[]> = of([]);
  /** Planos de racha pra dropdown (id + label). */
  readonly opcoesPlanoRacha: { id: PlanoRachaId; label: string }[] = [
    { id: 'gratis', label: 'Gratuito' },
    { id: 'premium', label: 'Premium' },
    { id: 'pro', label: 'Premium PRO' },
  ];
  /** Status de racha pra dropdown. */
  readonly opcoesStatusRacha: { id: NonNullable<Racha['status']>; label: string }[] = [
    { id: 'rascunho', label: 'Rascunho' },
    { id: 'ativo', label: 'Ativo' },
    { id: 'pausado', label: 'Pausado' },
    { id: 'encerrado', label: 'Encerrado' },
  ];

  // ============ Configurações globais (form local) ============
  config$: Observable<ConfigGlobal> = of({});
  /** Form local — populado pelo stream e enviado no submit. */
  configForm: ConfigGlobal = {
    organizadorInviteCodes: [],
    moderadorInviteCodes: [],
    modoManutencao: false,
    mensagemManutencao: '',
    asaasUrl: '',
    transmissoesHabilitadas: true,
  };
  /** Campo temporário pra adicionar novo código. */
  novoCodigoOrg = '';
  novoCodigoMod = '';
  /** Estado de "salvando" pra desabilitar botão. */
  salvandoConfig = false;

  // ============ Logs ============
  logs$: Observable<LogAuditoria[]> = of([]);
  logsFiltrados$: Observable<LogAuditoria[]> = of([]);
  private readonly buscaLogs$ = new BehaviorSubject<string>('');
  private readonly filtroAcaoLog$ = new BehaviorSubject<LogAcao | null>(null);
  filtroAcaoLog: LogAcao | null = null;

  /** Busca por seção (uma BehaviorSubject por seção pra independência). */
  private readonly buscaUsuarios$ = new BehaviorSubject<string>('');
  private readonly buscaCampeonatos$ = new BehaviorSubject<string>('');
  private readonly buscaInscricoes$ = new BehaviorSubject<string>('');
  private readonly buscaOrganizadores$ = new BehaviorSubject<string>('');

  /**
   * Filtros adicionais da aba Usuários — chips de filtro rápido.
   * - status: 'todos' | 'ativos' | 'pendentes' (moderadores não validados)
   *          | 'bloqueados' | 'banidos' | 'admins'
   * - tipo: 'todos' | TipoConta
   */
  filtroStatusUsuario: 'todos' | 'ativos' | 'pendentes' | 'bloqueados' | 'banidos' | 'admins' = 'todos';
  filtroTipoUsuario: 'todos' | 'organizador' | 'cliente' | 'moderador' | 'racha' = 'todos';
  private readonly filtroStatusUsuario$ = new BehaviorSubject<typeof this.filtroStatusUsuario>('todos');
  private readonly filtroTipoUsuario$ = new BehaviorSubject<typeof this.filtroTipoUsuario>('todos');

  /**
   * Filtros da aba Campeonatos — visibilidade (público/privado) e
   * presença de capa (pra catar campeonatos "incompletos" sem branding).
   */
  filtroVisibilidadeCampeonato: 'todos' | 'publico' | 'privado' = 'todos';
  filtroCapaCampeonato: 'todos' | 'com-capa' | 'sem-capa' = 'todos';
  private readonly filtroVisibilidadeCampeonato$ = new BehaviorSubject<typeof this.filtroVisibilidadeCampeonato>('todos');
  private readonly filtroCapaCampeonato$ = new BehaviorSubject<typeof this.filtroCapaCampeonato>('todos');

  /**
   * Top 5 organizadores por número de campeonatos — exibido no
   * dashboard pra dar visibilidade rápida dos heavy users.
   */
  topOrganizadores$: Observable<Array<{ uid: string; nome: string; total: number; fotoUrl?: string }>> = of([]);

  /**
   * Top 5 campeonatos por número de equipes — exibido no dashboard
   * pra dar visibilidade dos torneios mais ativos.
   */
  topCampeonatos$: Observable<Array<{ id: string; titulo: string; totalEquipes: number; logoUrl?: string }>> = of([]);

  organizadoresFiltrados$: Observable<GrupoOrganizador[]> = of([]);

  ngOnInit(): void {
    // ============ Streams de dados brutos ============
    this.usuarios$ = this.usersSrv.listAllUsers$().pipe(
      catchError(err => {
        console.error('[Admin] listAllUsers falhou', err);
        return of([] as UserProfile[]);
      }),
      startWith([] as UserProfile[]),
    );

    this.campeonatos$ = this.campsSrv.listAllSystem$().pipe(
      catchError(err => {
        console.error('[Admin] listAllSystem campeonatos falhou', err);
        return of([] as Campeonato[]);
      }),
      startWith([] as Campeonato[]),
    );

    // Inscrições via collectionGroup (todas as subcoleções `inscricoes`)
    this.inscricoes$ = this.listAllInscricoes$();

    // Coleções system-wide via collectionGroup (alimentam stats + detalhes)
    this.equipes$ = this.listAllCG$<Equipe>('equipes');
    this.jogadores$ = this.listAllCG$<Jogador>('jogadores');
    this.jogos$ = this.listAllCG$<Jogo>('jogos');

    // Todos os rachas do sistema (admin-wide)
    this.rachas$ = this.rachaSrv.listAllSystem$().pipe(
      catchError(err => {
        console.error('[Admin] listAllSystem rachas falhou', err);
        return of([] as Racha[]);
      }),
      startWith([] as Racha[]),
    );

    // ============ Stats (inclui equipes/jogadores/jogos + rachas) ============
    this.stats$ = combineLatest([
      this.usuarios$, this.campeonatos$, this.inscricoes$,
      this.equipes$, this.jogadores$, this.jogos$, this.rachas$,
    ]).pipe(
      map(([users, camps, inscs, eqs, jgds, jgs, rachas]) =>
        this.calcularStats(users, camps, inscs, eqs, jgds, jgs, rachas)),
    );

    // ============ Organizadores agrupados ============
    this.organizadores$ = combineLatest([this.usuarios$, this.campeonatos$]).pipe(
      map(([users, camps]) => this.agruparPorOrganizador(users, camps)),
    );

    // ============ Ações pendentes (Dashboard — card de alertas) ============
    // Agrega contagens de itens que precisam de atenção do admin master:
    // moderadores aguardando validação, cobranças atrasadas, jogos ao vivo
    // (broadcast ativo) e contas banidas/bloqueadas. Combinado via combineLatest.
    this.acoesPendentes$ = combineLatest([
      this.usuarios$,
      this.jogos$,
      this.cobrancas$.pipe(startWith([] as Cobranca[])),
    ]).pipe(
      map(([users, jogos, cobrancas]) => {
        const moderadoresPendentes = users.filter(u =>
          u.tipo === 'moderador' && !u.moderadorValidado && !u.banido && !u.bloqueado,
        ).length;
        const contasBloqueadas = users.filter(u => u.bloqueado && !u.banido).length;
        const contasBanidas = users.filter(u => u.banido).length;
        const cobrancasAtrasadas = cobrancas.filter(c => c.status === 'atrasado').length;
        const jogosAoVivo = jogos.filter(j => j.status === 'em-andamento').length;
        const total = moderadoresPendentes + contasBloqueadas + cobrancasAtrasadas;
        return {
          moderadoresPendentes,
          contasBloqueadas,
          contasBanidas,
          cobrancasAtrasadas,
          jogosAoVivo,
          total,
        };
      }),
    );

    // ============ Listas filtradas (busca + status + tipo) ============
    this.usuariosFiltrados$ = combineLatest([
      this.usuarios$,
      this.buscaUsuarios$,
      this.filtroStatusUsuario$,
      this.filtroTipoUsuario$,
    ]).pipe(
      map(([list, t, status, tipo]) => this.filtrarUsuarios(list, t, status, tipo)),
    );

    this.campeonatosFiltrados$ = combineLatest([
      this.campeonatos$,
      this.usuarios$,
      this.buscaCampeonatos$,
      this.filtroVisibilidadeCampeonato$,
      this.filtroCapaCampeonato$,
    ]).pipe(
      map(([camps, users, t, vis, capa]) => this.filtrarCampeonatos(camps, users, t, vis, capa)),
    );

    // ============ Top 5 organizadores por # de campeonatos ============
    this.topOrganizadores$ = combineLatest([this.usuarios$, this.campeonatos$]).pipe(
      map(([users, camps]) => {
        const uMap = new Map(users.map(u => [u.uid, u]));
        const contagem = new Map<string, number>();
        for (const c of camps) {
          if (!c.ownerId) continue;
          contagem.set(c.ownerId, (contagem.get(c.ownerId) ?? 0) + 1);
        }
        return Array.from(contagem.entries())
          .map(([uid, total]) => ({
            uid,
            nome: uMap.get(uid)?.nome ?? uid,
            fotoUrl: uMap.get(uid)?.logoUrl ?? uMap.get(uid)?.fotoUrl,
            total,
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);
      }),
    );

    // ============ Top 5 campeonatos por # de equipes ============
    this.topCampeonatos$ = combineLatest([this.campeonatos$, this.equipes$]).pipe(
      map(([camps, equipes]) => {
        const contagem = new Map<string, number>();
        for (const e of equipes) {
          if (!e.campeonatoId) continue;
          contagem.set(e.campeonatoId, (contagem.get(e.campeonatoId) ?? 0) + 1);
        }
        return camps
          .map(c => ({
            id: c.id ?? '',
            titulo: c.titulo,
            logoUrl: c.logoUrl,
            totalEquipes: contagem.get(c.id ?? '') ?? 0,
          }))
          .filter(c => c.totalEquipes > 0)
          .sort((a, b) => b.totalEquipes - a.totalEquipes)
          .slice(0, 5);
      }),
    );

    this.inscricoesFiltradas$ = combineLatest([this.inscricoes$, this.buscaInscricoes$]).pipe(
      map(([list, t]) => this.filtrarInscricoes(list, t)),
    );

    this.organizadoresFiltrados$ = combineLatest([this.organizadores$, this.buscaOrganizadores$]).pipe(
      map(([list, t]) => this.filtrarOrganizadores(list, t)),
    );

    // ============ Cobranças ============
    this.cobrancas$ = this.cobrancasSrv.listAll$().pipe(
      catchError(err => {
        console.error('[Admin] listAll cobrancas falhou', err);
        return of([] as Cobranca[]);
      }),
      startWith([] as Cobranca[]),
    );

    this.cobrancasFiltradas$ = combineLatest([
      this.cobrancas$, this.buscaCobrancas$, this.filtroStatusCobranca$, this.filtroOrigemCobranca$,
    ]).pipe(
      map(([list, t, status, origem]) => this.filtrarCobrancas(list, t, status, origem)),
    );

    // Resumo financeiro derivado das cobranças + usuários
    this.financeiro$ = combineLatest([this.cobrancas$, this.usuarios$]).pipe(
      map(([cobrs, users]) => this.calcularFinanceiro(cobrs, users)),
    );

    // Configurações globais — popula o form local na primeira carga
    this.config$ = this.configSrv.config$();
    this.config$.subscribe(c => {
      this.configForm = {
        organizadorInviteCodes: [...(c.organizadorInviteCodes ?? [])],
        moderadorInviteCodes: [...(c.moderadorInviteCodes ?? [])],
        modoManutencao: c.modoManutencao ?? false,
        mensagemManutencao: c.mensagemManutencao ?? '',
        asaasUrl: c.asaasUrl ?? '',
        transmissoesHabilitadas: c.transmissoesHabilitadas ?? true,
      };
    });

    // Logs — últimos 200 + filtro
    this.logs$ = this.logsSrv.listRecentes$(200).pipe(
      catchError(err => {
        console.error('[Admin] listRecentes logs falhou', err);
        return of([] as LogAuditoria[]);
      }),
      startWith([] as LogAuditoria[]),
    );
    this.logsFiltrados$ = combineLatest([
      this.logs$, this.buscaLogs$, this.filtroAcaoLog$,
    ]).pipe(
      map(([list, t, acao]) => this.filtrarLogs(list, t, acao)),
    );

    // ============ Planos ============
    this.contagemPlanos$ = this.usuarios$.pipe(
      map(users => this.planosSrv.contarPorPlano(users)),
    );
    this.linhasPlanos$ = this.usuarios$.pipe(
      map(users => users.map(u => ({
        usuario: u,
        planoDef: this.planosSrv.getPlanoDef(u.plano),
      }))),
    );
    this.linhasPlanosFiltradas$ = combineLatest([this.linhasPlanos$, this.buscaPlanos$]).pipe(
      map(([list, t]) => this.filtrarLinhasPlanos(list, t)),
    );

    // ============ Rachas (lista + contagem por plano) ============
    this.contagemRachaPlanos$ = this.rachas$.pipe(
      map(rs => this.contarRachasPorPlano(rs)),
    );
    this.rachasFiltrados$ = combineLatest([
      this.rachas$, this.usuarios$, this.buscaRachas$,
      this.filtroStatusRacha$, this.filtroPlanoRacha$, this.filtroVisibilidadeRacha$,
    ]).pipe(
      map(([rs, users, t, st, pl, vis]) => this.filtrarRachas(rs, users, t, st, pl, vis)),
    );

    // ============ Gráficos do Dashboard (derivados das stats) ============
    this.usuariosChart$ = this.stats$.pipe(map(s => this.buildDonut([
      { label: 'Organizadores', valor: s.totalOrganizadores, cor: '#f59e0b' },
      { label: 'Espectadores',  valor: s.totalClientes,      cor: '#4dabf7' },
      { label: 'Moderadores',   valor: s.totalModeradores,   cor: '#7c3aed' },
      { label: 'Admins',        valor: s.totalAdmins,        cor: '#16a34a' },
    ])));
    this.campChart$ = this.stats$.pipe(map(s => this.buildDonut([
      { label: 'Públicos', valor: s.campeonatosPublicos, cor: '#16a34a' },
      { label: 'Privados', valor: s.campeonatosPrivados, cor: '#94a3b8' },
    ])));
    this.rachaPlanoChart$ = this.contagemRachaPlanos$.pipe(map(c => this.buildDonut([
      { label: 'Gratuito', valor: c.gratis,  cor: '#94a3b8' },
      { label: 'Premium',  valor: c.premium, cor: '#14b8a6' },
      { label: 'PRO',      valor: c.pro,     cor: '#16a34a' },
    ])));
    this.planosCampBars$ = this.contagemPlanos$.pipe(map(ct => {
      const itens = this.catalogoPlanos.map(p => ({ label: p.label, valor: ct[p.id] || 0, cor: p.cor, pct: 0 }));
      const max = Math.max(1, ...itens.map(i => i.valor));
      return itens.map(i => ({ ...i, pct: Math.round((i.valor / max) * 100) }));
    }));
  }

  /**
   * Monta os dados de um gráfico DONUT a partir de fatias {label,valor,cor}.
   * Calcula percentuais e a string `conic-gradient(...)`. Sem dados → anel cinza.
   */
  private buildDonut(segs: { label: string; valor: number; cor: string }[]): DonutData {
    const total = segs.reduce((s, x) => s + (x.valor || 0), 0);
    const legenda: ChartItem[] = segs.map(x => ({
      label: x.label,
      valor: x.valor || 0,
      cor: x.cor,
      pct: total > 0 ? Math.round((x.valor / total) * 100) : 0,
    }));
    if (total <= 0) {
      return { gradient: 'conic-gradient(#e5e7eb 0% 100%)', total: 0, legenda };
    }
    let acc = 0;
    const stops: string[] = [];
    for (const x of segs) {
      if (!x.valor) continue;
      const start = (acc / total) * 100;
      acc += x.valor;
      const end = (acc / total) * 100;
      stops.push(`${x.cor} ${start}% ${end}%`);
    }
    return { gradient: `conic-gradient(${stops.join(', ')})`, total, legenda };
  }

  // ============ Helpers de stream ============

  private listAllInscricoes$(): Observable<Inscricao[]> {
    return runInInjectionContext(this.injector, () => {
      try {
        const q = query(
          collectionGroup(this.fs, 'inscricoes') as CollectionReference<Inscricao>,
          orderBy('criadoEm', 'desc'),
          limit(500),
        );
        return (collectionData(q, { idField: 'id' }) as Observable<Inscricao[]>).pipe(
          catchError(err => {
            console.warn('[Admin] collectionGroup inscricoes falhou', err);
            return of([] as Inscricao[]);
          }),
          startWith([] as Inscricao[]),
        );
      } catch (err) {
        console.error('[Admin] erro montando query inscricoes', err);
        return of([] as Inscricao[]);
      }
    });
  }

  /** Helper genérico: lista TODAS as subcoleções com o `name` informado
   *  via `collectionGroup`. Usado pra equipes/jogadores/jogos system-wide. */
  private listAllCG$<T>(name: string): Observable<T[]> {
    return runInInjectionContext(this.injector, () => {
      try {
        const q = query(collectionGroup(this.fs, name), limit(2000));
        return (collectionData(q, { idField: 'id' }) as Observable<T[]>).pipe(
          catchError(err => {
            console.warn(`[Admin] collectionGroup ${name} falhou`, err);
            return of([] as T[]);
          }),
          startWith([] as T[]),
        );
      } catch (err) {
        console.error(`[Admin] erro montando query ${name}`, err);
        return of([] as T[]);
      }
    });
  }

  private calcularStats(
    users: UserProfile[],
    camps: Campeonato[],
    inscs: Inscricao[],
    eqs: Equipe[],
    jgds: Jogador[],
    jgs: Jogo[],
    rachas: Racha[] = [],
  ): AdminStats {
    const byTipo = (t: TipoConta) => users.filter(u => u.tipo === t).length;
    return {
      totalUsuarios: users.length,
      totalOrganizadores: byTipo('organizador'),
      totalClientes: byTipo('cliente'),
      totalModeradores: byTipo('moderador'),
      totalRachas: byTipo('racha'),
      totalAdmins: users.filter(u => u.isMaster).length,
      totalCampeonatos: camps.length,
      campeonatosPublicos: camps.filter(c => c.publico !== false).length,
      campeonatosPrivados: camps.filter(c => c.publico === false).length,
      totalInscricoes: inscs.length,
      totalEquipes: eqs.length,
      totalJogadores: jgds.length,
      totalJogos: jgs.length,
      jogosEmAndamento: jgs.filter(j => j.status === 'em-andamento').length,
      // ===== Rachas =====
      totalRachasDocs: rachas.length,
      rachasAtivos: rachas.filter(r => r.status === 'ativo').length,
      rachasPublicos: rachas.filter(r => r.visibilidade === 'publico').length,
      seguidoresRacha: rachas.reduce((s, r) => s + (r.seguidores ?? 0), 0),
      rachasPorPlano: this.contarRachasPorPlano(rachas),
    };
  }

  /** Conta rachas por plano ('gratis' default quando ausente). */
  private contarRachasPorPlano(rachas: Racha[]): Record<PlanoRachaId, number> {
    const acc: Record<PlanoRachaId, number> = { gratis: 0, premium: 0, pro: 0 };
    for (const r of rachas) {
      const p = (r.plano ?? 'gratis') as PlanoRachaId;
      acc[p] = (acc[p] ?? 0) + 1;
    }
    return acc;
  }

  /** Filtra/enriquece rachas pra tabela do admin (busca + status + plano + visibilidade). */
  private filtrarRachas(
    rachas: Racha[],
    users: UserProfile[],
    termo: string,
    status: typeof this.filtroStatusRacha,
    plano: typeof this.filtroPlanoRacha,
    visibilidade: typeof this.filtroVisibilidadeRacha,
  ): RachaLinha[] {
    const uMap = new Map(users.map(u => [u.uid, u]));
    let out = rachas;
    if (status !== 'todos') out = out.filter(r => (r.status ?? 'rascunho') === status);
    if (plano !== 'todos') out = out.filter(r => (r.plano ?? 'gratis') === plano);
    if (visibilidade !== 'todos') out = out.filter(r => (r.visibilidade ?? 'privado') === visibilidade);
    const t = (termo ?? '').trim().toLowerCase();
    if (t) {
      out = out.filter(r => {
        const dono = r.ownerId ? uMap.get(r.ownerId) : undefined;
        return (r.nome ?? '').toLowerCase().includes(t)
          || (r.local ?? '').toLowerCase().includes(t)
          || (r.municipio ?? '').toLowerCase().includes(t)
          || (dono?.nome ?? '').toLowerCase().includes(t)
          || (dono?.email ?? '').toLowerCase().includes(t);
      });
    }
    return out.map(r => {
      const dono = r.ownerId ? uMap.get(r.ownerId) : undefined;
      return { racha: r, donoNome: dono?.nome, donoEmail: dono?.email };
    });
  }

  /** Agrupa campeonatos por ownerId, enriquecendo com o perfil do dono. */
  private agruparPorOrganizador(
    users: UserProfile[],
    camps: Campeonato[],
  ): GrupoOrganizador[] {
    const uMap = new Map(users.map(u => [u.uid, u]));
    const grupos = new Map<string, GrupoOrganizador>();

    for (const c of camps) {
      const owner = c.ownerId ?? '_orphans_';
      if (!grupos.has(owner)) {
        const profile = uMap.get(owner) ?? {
          uid: owner,
          nome: owner === '_orphans_' ? 'Sem dono' : (owner.slice(0, 8) + '...'),
        } as UserProfile;
        grupos.set(owner, {
          organizador: profile,
          campeonatos: [],
          totalSeguidores: 0,
        });
      }
      const g = grupos.get(owner)!;
      g.campeonatos.push(c);
      g.totalSeguidores += c.seguidores ?? 0;
    }

    return Array.from(grupos.values())
      .sort((a, b) => b.campeonatos.length - a.campeonatos.length);
  }

  private filtrarOrganizadores(list: GrupoOrganizador[], termo: string): GrupoOrganizador[] {
    const t = (termo ?? '').trim().toLowerCase();
    if (!t) return list;
    return list.filter(g =>
      (g.organizador.nome ?? '').toLowerCase().includes(t) ||
      (g.organizador.email ?? '').toLowerCase().includes(t) ||
      g.campeonatos.some(c => (c.titulo ?? '').toLowerCase().includes(t)),
    );
  }

  private filtrarCobrancas(
    list: Cobranca[],
    termo: string,
    status: CobrancaStatus | null,
    origem: 'todas' | 'campeonato' | 'racha' = 'todas',
  ): Cobranca[] {
    let out = list;
    if (origem === 'racha') {
      out = out.filter(c => c.tipo === 'racha-assinatura');
    } else if (origem === 'campeonato') {
      out = out.filter(c => c.tipo !== 'racha-assinatura');
    }
    if (status) out = out.filter(c => c.status === status);
    const t = (termo ?? '').trim().toLowerCase();
    if (t) {
      out = out.filter(c =>
        (c.usuarioNome ?? '').toLowerCase().includes(t) ||
        (c.usuarioEmail ?? '').toLowerCase().includes(t) ||
        (c.planoId ?? '').toLowerCase().includes(t) ||
        (c.planoRacha ?? '').toLowerCase().includes(t) ||
        (c.rachaNome ?? '').toLowerCase().includes(t) ||
        (c.id ?? '').toLowerCase().includes(t),
      );
    }
    return out;
  }

  /** Seleciona o filtro de origem das cobranças (campeonato × racha). */
  selecionarFiltroOrigemCobranca(origem: 'todas' | 'campeonato' | 'racha'): void {
    this.filtroOrigemCobranca = origem;
    this.filtroOrigemCobranca$.next(origem);
  }

  /** Label do plano de uma cobrança (racha ou campeonato) pra exibição. */
  nomePlanoCobranca(c: Cobranca): string {
    if (c.tipo === 'racha-assinatura') {
      const labels: Record<string, string> = {
        gratis: 'Gratuito', premium: 'Premium', pro: 'Premium PRO',
      };
      return labels[c.planoRacha ?? ''] ?? 'Premium';
    }
    const id = c.planoId ?? '';
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : '—';
  }

  // ====================== Handlers de Cobranças ======================

  onBuscaCobrancas(ev: { target?: { value?: string } }): void {
    this.buscaCobrancas$.next(ev.target?.value ?? '');
  }

  selecionarFiltroStatusCobranca(status: CobrancaStatus | null): void {
    this.filtroStatusCobranca = status;
    this.filtroStatusCobranca$.next(status);
  }

  /**
   * Marca cobrança como paga E atualiza o plano do usuário automaticamente.
   * Esse é o ponto de "confirmação" que faltava — o usuário não muda de plano
   * sozinho; precisa do admin master rodar este botão depois de confirmar o
   * pagamento (via Asaas, transferência, dinheiro, etc).
   */
  async marcarCobrancaPaga(c: Cobranca): Promise<void> {
    if (!c.id) return;
    try {
      // 1) Atualiza status da cobrança
      await this.cobrancasSrv.atualizarStatus(c.id, 'pago');

      // 2) Ativa o plano referenciado.
      if (c.tipo === 'racha-assinatura') {
        // Cobrança de RACHA → promove o racha (rachas/{id}.plano).
        if (c.rachaId && c.planoRacha) {
          await this.rachaSrv.atualizar(c.rachaId, { plano: c.planoRacha });
          void this.logsSrv.registrar(
            'cobranca_paga',
            `Cobrança ${c.id} (racha) marcada como paga — racha ${c.rachaNome ?? c.rachaId} promovido ao plano ${c.planoRacha}`,
            { cobrancaId: c.id, rachaId: c.rachaId, planoRacha: c.planoRacha },
          );
        }
      } else if (c.usuarioId && c.planoId) {
        // Cobrança de CAMPEONATO → promove o usuário (users/{uid}.plano).
        await this.planosSrv.alterarPlanoDoUsuario(c.usuarioId, c.planoId);
        void this.logsSrv.registrar(
          'cobranca_paga',
          `Cobrança ${c.id} marcada como paga — usuário ${c.usuarioNome ?? c.usuarioId} promovido ao plano ${c.planoId}`,
          { cobrancaId: c.id, usuarioId: c.usuarioId, planoId: c.planoId },
        );
      }
    } catch (err) {
      console.error('[Admin] marcarCobrancaPaga falhou', err);
      alert('Falha ao confirmar pagamento. Verifique o console.');
    }
  }

  /** Cancela cobrança (mantém histórico). */
  async cancelarCobranca(c: Cobranca): Promise<void> {
    if (!c.id) return;
    if (!confirm(`Cancelar cobrança de ${c.usuarioNome ?? c.usuarioId}?`)) return;
    try {
      await this.cobrancasSrv.atualizarStatus(c.id, 'cancelado');
      void this.logsSrv.registrar(
        'cobranca_criada', // reusa enum pra simplicidade (cobranca_cancelada não existe ainda)
        `Cobrança ${c.id} cancelada (${c.usuarioNome ?? c.usuarioId})`,
        { cobrancaId: c.id, novoStatus: 'cancelado' },
      );
    } catch (err) {
      console.error('[Admin] cancelarCobranca falhou', err);
    }
  }

  // ============ Nova Cobrança (inline form) ============

  /** Toggle do form inline "Nova Cobrança". Quando abre, pré-preenche
   *  o vencimento pra 7 dias no futuro. */
  toggleNovaCobranca(): void {
    this.novaCobAberta = !this.novaCobAberta;
    if (this.novaCobAberta && !this.novaCob.vencimento) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      this.novaCob.vencimento = d.toISOString().split('T')[0];
    }
  }

  /** Calcula automaticamente o valor em centavos a partir do plano + periodicidade. */
  get valorCalculadoCentavos(): number {
    const def = this.planosSrv.getPlanoDef(this.novaCob.planoId);
    if (def.preco <= 0) return 0;
    const meses = this.planosSrv.mesesDePeriodo(this.novaCob.periodicidade);
    return Math.round(def.preco * 100 * meses);
  }

  /** Cria a cobrança no Firestore via service. */
  async criarCobranca(): Promise<void> {
    if (this.salvandoNovaCob) return;
    const { usuarioId, planoId, periodicidade, vencimento, metodoPagamento, observacao } = this.novaCob;
    if (!usuarioId || !planoId || !vencimento) {
      alert('Preencha Usuário, Plano e Vencimento.');
      return;
    }
    const valorCentavos = this.valorCalculadoCentavos;
    if (valorCentavos <= 0) {
      alert('Não é possível cobrar 0 — selecione um plano pago.');
      return;
    }
    this.salvandoNovaCob = true;
    try {
      // Pega snapshot do usuário pra denormalizar nome/email na cobrança
      const users = await new Promise<UserProfile[]>(resolve => {
        const sub = this.usuarios$.subscribe(list => {
          resolve(list);
          setTimeout(() => sub.unsubscribe(), 0);
        });
      });
      const u = users.find(x => x.uid === usuarioId);

      const cobrancaId = await this.cobrancasSrv.criar({
        usuarioId,
        usuarioEmail: u?.email,
        usuarioNome: u?.nome,
        planoId,
        periodicidade,
        vencimento,
        valorCentavos,
        status: 'aguardando',
        metodoPagamento,
        observacao: observacao?.trim() || undefined,
      });
      void this.logsSrv.registrar(
        'cobranca_criada',
        `Cobrança criada para ${u?.nome ?? usuarioId} — ${this.formatarValorCobranca(valorCentavos)} (${planoId} / ${periodicidade})`,
        { cobrancaId, usuarioId, planoId, valorCentavos },
      );
      // Reset + fecha form
      this.novaCob = {
        usuarioId: '',
        planoId: 'pequeno',
        periodicidade: 'mensal',
        vencimento: '',
        metodoPagamento: 'pix',
        observacao: '',
      };
      this.novaCobAberta = false;
    } catch (err) {
      console.error('[Admin] criarCobranca falhou', err);
      alert('Falha ao criar cobrança. Verifique o console.');
    } finally {
      this.salvandoNovaCob = false;
    }
  }

  /** Helper pro template — formata valorCentavos como string R$. */
  formatarValorCobranca(centavos: number): string {
    return this.cobrancasSrv.formatarValor(centavos);
  }

  /** Calcula valor total + status de uma cobrança (atrasada se aguardando + venceu). */
  statusEfetivoCobranca(c: Cobranca): CobrancaStatus {
    return this.cobrancasSrv.isAtrasada(c) ? 'atrasado' : c.status;
  }

  /** Periodicidade legível. */
  labelPeriodicidade(p: Periodicidade): string {
    switch (p) {
      case 'mensal':     return 'Mensal';
      case 'trimestral': return 'Trimestral';
      case 'semestral':  return 'Semestral';
      case 'anual':      return 'Anual';
      default:           return p;
    }
  }

  trackByCobranca(_i: number, c: Cobranca): string {
    return c.id ?? '';
  }

  // ====================== Financeiro ======================

  /**
   * Agrega cobranças e usuários para calcular KPIs financeiros.
   * - MRR: soma dos planos ativos normalizada por mês
   * - ARR: MRR × 12
   * - Ticket médio: receitaTotal / cobrancasPagas
   * - Top pagantes: agrupado por usuario
   * - Meses gráfico: receita por mês nos últimos 12 meses
   */
  private calcularFinanceiro(cobrs: Cobranca[], users: UserProfile[]): FinanceiroResumo {
    const cobrancasPagas = cobrs.filter(c => c.status === 'pago');
    const cobrancasAguardando = cobrs.filter(c => c.status === 'aguardando' && !this.cobrancasSrv.isAtrasada(c));
    const cobrancasAtrasadas = cobrs.filter(c => this.cobrancasSrv.isAtrasada(c));

    // Receita total (em centavos)
    const receitaTotalCentavos = cobrancasPagas.reduce((s, c) => s + (c.valorCentavos || 0), 0);
    const ticketMedioCentavos = cobrancasPagas.length > 0
      ? receitaTotalCentavos / cobrancasPagas.length : 0;

    // MRR: soma dos planos ativos (último pagamento por usuário) normalizado por mês
    const pagoPorUsuario = new Map<string, Cobranca>();
    for (const c of cobrancasPagas) {
      const atual = pagoPorUsuario.get(c.usuarioId);
      // Mantém o mais recente — comparação por criadoEm (ms)
      const atualTs = (atual?.criadoEm as unknown as { seconds?: number })?.seconds ?? 0;
      const cTs = (c.criadoEm as unknown as { seconds?: number })?.seconds ?? 0;
      if (!atual || cTs > atualTs) {
        pagoPorUsuario.set(c.usuarioId, c);
      }
    }
    let mrrCentavos = 0;
    for (const c of pagoPorUsuario.values()) {
      const meses = this.planosSrv.mesesDePeriodo(c.periodicidade);
      mrrCentavos += (c.valorCentavos || 0) / meses;
    }

    const totalPagantes = pagoPorUsuario.size;

    // ===== Split campeonato × racha =====
    const ehRacha = (c: Cobranca) => c.tipo === 'racha-assinatura';
    // Receita lifetime por origem
    const receitaRachasCentavos = cobrancasPagas
      .filter(ehRacha).reduce((s, c) => s + (c.valorCentavos || 0), 0);
    const receitaCampeonatosCentavos = receitaTotalCentavos - receitaRachasCentavos;
    // MRR por origem: campeonato = última paga por usuário; racha = última por racha.
    const ultPorRacha = new Map<string, Cobranca>();
    for (const c of cobrancasPagas.filter(ehRacha)) {
      const key = c.rachaId ?? c.id ?? '';
      const atual = ultPorRacha.get(key);
      const atualTs = (atual?.criadoEm as unknown as { seconds?: number })?.seconds ?? 0;
      const cTs = (c.criadoEm as unknown as { seconds?: number })?.seconds ?? 0;
      if (!atual || cTs > atualTs) ultPorRacha.set(key, c);
    }
    let mrrRachasCentavos = 0;
    for (const c of ultPorRacha.values()) {
      mrrRachasCentavos += (c.valorCentavos || 0) / this.planosSrv.mesesDePeriodo(c.periodicidade);
    }
    let mrrCampeonatosCentavos = 0;
    for (const c of pagoPorUsuario.values()) {
      if (ehRacha(c)) continue; // já contabilizado por racha
      mrrCampeonatosCentavos += (c.valorCentavos || 0) / this.planosSrv.mesesDePeriodo(c.periodicidade);
    }

    // Top 10 pagantes — agrupa por usuario, soma cobrancas
    const acumPorUser = new Map<string, TopPagante>();
    const userMap = new Map(users.map(u => [u.uid, u]));
    for (const c of cobrancasPagas) {
      const uid = c.usuarioId;
      const u = userMap.get(uid);
      const existente = acumPorUser.get(uid) ?? {
        usuarioId: uid,
        nome: u?.nome ?? c.usuarioNome ?? '(sem nome)',
        email: u?.email ?? c.usuarioEmail,
        totalCentavos: 0,
        cobrancasCount: 0,
      };
      existente.totalCentavos += c.valorCentavos || 0;
      existente.cobrancasCount += 1;
      acumPorUser.set(uid, existente);
    }
    const topPagantes = Array.from(acumPorUser.values())
      .sort((a, b) => b.totalCentavos - a.totalCentavos)
      .slice(0, 10);

    // Gráfico mensal — últimos 12 meses
    const mesesGrafico: MesGrafico[] = this.gerarGraficoMensal(cobrancasPagas);

    return {
      mrr: mrrCentavos,
      arr: mrrCentavos * 12,
      ticketMedio: ticketMedioCentavos,
      totalPagantes,
      receitaTotal: receitaTotalCentavos,
      cobrancasPagas: cobrancasPagas.length,
      cobrancasAguardando: cobrancasAguardando.length,
      cobrancasAtrasadas: cobrancasAtrasadas.length,
      mesesGrafico,
      topPagantes,
      mrrCampeonatos: mrrCampeonatosCentavos,
      mrrRachas: mrrRachasCentavos,
      arrCampeonatos: mrrCampeonatosCentavos * 12,
      arrRachas: mrrRachasCentavos * 12,
      receitaCampeonatos: receitaCampeonatosCentavos,
      receitaRachas: receitaRachasCentavos,
    };
  }

  /** Gera array com 12 entradas (mês atual e 11 anteriores). */
  private gerarGraficoMensal(cobrs: Cobranca[]): MesGrafico[] {
    const labelsMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const buckets = new Map<string, number>();
    for (const c of cobrs) {
      if (!c.pagoEm) continue;
      const ts = (c.pagoEm as unknown as { seconds?: number })?.seconds;
      if (!ts) continue;
      const d = new Date(ts * 1000);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      buckets.set(key, (buckets.get(key) ?? 0) + (c.valorCentavos || 0));
    }

    const out: MesGrafico[] = [];
    const hoje = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const valor = buckets.get(key) ?? 0;
      const yy = d.getFullYear().toString().slice(-2);
      out.push({
        label: `${labelsMeses[d.getMonth()]}/${yy}`,
        valorCentavos: valor,
        altura: 0, // ajustado abaixo
      });
    }

    // Normaliza alturas para % (0-100) com base no máximo
    const max = out.reduce((m, x) => Math.max(m, x.valorCentavos), 0);
    for (const m of out) {
      m.altura = max > 0 ? Math.round((m.valorCentavos / max) * 100) : 0;
    }
    return out;
  }

  /** Formata centavos como string R$. */
  formatarCentavos(centavos: number): string {
    return this.cobrancasSrv.formatarValor(centavos);
  }

  trackByMes(_i: number, m: MesGrafico): string { return m.label; }
  trackByTop(_i: number, t: TopPagante): string { return t.usuarioId; }

  // ====================== Configurações Globais ======================

  /** Adiciona o código digitado à lista (organizador). */
  adicionarCodigoOrg(): void {
    const c = (this.novoCodigoOrg ?? '').trim();
    if (!c) return;
    if (!this.configForm.organizadorInviteCodes) {
      this.configForm.organizadorInviteCodes = [];
    }
    if (!this.configForm.organizadorInviteCodes.includes(c)) {
      this.configForm.organizadorInviteCodes.push(c);
    }
    this.novoCodigoOrg = '';
  }

  removerCodigoOrg(c: string): void {
    if (!this.configForm.organizadorInviteCodes) return;
    this.configForm.organizadorInviteCodes =
      this.configForm.organizadorInviteCodes.filter(x => x !== c);
  }

  adicionarCodigoMod(): void {
    const c = (this.novoCodigoMod ?? '').trim();
    if (!c) return;
    if (!this.configForm.moderadorInviteCodes) {
      this.configForm.moderadorInviteCodes = [];
    }
    if (!this.configForm.moderadorInviteCodes.includes(c)) {
      this.configForm.moderadorInviteCodes.push(c);
    }
    this.novoCodigoMod = '';
  }

  removerCodigoMod(c: string): void {
    if (!this.configForm.moderadorInviteCodes) return;
    this.configForm.moderadorInviteCodes =
      this.configForm.moderadorInviteCodes.filter(x => x !== c);
  }

  /** Salva o estado atual de configForm no Firestore. */
  async salvarConfig(): Promise<void> {
    if (this.salvandoConfig) return;
    this.salvandoConfig = true;
    try {
      await this.configSrv.salvar(this.configForm, this.auth.currentUser?.uid);
      // Registra a alteração no log de auditoria
      void this.logsSrv.registrar(
        'config_alterada',
        'Configurações globais atualizadas',
      );
    } catch (err) {
      console.error('[Admin] salvar config falhou', err);
      alert('Erro ao salvar configurações. Veja o console.');
    } finally {
      this.salvandoConfig = false;
    }
  }

  // ====================== Logs ======================

  onBuscaLogs(ev: { target?: { value?: string } }): void {
    this.buscaLogs$.next(ev.target?.value ?? '');
  }

  selecionarFiltroAcaoLog(acao: LogAcao | null): void {
    this.filtroAcaoLog = acao;
    this.filtroAcaoLog$.next(acao);
  }

  private filtrarLogs(
    list: LogAuditoria[],
    termo: string,
    acao: LogAcao | null,
  ): LogAuditoria[] {
    let out = list;
    if (acao) out = out.filter(l => l.acao === acao);
    const t = (termo ?? '').trim().toLowerCase();
    if (t) {
      out = out.filter(l =>
        (l.descricao ?? '').toLowerCase().includes(t) ||
        (l.usuarioLabel ?? '').toLowerCase().includes(t) ||
        (l.usuarioId ?? '').toLowerCase().includes(t),
      );
    }
    return out;
  }

  /** Formata o timestamp do log como string legível. */
  formatarTimestampLog(t?: Timestamp): string {
    if (!t) return '—';
    const raw = (t as unknown as { seconds?: number })?.seconds;
    if (!raw) return '—';
    const d = new Date(raw * 1000);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${mi}`;
  }

  /** Lista de filtros de ação disponíveis (pra renderizar chips). */
  readonly acoesLog: LogAcao[] = [
    'login', 'signup', 'campeonato_criado', 'campeonato_excluido',
    'plano_alterado', 'cobranca_criada', 'cobranca_paga',
    'config_alterada', 'usuario_promovido',
  ];

  trackByLog(_i: number, l: LogAuditoria): string {
    return l.id ?? '';
  }

  private filtrarUsuarios(
    list: UserProfile[],
    termo: string,
    status: typeof this.filtroStatusUsuario = 'todos',
    tipo: typeof this.filtroTipoUsuario = 'todos',
  ): UserProfile[] {
    const t = (termo ?? '').trim().toLowerCase();

    return list.filter(u => {
      // Busca livre
      if (t) {
        const bate =
          (u.nome ?? '').toLowerCase().includes(t) ||
          (u.email ?? '').toLowerCase().includes(t) ||
          (u.tipo ?? '').toLowerCase().includes(t) ||
          (u.uid ?? '').toLowerCase().includes(t);
        if (!bate) return false;
      }

      // Filtro por status
      switch (status) {
        case 'ativos':
          if (u.banido || u.bloqueado) return false;
          if (u.tipo === 'moderador' && !u.moderadorValidado) return false;
          break;
        case 'pendentes':
          if (u.tipo !== 'moderador' || u.moderadorValidado) return false;
          break;
        case 'bloqueados':
          if (!u.bloqueado || u.banido) return false;
          break;
        case 'banidos':
          if (!u.banido) return false;
          break;
        case 'admins':
          if (!u.isMaster) return false;
          break;
        // 'todos' — sem filtro
      }

      // Filtro por tipo
      if (tipo !== 'todos' && u.tipo !== tipo) return false;

      return true;
    });
  }

  /** Setter chamado pelos chips de filtro de status. */
  setFiltroStatusUsuario(status: typeof this.filtroStatusUsuario): void {
    this.filtroStatusUsuario = status;
    this.filtroStatusUsuario$.next(status);
  }

  /** Setter chamado pelos chips de filtro de tipo. */
  setFiltroTipoUsuario(tipo: typeof this.filtroTipoUsuario): void {
    this.filtroTipoUsuario = tipo;
    this.filtroTipoUsuario$.next(tipo);
  }

  setFiltroVisibilidadeCampeonato(v: typeof this.filtroVisibilidadeCampeonato): void {
    this.filtroVisibilidadeCampeonato = v;
    this.filtroVisibilidadeCampeonato$.next(v);
  }

  setFiltroCapaCampeonato(c: typeof this.filtroCapaCampeonato): void {
    this.filtroCapaCampeonato = c;
    this.filtroCapaCampeonato$.next(c);
  }

  /**
   * Exporta a lista atual de cobranças (já filtrada) em CSV.
   * Útil pro admin compartilhar com contador / financeiro externo.
   */
  async exportarCobrancasCsv(): Promise<void> {
    const cobs = await firstValueFrom(this.cobrancasFiltradas$);
    if (cobs.length === 0) {
      await this.toast('Nenhuma cobrança pra exportar.', 'medium');
      return;
    }
    const header = ['Usuário', 'Email', 'Plano', 'Periodicidade', 'Valor (R$)', 'Status', 'Vencimento', 'Método', 'Pago em'];
    const rows: string[][] = cobs.map((c: Cobranca) => [
      c.usuarioNome ?? c.usuarioId ?? '',
      c.usuarioEmail ?? '',
      c.planoId ?? '',
      c.periodicidade ?? '',
      // valorCentavos vem em centavos — divide por 100 e formata BR
      ((c.valorCentavos ?? 0) / 100).toFixed(2).replace('.', ','),
      c.status ?? '',
      // `vencimento` é string YYYY-MM-DD direto do model
      this.formatarDataIso(c.vencimento),
      c.metodoPagamento ?? '',
      this.formatarTimestamp(c.pagoEm),
    ]);
    const csv = [header, ...rows]
      .map((r: string[]) => r.map((v: string) => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cobrancas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await this.toast(`${cobs.length} cobranças exportadas.`, 'success');
  }

  /** Formata Timestamp do Firestore pra dd/mm/yyyy (CSV). */
  private formatarTimestamp(ts: unknown): string {
    if (!ts) return '';
    const millis = (ts as { toMillis?: () => number }).toMillis?.();
    if (!millis) return '';
    const d = new Date(millis);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  /** Formata string ISO YYYY-MM-DD pra dd/mm/yyyy (CSV). */
  private formatarDataIso(iso?: string): string {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }

  // ──────────────────────────────────────────────────────────────────
  // QUICK ACTIONS — botões inline na linha do user (sem abrir modal)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Toggle de bloqueio. Confirma via alert pra evitar clique acidental.
   * `$event.stopPropagation()` no template — pra clique no botão NÃO
   * abrir o modal de detalhes da linha.
   */
  async toggleBloqueio(u: UserProfile, $event: Event): Promise<void> {
    $event.stopPropagation();
    if (!u.uid) return;
    const novoEstado = !u.bloqueado;
    const alert = await this.alertCtrl.create({
      header: novoEstado ? 'Bloquear conta?' : 'Desbloquear conta?',
      message: novoEstado
        ? `"${u.nome || u.email}" não conseguirá mais fazer login até ser desbloqueado.`
        : `"${u.nome || u.email}" poderá voltar a acessar o sistema.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: novoEstado ? 'Bloquear' : 'Desbloquear',
          role: novoEstado ? 'destructive' : undefined,
          handler: async () => {
            try {
              await this.usersSrv.setBloqueado(u.uid, novoEstado);
              await this.toast(novoEstado ? 'Conta bloqueada.' : 'Conta desbloqueada.', 'success');
            } catch (err) {
              console.error('[Admin] toggleBloqueio falhou', err);
              await this.toast('Erro ao alterar status.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Valida moderador pendente — ativação rápida do dashboard.
   * Usa o método existente do UsersService que registra timestamp e UID do admin.
   */
  async validarModeradorRapido(u: UserProfile, $event: Event): Promise<void> {
    $event.stopPropagation();
    if (!u.uid) return;
    try {
      await this.usersSrv.setModeradorValidado(u.uid, true);
      await this.toast(`Moderador "${u.nome}" validado.`, 'success');
    } catch (err) {
      console.error('[Admin] validarModerador falhou', err);
      await this.toast('Erro ao validar moderador.', 'danger');
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // DASHBOARD — Ações pendentes (alertas pro admin agir)
  // ──────────────────────────────────────────────────────────────────

  /**
   * Stream de "ações pendentes" pro card de alertas no Dashboard.
   * Agrega: moderadores aguardando validação, cobranças atrasadas,
   * jogos em andamento (broadcast ativo) e contas reportadas/banidas.
   *
   * Inicializado no ngOnInit junto com os outros streams.
   */
  acoesPendentes$: Observable<{
    moderadoresPendentes: number;
    contasBloqueadas: number;
    contasBanidas: number;
    cobrancasAtrasadas: number;
    jogosAoVivo: number;
    total: number;
  }> = of({
    moderadoresPendentes: 0,
    contasBloqueadas: 0,
    contasBanidas: 0,
    cobrancasAtrasadas: 0,
    jogosAoVivo: 0,
    total: 0,
  });

  /** Helper privado pra mostrar toast curto (usado pelas quick actions). */
  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }

  private filtrarCampeonatos(
    camps: Campeonato[],
    users: UserProfile[],
    termo: string,
    visibilidade: typeof this.filtroVisibilidadeCampeonato = 'todos',
    capa: typeof this.filtroCapaCampeonato = 'todos',
  ): CampeonatoLinha[] {
    const uMap = new Map(users.map(u => [u.uid, u]));
    let enriched: CampeonatoLinha[] = camps.map(c => ({
      ...c,
      donoNome: c.ownerId ? uMap.get(c.ownerId)?.nome ?? c.ownerId : '—',
    }));

    // Filtro de visibilidade (publico=true/false ou ausente)
    if (visibilidade === 'publico') {
      enriched = enriched.filter(c => c.publico !== false);
    } else if (visibilidade === 'privado') {
      enriched = enriched.filter(c => c.publico === false);
    }

    // Filtro de capa (pra catar campeonatos incompletos sem branding)
    if (capa === 'com-capa') {
      enriched = enriched.filter(c => !!(c.capaUrl || c.bannerUrl));
    } else if (capa === 'sem-capa') {
      enriched = enriched.filter(c => !c.capaUrl && !c.bannerUrl);
    }
    const t = (termo ?? '').trim().toLowerCase();
    if (!t) return enriched;
    return enriched.filter(c =>
      (c.titulo ?? '').toLowerCase().includes(t) ||
      (c.subtitulo ?? '').toLowerCase().includes(t) ||
      (c.localizacao ?? '').toLowerCase().includes(t) ||
      (c.donoNome ?? '').toLowerCase().includes(t),
    );
  }

  private filtrarInscricoes(list: Inscricao[], termo: string): InscricaoLinha[] {
    const t = (termo ?? '').trim().toLowerCase();
    if (!t) return list;
    return list.filter(i =>
      (i.nomeEquipe ?? '').toLowerCase().includes(t) ||
      (i.responsavel ?? '').toLowerCase().includes(t) ||
      (i.email ?? '').toLowerCase().includes(t) ||
      (i.status ?? '').toLowerCase().includes(t),
    );
  }

  // ============ Handlers de UI ============

  selecionarSecao(s: SecaoAdmin): void {
    this.secao = s;
    // Ao abrir o editor de valores, carrega os valores efetivos atuais.
    if (s === 'valores') this.carregarValores();
  }

  // ============================================================
  // Editor de VALORES (preços/limites dos planos + preços de crédito)
  // Persistido em config/comercial via ConfigComercialService.
  // ============================================================

  /** Planos editáveis. Profissional fica de fora (ilimitado / sob consulta). */
  readonly valoresPlanos: { id: PlanoId; label: string; temPreco: boolean; cor: string; icon: string }[] = [
    { id: 'gratis', label: 'Grátis', temPreco: false, cor: '#94a3b8', icon: 'gift-outline' },
    { id: 'pequeno', label: 'Pequeno', temPreco: true, cor: '#4DABF7', icon: 'football-outline' },
    { id: 'medio', label: 'Médio', temPreco: true, cor: '#7CC61D', icon: 'trophy-outline' },
    { id: 'grande', label: 'Grande', temPreco: true, cor: '#F39C12', icon: 'ribbon-outline' },
  ];

  /** Planos de RACHA editáveis (só preço — pagos). */
  readonly valoresRachaPlanos: { id: PlanoRachaId; label: string; cor: string; icon: string }[] = [
    { id: 'premium', label: 'Racha Premium', cor: '#14b8a6', icon: 'flame-outline' },
    { id: 'pro', label: 'Racha Premium PRO', cor: '#16a34a', icon: 'sparkles-outline' },
  ];

  readonly camposPreco: { key: 'mensal' | 'trimestral' | 'semestral' | 'anual'; label: string }[] = [
    { key: 'mensal', label: 'Mensal' },
    { key: 'trimestral', label: 'Trimestral' },
    { key: 'semestral', label: 'Semestral' },
    { key: 'anual', label: 'Anual' },
  ];

  readonly camposLimite: { key: string; label: string; icon: string }[] = [
    { key: 'maxCampeonatos', label: 'Campeonatos', icon: 'trophy-outline' },
    { key: 'maxCategoriasPorCampeonato', label: 'Categorias / camp.', icon: 'albums-outline' },
    { key: 'maxJogadoresPorCategoria', label: 'Jogadores / cat.', icon: 'people-outline' },
    { key: 'maxPatrocinadores', label: 'Patrocinadores', icon: 'megaphone-outline' },
    { key: 'maxVideoSegundos', label: 'Vídeo (segundos)', icon: 'videocam-outline' },
    { key: 'maxTransmisoesSimultaneas', label: 'Transmissões simult.', icon: 'radio-outline' },
  ];


  /** Estado do formulário (carregado dos valores efetivos atuais). */
  valoresForm: {
    planos: Record<string, { precos: Record<string, number>; limites: Record<string, number> }>;
    rachaPlanos: Record<string, { precos: Record<string, number> }>;
    creditos: {
      patrocinioNormal: { preco: number; patrocinadores: number; duracaoMin: number };
      patrocinioPremium: { preco: number; patrocinadores: number; janelaSeg: number; intervaloMin: number };
      transmissaoAvulsa: { preco: number; duracaoMin: number; validadeMeses: number };
    };
  } = {
    planos: {},
    rachaPlanos: {},
    creditos: {
      patrocinioNormal: { preco: 0, patrocinadores: 0, duracaoMin: 0 },
      patrocinioPremium: { preco: 0, patrocinadores: 0, janelaSeg: 0, intervaloMin: 0 },
      transmissaoAvulsa: { preco: 0, duracaoMin: 0, validadeMeses: 0 },
    },
  };

  salvandoValores = false;

  /** Popula o form com os valores efetivos atuais (defaults + overrides). */
  carregarValores(): void {
    const planos: Record<string, { precos: Record<string, number>; limites: Record<string, number> }> = {};
    for (const p of this.valoresPlanos) {
      const def = this.planosSrv.getPlanoDef(p.id);
      planos[p.id] = {
        precos: {
          mensal: def.precos.mensal,
          trimestral: def.precos.trimestral,
          semestral: def.precos.semestral,
          anual: def.precos.anual,
        },
        limites: {
          maxCampeonatos: def.limites.maxCampeonatos,
          maxCategoriasPorCampeonato: def.limites.maxCategoriasPorCampeonato,
          maxJogadoresPorCategoria: def.limites.maxJogadoresPorCategoria,
          maxPatrocinadores: def.limites.maxPatrocinadores,
          maxVideoSegundos: def.limites.maxVideoSegundos,
          maxTransmisoesSimultaneas: def.limites.maxTransmisoesSimultaneas,
        },
      };
    }
    const rachaPlanos: Record<string, { precos: Record<string, number> }> = {};
    for (const p of this.valoresRachaPlanos) {
      const def = this.rachaPlanosSrv.getRachaPlanoDef(p.id);
      rachaPlanos[p.id] = {
        precos: {
          mensal: def.precos.mensal,
          trimestral: def.precos.trimestral,
          semestral: def.precos.semestral,
          anual: def.precos.anual,
        },
      };
    }
    this.valoresForm = {
      planos,
      rachaPlanos,
      creditos: {
        patrocinioNormal: {
          preco: this.planosSrv.precoCreditoNormal,
          patrocinadores: this.planosSrv.patrocinadoresCreditoNormal,
          duracaoMin: this.planosSrv.duracaoCreditoNormalMin,
        },
        patrocinioPremium: {
          preco: this.planosSrv.precoCreditoPremium,
          patrocinadores: this.planosSrv.premiumMaxPorJogo,
          janelaSeg: this.planosSrv.premiumJanelaSeg,
          intervaloMin: this.planosSrv.premiumIntervaloMin,
        },
        transmissaoAvulsa: {
          preco: this.planosSrv.VALOR_TRANSMISSAO_AVULSA,
          duracaoMin: this.planosSrv.transmissaoDuracaoMin,
          validadeMeses: this.planosSrv.transmissaoValidadeMeses,
        },
      },
    };
  }

  /** Salva os valores editados em config/comercial. */
  async salvarValores(): Promise<void> {
    this.salvandoValores = true;
    try {
      const planosPatch: NonNullable<ConfigComercial['planos']> = {};
      for (const p of this.valoresPlanos) {
        const f = this.valoresForm.planos[p.id];
        if (!f) continue;
        const limites = {
          maxCampeonatos: Number(f.limites['maxCampeonatos']),
          maxCategoriasPorCampeonato: Number(f.limites['maxCategoriasPorCampeonato']),
          maxJogadoresPorCategoria: Number(f.limites['maxJogadoresPorCategoria']),
          maxPatrocinadores: Number(f.limites['maxPatrocinadores']),
          maxVideoSegundos: Number(f.limites['maxVideoSegundos']),
          maxTransmisoesSimultaneas: Number(f.limites['maxTransmisoesSimultaneas']),
        };
        planosPatch[p.id] = p.temPreco
          ? {
              precos: {
                mensal: Number(f.precos['mensal']),
                trimestral: Number(f.precos['trimestral']),
                semestral: Number(f.precos['semestral']),
                anual: Number(f.precos['anual']),
              },
              limites,
            }
          : { limites };
      }
      // Preços dos planos de RACHA (separados dos campeonatos).
      const rachaPlanosPatch: NonNullable<ConfigComercial['rachaPlanos']> = {};
      for (const p of this.valoresRachaPlanos) {
        const f = this.valoresForm.rachaPlanos[p.id];
        if (!f) continue;
        rachaPlanosPatch[p.id] = {
          precos: {
            mensal: Number(f.precos['mensal']),
            trimestral: Number(f.precos['trimestral']),
            semestral: Number(f.precos['semestral']),
            anual: Number(f.precos['anual']),
          },
        };
      }
      const cn = this.valoresForm.creditos.patrocinioNormal;
      const cp = this.valoresForm.creditos.patrocinioPremium;
      const ct = this.valoresForm.creditos.transmissaoAvulsa;
      await this.configComercialSrv.salvar({
        planos: planosPatch,
        rachaPlanos: rachaPlanosPatch,
        creditos: {
          patrocinioNormal: {
            preco: Number(cn.preco),
            patrocinadores: Number(cn.patrocinadores),
            duracaoMin: Number(cn.duracaoMin),
          },
          patrocinioPremium: {
            preco: Number(cp.preco),
            patrocinadores: Number(cp.patrocinadores),
            janelaSeg: Number(cp.janelaSeg),
            intervaloMin: Number(cp.intervaloMin),
          },
          transmissaoAvulsa: {
            preco: Number(ct.preco),
            duracaoMin: Number(ct.duracaoMin),
            validadeMeses: Number(ct.validadeMeses),
          },
        },
      });
      await this.toast('Valores salvos! O app já usa os novos preços e limites.', 'success');
    } catch (err) {
      console.error('[Admin] salvar valores', err);
      await this.toast('Falha ao salvar valores. Tente novamente.', 'danger');
    } finally {
      this.salvandoValores = false;
    }
  }

  /** Pull-to-refresh — recarrega APENAS esta rota via Angular Router. */
  async onRefresh(ev: CustomEvent): Promise<void> {
    await this.refreshSrv.refreshAtual(ev);
  }

  /** Busca por seção — atualiza o BehaviorSubject correspondente. */
  setBuscaUsuarios(t: string): void { this.buscaUsuarios$.next(t ?? ''); }
  setBuscaCampeonatos(t: string): void { this.buscaCampeonatos$.next(t ?? ''); }
  setBuscaInscricoes(t: string): void { this.buscaInscricoes$.next(t ?? ''); }
  setBuscaOrganizadores(t: string): void { this.buscaOrganizadores$.next(t ?? ''); }
  setBuscaPlanos(t: string): void { this.buscaPlanos$.next(t ?? ''); }
  setBuscaCobrancas(t: string): void { this.buscaCobrancas$.next(t ?? ''); }
  setBuscaLogs(t: string): void { this.buscaLogs$.next(t ?? ''); }

  /** Filtra linhas de planos por nome/email/plano. */
  private filtrarLinhasPlanos(list: LinhaPlano[], termo: string): LinhaPlano[] {
    const t = (termo ?? '').trim().toLowerCase();
    if (!t) return list;
    return list.filter(l =>
      (l.usuario.nome ?? '').toLowerCase().includes(t) ||
      (l.usuario.email ?? '').toLowerCase().includes(t) ||
      l.planoDef.id.toLowerCase().includes(t) ||
      l.planoDef.label.toLowerCase().includes(t),
    );
  }

  /** Altera o plano de um usuário direto da tabela. */
  async alterarPlanoNaTabela(uid: string, novoPlanoId: PlanoId): Promise<void> {
    if (!uid || !novoPlanoId) return;
    try {
      await this.planosSrv.alterarPlanoDoUsuario(uid, novoPlanoId);
      // O stream do listAllUsers$() atualiza sozinho via Firestore realtime.
      // Registra a mudança no log de auditoria
      void this.logsSrv.registrar(
        'plano_alterado',
        `Plano do usuário ${uid} alterado para ${novoPlanoId}`,
        { uid, novoPlano: novoPlanoId },
      );
    } catch (err) {
      console.error('[Admin] erro ao alterar plano', err);
      alert('Falha ao alterar plano. Verifique as Firestore Rules.');
    }
  }

  /** Helper template — formata o preço de um plano. */
  formatarPrecoPlano(p: PlanoDef): string {
    return this.planosSrv.formatarPreco(p);
  }

  // ====================== Rachas (admin) ======================

  onBuscaRachas(ev: { target?: { value?: string } }): void {
    this.buscaRachas$.next(ev.target?.value ?? '');
  }
  selecionarFiltroStatusRacha(s: typeof this.filtroStatusRacha): void {
    this.filtroStatusRacha = s;
    this.filtroStatusRacha$.next(s);
  }
  selecionarFiltroPlanoRacha(p: typeof this.filtroPlanoRacha): void {
    this.filtroPlanoRacha = p;
    this.filtroPlanoRacha$.next(p);
  }
  selecionarFiltroVisibilidadeRacha(v: typeof this.filtroVisibilidadeRacha): void {
    this.filtroVisibilidadeRacha = v;
    this.filtroVisibilidadeRacha$.next(v);
  }
  selecionarAbaPlanos(aba: 'campeonatos' | 'racha'): void {
    this.abaPlanos = aba;
  }

  /** Altera o plano de um racha direto da tabela (admin). */
  async alterarPlanoRacha(rachaId: string, novoPlano: PlanoRachaId): Promise<void> {
    if (!rachaId || !novoPlano) return;
    try {
      await this.rachaSrv.alterarPlanoDoRacha(rachaId, novoPlano);
      void this.logsSrv.registrar(
        'plano_alterado',
        `Plano do racha ${rachaId} alterado para ${novoPlano}`,
        { rachaId, novoPlano },
      );
      await this.toast('Plano do racha atualizado.', 'success');
    } catch (err) {
      console.error('[Admin] alterar plano do racha', err);
      await this.toast('Falha ao alterar plano do racha.', 'danger');
    }
  }

  /** Altera o status de um racha direto da tabela (admin). */
  async alterarStatusRacha(rachaId: string, novoStatus: NonNullable<Racha['status']>): Promise<void> {
    if (!rachaId || !novoStatus) return;
    try {
      await this.rachaSrv.alterarStatusDoRacha(rachaId, novoStatus);
      void this.logsSrv.registrar(
        'plano_alterado',
        `Status do racha ${rachaId} alterado para ${novoStatus}`,
        { rachaId, novoStatus },
      );
      await this.toast('Status do racha atualizado.', 'success');
    } catch (err) {
      console.error('[Admin] alterar status do racha', err);
      await this.toast('Falha ao alterar status do racha.', 'danger');
    }
  }

  // ====================== Header (usuário + logout) ======================

  /** Inicial do usuário pra avatar fallback. */
  initials(user: User | null): string {
    return (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  }

  /** Confirma e sai da conta direto do header do painel admin. */
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
    this.adminNav.encerrar();
    await this.auth.signOut();
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }

  /** Abre o racha (área admin) — acesso total como dono. */
  abrirRacha(r: Racha): void {
    if (!r.id) return;
    this.adminNav.iniciar();
    this.router.navigate(['/racha', r.id, 'inicio']);
  }

  labelPlanoRacha(p?: string): string {
    return this.opcoesPlanoRacha.find(o => o.id === p)?.label ?? 'Gratuito';
  }
  labelStatusRacha(s?: string): string {
    return this.opcoesStatusRacha.find(o => o.id === s)?.label ?? 'Rascunho';
  }
  trackByRacha(_i: number, l: RachaLinha): string {
    return l.racha.id ?? '';
  }

  /** Abre o campeonato como dono (área admin) — fornece acesso total.
   *  Marca `adminNav.iniciar()` pra que apareça a faixa "Voltar pro
   *  Painel Admin" no topo das próximas páginas. */
  abrirCampeonato(c: Campeonato): void {
    if (!c.id) return;
    this.adminNav.iniciar();
    this.router.navigate(['/app/campeonato', c.id, 'inicio']);
  }

  /** Abre a ficha de inscrição via link público. */
  abrirInscricao(i: Inscricao): void {
    if (!i.campeonatoId) return;
    this.adminNav.iniciar();
    this.router.navigate(['/app/campeonato', i.campeonatoId, 'inicio']);
  }

  /** Toggle de expansão de um card de organizador (mostra/esconde campeonatos). */
  toggleOrganizador(uid: string): void {
    if (this.expandidos.has(uid)) {
      this.expandidos.delete(uid);
    } else {
      this.expandidos.add(uid);
    }
  }
  estaExpandido(uid: string): boolean {
    return this.expandidos.has(uid);
  }

  /** Abre modal com detalhes completos do usuário (perfil + campeonatos + inscrições). */
  async abrirDetalhesUsuario(u: UserProfile): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: UserDetailModalComponent,
      componentProps: { usuario: u },
      cssClass: 'modal-large',
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ abrirCampeonatoId?: string }>();
    if (data?.abrirCampeonatoId) {
      this.adminNav.iniciar();
      this.router.navigate(['/app/campeonato', data.abrirCampeonatoId, 'inicio']);
    }
  }

  /** Abre modal com detalhes completos do campeonato (categorias + equipes + jogos). */
  async abrirDetalhesCampeonato(c: Campeonato): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CampeonatoDetailModalComponent,
      componentProps: { campeonato: c },
      cssClass: 'modal-large',
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ abrirCategoriaId?: string }>();
    if (data?.abrirCategoriaId && c.id) {
      this.adminNav.iniciar();
      this.router.navigate([
        '/app/campeonato', c.id, 'categoria', data.abrirCategoriaId, 'inicio',
      ]);
    }
  }

  // ============ Helpers de template ============

  iconTipo(tipo?: TipoConta): string {
    switch (tipo) {
      case 'organizador': return 'briefcase-outline';
      case 'moderador':   return 'shield-outline';
      case 'cliente':     return 'person-outline';
      case 'racha':       return 'football-outline';
      default:            return 'help-circle-outline';
    }
  }

  corStatus(status?: string): string {
    switch (status) {
      case 'aprovada':  return 'success';
      case 'rejeitada': return 'danger';
      case 'pendente':  return 'warning';
      default:          return 'medium';
    }
  }

  formatarDataTs(ts: any): string {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
    } catch {
      return '—';
    }
  }

  trackByUid(_i: number, u: UserProfile): string { return u.uid; }
  trackByCampId(_i: number, c: Campeonato): string { return c.id ?? ''; }
  trackByInscId(_i: number, i: Inscricao): string { return i.id ?? ''; }
  trackByGrupo(_i: number, g: GrupoOrganizador): string { return g.organizador.uid; }
}
