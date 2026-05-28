import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController } from '@ionic/angular';
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
import { Observable, combineLatest, of, BehaviorSubject } from 'rxjs';
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
import { LogsService } from '../../users/logs.service';
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
  | 'planos'
  | 'cobrancas'
  | 'financeiro'
  | 'configuracoes'
  | 'logs';

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
}

interface CampeonatoLinha extends Campeonato {
  donoNome?: string;
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
  private readonly adminNav = inject(AdminNavigationService);
  private readonly refreshSrv = inject(RefreshService);
  private readonly planosSrv = inject(PlanosService);
  private readonly cobrancasSrv = inject(CobrancasService);
  private readonly configSrv = inject(ConfigGlobalService);
  private readonly logsSrv = inject(LogsService);

  /** Expostos pro template. */
  readonly LOG_ACAO_LABEL = LOG_ACAO_LABEL;
  readonly LOG_ACAO_COR = LOG_ACAO_COR;

  /** Expostos pro template (constantes de labels/cores de cobranças). */
  readonly COBRANCA_STATUS_LABEL = COBRANCA_STATUS_LABEL;
  readonly COBRANCA_STATUS_COR = COBRANCA_STATUS_COR;
  readonly METODO_PAGAMENTO_LABEL = METODO_PAGAMENTO_LABEL;

  /** Catálogo completo de planos (usado no dropdown da tabela de planos). */
  readonly catalogoPlanos: ReadonlyArray<PlanoDef> = this.planosSrv.planos;

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
  private readonly buscaCobrancas$ = new BehaviorSubject<string>('');
  private readonly filtroStatusCobranca$ = new BehaviorSubject<CobrancaStatus | null>(null);

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
  });

  // ============ Configurações globais (form local) ============
  config$: Observable<ConfigGlobal> = of({});
  /** Form local — populado pelo stream e enviado no submit. */
  configForm: ConfigGlobal = {
    organizadorInviteCodes: [],
    moderadorInviteCodes: [],
    modoManutencao: false,
    mensagemManutencao: '',
    asaasUrl: '',
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

    // ============ Stats (agora inclui equipes/jogadores/jogos) ============
    this.stats$ = combineLatest([
      this.usuarios$, this.campeonatos$, this.inscricoes$,
      this.equipes$, this.jogadores$, this.jogos$,
    ]).pipe(
      map(([users, camps, inscs, eqs, jgds, jgs]) =>
        this.calcularStats(users, camps, inscs, eqs, jgds, jgs)),
    );

    // ============ Organizadores agrupados ============
    this.organizadores$ = combineLatest([this.usuarios$, this.campeonatos$]).pipe(
      map(([users, camps]) => this.agruparPorOrganizador(users, camps)),
    );

    // ============ Listas filtradas (busca client-side) ============
    this.usuariosFiltrados$ = combineLatest([this.usuarios$, this.buscaUsuarios$]).pipe(
      map(([list, t]) => this.filtrarUsuarios(list, t)),
    );

    this.campeonatosFiltrados$ = combineLatest([
      this.campeonatos$, this.usuarios$, this.buscaCampeonatos$,
    ]).pipe(
      map(([camps, users, t]) => this.filtrarCampeonatos(camps, users, t)),
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
      this.cobrancas$, this.buscaCobrancas$, this.filtroStatusCobranca$,
    ]).pipe(
      map(([list, t, status]) => this.filtrarCobrancas(list, t, status)),
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
    };
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
  ): Cobranca[] {
    let out = list;
    if (status) out = out.filter(c => c.status === status);
    const t = (termo ?? '').trim().toLowerCase();
    if (t) {
      out = out.filter(c =>
        (c.usuarioNome ?? '').toLowerCase().includes(t) ||
        (c.usuarioEmail ?? '').toLowerCase().includes(t) ||
        (c.planoId ?? '').toLowerCase().includes(t) ||
        (c.id ?? '').toLowerCase().includes(t),
      );
    }
    return out;
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
    if (!c.id || !c.usuarioId) return;
    try {
      // 1) Atualiza status da cobrança
      await this.cobrancasSrv.atualizarStatus(c.id, 'pago');
      // 2) Promove o usuário ao plano referenciado
      await this.planosSrv.alterarPlanoDoUsuario(c.usuarioId, c.planoId);
      // 3) Audita
      void this.logsSrv.registrar(
        'cobranca_paga',
        `Cobrança ${c.id} marcada como paga — usuário ${c.usuarioNome ?? c.usuarioId} promovido ao plano ${c.planoId}`,
        { cobrancaId: c.id, usuarioId: c.usuarioId, planoId: c.planoId },
      );
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
      await this.configSrv.salvar(this.configForm);
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

  private filtrarUsuarios(list: UserProfile[], termo: string): UserProfile[] {
    const t = (termo ?? '').trim().toLowerCase();
    if (!t) return list;
    return list.filter(u =>
      (u.nome ?? '').toLowerCase().includes(t) ||
      (u.email ?? '').toLowerCase().includes(t) ||
      (u.tipo ?? '').toLowerCase().includes(t) ||
      (u.uid ?? '').toLowerCase().includes(t),
    );
  }

  private filtrarCampeonatos(
    camps: Campeonato[],
    users: UserProfile[],
    termo: string,
  ): CampeonatoLinha[] {
    const uMap = new Map(users.map(u => [u.uid, u]));
    const enriched: CampeonatoLinha[] = camps.map(c => ({
      ...c,
      donoNome: c.ownerId ? uMap.get(c.ownerId)?.nome ?? c.ownerId : '—',
    }));
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
