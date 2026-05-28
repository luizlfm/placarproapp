import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  ModalController,
  PopoverController,
  ToastController,
  LoadingController,
} from '@ionic/angular';
import { BehaviorSubject, Observable, Subscription, combineLatest, firstValueFrom, of, switchMap } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { ClassificacaoGrupo, ClassificacaoService, LinhaClassificacao } from '../../../campeonatos/classificacao.service';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { Fase, PosicaoDestaque } from '../../../campeonatos/models/fase.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { GruposService } from '../../../campeonatos/grupos.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { FasesService } from '../../../campeonatos/fases.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { GruposModalComponent } from '../../../shared/components/grupos-modal/grupos-modal.component';
import { FasesModalComponent } from './fases-modal/fases-modal.component';
import { CriteriosModalComponent } from './criterios-modal/criterios-modal.component';
import { GerarPartidasModalComponent } from './gerar-partidas-modal/gerar-partidas-modal.component';
import { ReordenarModalComponent } from './reordenar-modal/reordenar-modal.component';
import { NovaRodadaModalComponent } from './nova-rodada-modal/nova-rodada-modal.component';
import { EditarRodadaModalComponent } from './editar-rodada-modal/editar-rodada-modal.component';
import { ImprimirClassificacaoPage } from './imprimir/imprimir-classificacao.page';
import { dataHoraIsoParaBr } from '../../../shared/directives/mask.directive';
import { ReordenarRodadasModalComponent } from './reordenar-rodadas-modal/reordenar-rodadas-modal.component';
import { JogoModalComponent } from '../../../shared/components/jogo-modal/jogo-modal.component';
import { SelecionarEquipesModalComponent } from '../../../shared/components/selecionar-equipes-modal/selecionar-equipes-modal.component';
import { SelecionarLadoModalComponent } from '../../../shared/components/selecionar-lado-modal/selecionar-lado-modal.component';
import { EditarInformacoesModalComponent } from '../jogo-detalhe/editar-informacoes-modal/editar-informacoes-modal.component';
import {
  JogoAcao,
  JogoAcoesPopoverComponent,
} from '../../../shared/components/jogo-acoes-popover/jogo-acoes-popover.component';
import {
  JogosAcao,
  JogosAcoesPopoverComponent,
} from '../../../shared/components/jogos-acoes-popover/jogos-acoes-popover.component';
import {
  ModeradorPermissoesService,
  PermissoesEfetivas,
} from '../../../shared/moderador-permissoes.service';

interface JogoView extends Jogo {
  nomeMandante: string;
  nomeVisitante: string;
  logoMandante?: string;
  logoVisitante?: string;
}

@Component({
  selector: 'app-classificacao',
  templateUrl: './classificacao.page.html',
  styleUrls: ['./classificacao.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ClassificacaoPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly classifSrv = inject(ClassificacaoService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly gruposSrv = inject(GruposService);
  private readonly jogosSrv = inject(JogosService);
  private readonly fasesSrv = inject(FasesService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly popoverCtrl = inject(PopoverController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modPerms = inject(ModeradorPermissoesService);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  /** Permissões efetivas do user logado no campeonato. Usado pra esconder
   *  botões de edição (FAB do painel, FAB de jogos, click handlers em
   *  células editáveis) pra moderadores sem permissão. Owner/admin sempre
   *  recebem tudo true. */
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

  fases: Fase[] = [];
  faseAtual?: Fase;
  ordemManual = false;
  menuAberto = false;
  menuJogosAberto = false;
  /** Quando true: tabelas separadas por grupo (default). Quando false: tabela única unificada. */
  agruparPorGrupo = true;

  novoNome = '';
  criando = false;

  readonly campeonato$: Observable<Campeonato | undefined> =
    this.campeonatoId ? this.campeonatosSrv.get$(this.campeonatoId) : of(undefined);

  readonly categoria$: Observable<Categoria | undefined> =
    this.campeonatoId && this.categoriaId
      ? this.categoriasSrv.get$(this.campeonatoId, this.categoriaId)
      : of(undefined);

  private readonly faseSubject = new BehaviorSubject<Fase | null>(null);
  private readonly ordemManualSubject = new BehaviorSubject<boolean>(false);
  private readonly agruparSubject = new BehaviorSubject<boolean>(true);
  private subFases?: Subscription;

  readonly classificacao$: Observable<ClassificacaoGrupo[]> =
    this.campeonatoId && this.categoriaId
      ? combineLatest([this.faseSubject, this.ordemManualSubject, this.agruparSubject]).pipe(
          switchMap(([fase, manual, agrupar]) =>
            this.classifSrv
              .classificacao$(this.campeonatoId, this.categoriaId, fase, manual)
              .pipe(
                map(grupos => agrupar ? grupos : this.unificarGrupos(grupos)),
                startWith<ClassificacaoGrupo[]>([]),
                catchError(err => {
                  console.error('[Classificacao] erro', err);
                  return of<ClassificacaoGrupo[]>([]);
                }),
              ),
          ),
        )
      : of([]);

  /** Junta todas as linhas num único grupo "Geral", recalculando as posições. */
  private unificarGrupos(grupos: ClassificacaoGrupo[]): ClassificacaoGrupo[] {
    if (grupos.length <= 1) return grupos;
    const todas: LinhaClassificacao[] = grupos.reduce<LinhaClassificacao[]>(
      (acc, g) => acc.concat(g.linhas),
      [],
    );
    // Mantém a ordem original (já vem ordenada por critério dentro de cada grupo).
    // Pra uma unificada justa, reordena por pontos desc -> SG desc -> GP desc.
    todas.sort((a: LinhaClassificacao, b: LinhaClassificacao) => {
      if (b.pontos !== a.pontos) return b.pontos - a.pontos;
      if (b.saldoGols !== a.saldoGols) return b.saldoGols - a.saldoGols;
      return b.golsPro - a.golsPro;
    });
    todas.forEach((l: LinhaClassificacao, i: number) => (l.pos = i + 1));
    return [{ grupo: null, linhas: todas }];
  }

  readonly jogos$: Observable<JogoView[]> =
    this.campeonatoId && this.categoriaId
      ? combineLatest([
          this.jogosSrv.list$(this.campeonatoId, this.categoriaId).pipe(
            startWith<Jogo[]>([]),
            catchError(() => of<Jogo[]>([])),
          ),
          this.equipesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
            startWith<Equipe[]>([]),
            catchError(() => of<Equipe[]>([])),
          ),
          this.faseSubject,
        ]).pipe(
          map(([js, eqs, fase]) => {
            const filtrados = fase
              ? js.filter(j => !j.fase || j.fase === fase.nome)
              : js;
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
        )
      : of([]);

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;
    try {
      await this.fasesSrv.ensureDefault(this.campeonatoId, this.categoriaId);
    } catch (err) {
      console.error('[Classificacao] ensureDefault erro', err);
    }
    this.subFases = this.fasesSrv
      .list$(this.campeonatoId, this.categoriaId)
      .subscribe(fs => {
        this.fases = fs;
        if (!this.faseAtual || !fs.find(f => f.id === this.faseAtual?.id)) {
          this.faseAtual = fs[0];
          this.faseSubject.next(this.faseAtual ?? null);
        }
      });

    // Auto-abertura de modal via query param (vindo de Configurações ou
    // da página /jogos quando o usuário escolhe uma ação que precisa dos
    // modais declarados aqui em classificacao).
    const abrir = this.route.snapshot.queryParamMap.get('abrir');
    if (abrir) {
      // Espera um pouco para o snapshot de fases chegar e o this.faseAtual estar setado.
      setTimeout(() => {
        if (abrir === 'fases')     { this.abrirFases(); return; }
        if (abrir === 'criterios') { this.abrirCriterios(); return; }
        // Ações de gerenciamento dos jogos — dispatcha pra mesma lógica
        // do popover "+".
        const acoesJogos: JogosAcao[] = [
          'add-rodada', 'add-partida', 'editar-rodada',
          'reordenar-rodadas', 'gerar-partidas', 'exportar',
        ];
        if ((acoesJogos as string[]).includes(abrir)) {
          this.executarAcaoJogos(abrir as JogosAcao);
        }
      }, 250);
    }
  }

  ngOnDestroy(): void {
    this.subFases?.unsubscribe();
  }

  onFaseChange(faseId: string): void {
    const f = this.fases.find(x => x.id === faseId);
    this.faseAtual = f;
    this.faseSubject.next(f ?? null);
  }

  toggleMenu(): void {
    this.menuAberto = !this.menuAberto;
    this.menuJogosAberto = false;
  }
  fecharMenu(): void {
    this.menuAberto = false;
  }

  toggleMenuJogos(): void {
    this.menuJogosAberto = !this.menuJogosAberto;
    this.menuAberto = false;
  }
  fecharMenuJogos(): void {
    this.menuJogosAberto = false;
  }

  toggleAgruparPorGrupo(ev?: Event): void {
    if (ev) ev.stopPropagation();
    this.agruparPorGrupo = !this.agruparPorGrupo;
    this.agruparSubject.next(this.agruparPorGrupo);
  }

  /** Quick-add inline: cria equipe pelo nome, já entra na tabela com zeros. */
  async adicionarEquipe(): Promise<void> {
    const nome = this.novoNome.trim();
    if (nome.length < 2) {
      await this.toast('Nome muito curto.', 'danger');
      return;
    }
    this.criando = true;
    try {
      await this.equipesSrv.criar(this.campeonatoId, this.categoriaId, { nome });
      this.novoNome = '';
      await this.toast(`Equipe "${nome}" criada.`, 'success');
    } catch (err) {
      console.error('[Classificacao] criar equipe erro', err);
      await this.toast('Erro ao criar equipe.', 'danger');
    } finally {
      this.criando = false;
    }
  }

  // ─── Menu de ações ──────────────────────────────────────────
  irParaEquipes(): void {
    this.fecharMenu();
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'equipes',
    ]);
  }

  async abrirGrupos(): Promise<void> {
    this.fecharMenu();
    const modal = await this.modalCtrl.create({
      component: GruposModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await modal.present();
  }

  async abrirFases(): Promise<void> {
    this.fecharMenu();
    const modal = await this.modalCtrl.create({
      component: FasesModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await modal.present();
  }

  async abrirCriterios(): Promise<void> {
    this.fecharMenu();
    if (!this.faseAtual) return;
    const modal = await this.modalCtrl.create({
      component: CriteriosModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        fase: this.faseAtual,
      },
    });
    await modal.present();
  }

  async abrirReordenar(): Promise<void> {
    this.fecharMenu();
    const modal = await this.modalCtrl.create({
      component: ReordenarModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ saved?: boolean; manual?: boolean }>();
    if (data?.saved) {
      this.ordemManual = !!data.manual;
      this.ordemManualSubject.next(this.ordemManual);
    }
  }

  toggleOrdemManual(): void {
    this.ordemManual = !this.ordemManual;
    this.ordemManualSubject.next(this.ordemManual);
  }

  async exportar(): Promise<void> {
    this.fecharMenu();
    const grupos = await firstValueFrom(this.classificacao$);
    if (grupos.length === 0 || grupos.every(g => g.linhas.length === 0)) {
      await this.toast('Nada para exportar.', 'danger');
      return;
    }
    const header = ['Grupo', 'Pos', 'Equipe', 'P', 'J', 'V', 'E', 'D', 'GP', 'GC', 'SG', '%', 'PE'];
    const rows: (string | number)[][] = [header];
    grupos.forEach(g => {
      g.linhas.forEach(l => {
        rows.push([
          g.grupo?.nome ?? 'Geral',
          l.pos,
          l.equipe.nome,
          l.pontos,
          l.jogos,
          l.vitorias,
          l.empates,
          l.derrotas,
          l.golsPro,
          l.golsContra,
          l.saldoGols,
          l.aproveitamento,
          l.penalizacao,
        ]);
      });
    });
    const csv = rows
      .map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `classificacao-${this.faseAtual?.nome?.replace(/\s+/g, '_').toLowerCase() ?? 'fase'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await this.toast('CSV exportado.', 'success');
  }

  async imprimirTabela(): Promise<void> {
    this.fecharMenu();
    // Abre como modal (mesmo padrão de Critério de classificação) em vez
    // de navegar pra rota. O componente ImprimirClassificacaoPage aceita
    // os IDs via @Input quando `modoModal=true`.
    const modal = await this.modalCtrl.create({
      component: ImprimirClassificacaoPage,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        modoModal: true,
      },
    });
    await modal.present();
  }

  // ─── Jogos sidebar ──────────────────────────────────────────
  async gerarPartidas(): Promise<void> {
    if (!this.faseAtual) {
      await this.toast('Selecione uma fase primeiro.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: GerarPartidasModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        fase: this.faseAtual,
      },
    });
    await modal.present();
  }

  async adicionarRodada(): Promise<void> {
    if (!this.faseAtual) {
      await this.toast('Selecione uma fase primeiro.', 'danger');
      return;
    }
    const todasEquipes = await firstValueFrom(
      this.equipesSrv.list$(this.campeonatoId, this.categoriaId),
    );
    if (todasEquipes.length < 2) {
      await this.toast('Cadastre ao menos 2 equipes.', 'danger');
      return;
    }
    // Calcula a próxima rodada com base nos jogos existentes da fase
    const jogosFase = await firstValueFrom(
      this.jogosSrv.list$(this.campeonatoId, this.categoriaId),
    );
    const maxRodada = jogosFase
      .filter(j => !j.fase || j.fase === this.faseAtual?.nome)
      .reduce((max, j) => Math.max(max, j.rodada ?? 0), 0);

    const modal = await this.modalCtrl.create({
      component: NovaRodadaModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        fase: this.faseAtual,
        proximaRodada: maxRodada + 1,
      },
      backdropDismiss: false,
    });
    await modal.present();
  }

  /** Clique no card de jogo → abre popover de ações (Ver/Selecionar/Editar/Restaurar/Remover). */
  /**
   * Fluxo do item "Editar Rodada" do menu global — como o menu não sabe
   * qual rodada editar, mostra um alert com radio das rodadas existentes
   * na fase atual. Se só tem uma rodada, vai direto. Vazio = aviso.
   */
  private async escolherRodadaEEditar(): Promise<void> {
    if (!this.faseAtual) {
      await this.toast('Selecione uma fase primeiro.', 'danger');
      return;
    }
    const todos = await firstValueFrom(
      this.jogosSrv.list$(this.campeonatoId, this.categoriaId),
    );
    const numeros = Array.from(new Set(
      todos
        .filter(j => (j.fase ?? '') === (this.faseAtual?.nome ?? '') && j.rodada)
        .map(j => j.rodada as number),
    )).sort((a, b) => a - b);

    if (numeros.length === 0) {
      await this.toast('Nenhuma rodada na fase atual.', 'danger');
      return;
    }
    if (numeros.length === 1) {
      await this.abrirEditarRodada(new Event('click'), this.faseAtual.nome, numeros[0]);
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Editar qual rodada?',
      inputs: numeros.map(n => ({
        type: 'radio' as const,
        label: `Rodada ${n}`,
        value: n,
        checked: n === numeros[0],
      })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Editar',
          handler: (value: number) => {
            if (value && this.faseAtual) {
              this.abrirEditarRodada(new Event('click'), this.faseAtual.nome, value);
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Abre o modal pequeno de edição de rodada. Disparado pelo ícone de
   * lápis no chip "Rodada N" do card de jogo. Para a fase, usa o nome
   * gravado no Jogo (mesmo campo usado pra agrupar).
   */
  async abrirEditarRodada(ev: Event, faseNome: string | undefined, numero: number | undefined): Promise<void> {
    ev.stopPropagation();
    if (!numero) return;
    const modal = await this.modalCtrl.create({
      component: EditarRodadaModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        faseNome: faseNome ?? '',
        numero,
      },
      cssClass: 'modal-editar-rodada',
      backdropDismiss: true,
    });
    await modal.present();
  }

  async abrirJogo(ev: Event, jogoId: string): Promise<void> {
    ev.stopPropagation();
    const [todosJogos, equipes, perms] = await Promise.all([
      firstValueFrom(this.jogosSrv.list$(this.campeonatoId, this.categoriaId)),
      firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
      firstValueFrom(this.permissoes$),
    ]);
    const jogo = todosJogos.find(j => j.id === jogoId);
    if (!jogo) return;

    const pop = await this.popoverCtrl.create({
      component: JogoAcoesPopoverComponent,
      componentProps: { podeEditar: perms.editarResultados },
      event: ev,
      showBackdrop: true,
      dismissOnSelect: false,
      cssClass: 'popover-jogo-acoes',
    });
    await pop.present();
    const { data } = await pop.onDidDismiss<{ acao?: JogoAcao }>();
    if (!data?.acao) return;
    await this.executarAcaoJogo(data.acao, jogo, equipes);
  }

  private async executarAcaoJogo(
    acao: JogoAcao,
    jogo: Jogo,
    equipes: Equipe[],
  ): Promise<void> {
    if (!jogo.id) return;
    const baseRoute = [
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      jogo.id,
    ];
    switch (acao) {
      case 'ver':
        // Tela "Ver partida" — detalhes (placar, escalações, lances)
        this.router.navigate(baseRoute);
        return;
      case 'resultado':
        // "Editar resultado" — tela do editor de partida (gols/cartões/lances)
        this.router.navigate([...baseRoute, 'editar']);
        return;
      case 'equipes': {
        // "Selecionar equipes" — modal com listas filtradas pelo grupo do jogo.
        const grupos = await firstValueFrom(
          this.gruposSrv.list$(this.campeonatoId, this.categoriaId),
        );
        const modal = await this.modalCtrl.create({
          component: SelecionarEquipesModalComponent,
          componentProps: {
            campeonatoId: this.campeonatoId,
            categoriaId: this.categoriaId,
            jogo,
            equipes,
            grupos,
          },
          backdropDismiss: true,
        });
        await modal.present();
        return;
      }
      case 'informacoes': {
        // "Editar informações" — modal compacto (título, data, local, aviso)
        const modal = await this.modalCtrl.create({
          component: EditarInformacoesModalComponent,
          componentProps: {
            campeonatoId: this.campeonatoId,
            categoriaId: this.categoriaId,
            jogo,
          },
          backdropDismiss: true,
        });
        await modal.present();
        return;
      }
      case 'restaurar':
        await this.restaurarJogo(jogo);
        return;
      case 'remover':
        await this.confirmarRemoverJogo(jogo);
        return;
    }
  }

  private async restaurarJogo(j: Jogo): Promise<void> {
    if (!j.id) return;
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, j.id, {
        status: 'agendado',
        golsMandante: null,
        golsVisitante: null,
      });
      await this.toast('Partida restaurada.', 'success');
    } catch {
      await this.toast('Erro ao restaurar.', 'danger');
    }
  }

  private async confirmarRemoverJogo(j: Jogo): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover partida?',
      message: 'A partida será apagada definitivamente.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.jogosSrv.remover(this.campeonatoId, this.categoriaId, j.id!);
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Cria uma partida vazia (sem equipes definidas).
   * Aparece como "? × ?" — basta clicar para usar o popover e definir equipes/resultado.
   */
  /**
   * Atalho rápido: clicar no escudo do mandante ou visitante abre lista
   * de equipes pra atribuir direto naquele lado, sem passar pelo popover.
   */
  async selecionarEquipeNoJogo(
    ev: Event,
    jogoId: string,
    lado: 'mandante' | 'visitante',
  ): Promise<void> {
    ev.stopPropagation();
    const [todosJogos, equipes] = await Promise.all([
      firstValueFrom(this.jogosSrv.list$(this.campeonatoId, this.categoriaId)),
      firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
    ]);
    if (equipes.length === 0) {
      await this.toast('Cadastre equipes antes.', 'danger');
      return;
    }
    const jogo = todosJogos.find(j => j.id === jogoId);
    if (!jogo) return;

    // Abre o modal customizado (com escudos + aviso de zeragem se há resultado)
    const modal = await this.modalCtrl.create({
      component: SelecionarLadoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogo,
        lado,
        equipes,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  async adicionarPartidaVazia(): Promise<void> {
    if (!this.faseAtual) {
      await this.toast('Selecione uma fase primeiro.', 'danger');
      return;
    }
    // Próxima rodada = última usada na fase atual + 1 (ou 1 se vazia)
    const jogos = await firstValueFrom(
      this.jogosSrv.list$(this.campeonatoId, this.categoriaId),
    );
    const maxRodada = jogos
      .filter(j => !j.fase || j.fase === this.faseAtual?.nome)
      .reduce((max, j) => Math.max(max, j.rodada ?? 0), 0);

    try {
      await this.jogosSrv.criar(this.campeonatoId, this.categoriaId, {
        mandanteId: '',
        visitanteId: '',
        rodada: maxRodada || 1,
        fase: this.faseAtual.nome,
      });
      await this.toast('Partida adicionada. Clique nela para definir as equipes.', 'success');
    } catch (err) {
      console.error('[Classificacao] adicionar partida vazia erro', err);
      await this.toast('Erro ao adicionar partida.', 'danger');
    }
  }

  /** Abre o modal de novo jogo direto (sem passar pela rodada). */
  async novoJogoAvulso(): Promise<void> {
    const [equipes, jogosExistentes] = await Promise.all([
      firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
      firstValueFrom(this.jogosSrv.list$(this.campeonatoId, this.categoriaId)),
    ]);
    if (equipes.length < 2) {
      await this.toast('Cadastre ao menos 2 equipes.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: JogoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipes,
        fases: this.fases,
        jogosExistentes,
        faseDefault: this.faseAtual?.nome,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  /**
   * Abre o popover de ações da sidebar Jogos (Adicionar Rodada, Adicionar Partida,
   * Editar Rodada, Reordenar Rodadas, Gerar Partidas, Exportar).
   */
  async abrirPopoverJogos(ev: Event): Promise<void> {
    ev.stopPropagation();
    this.menuJogosAberto = false;
    // Ancora EMBAIXO do botão com alinhamento CENTER — o popover fica
    // centralizado horizontalmente sob o "+", sem vazar pra esquerda ou
    // direita como `alignment: 'end'` causava em telas estreitas.
    const pop = await this.popoverCtrl.create({
      component: JogosAcoesPopoverComponent,
      event: ev,
      showBackdrop: true,
      dismissOnSelect: false,
      cssClass: 'popover-jogos-acoes',
      side: 'bottom',
      alignment: 'center',
      arrow: false,
    });
    await pop.present();
    const { data } = await pop.onDidDismiss<{ acao?: JogosAcao }>();
    if (!data?.acao) return;
    await this.executarAcaoJogos(data.acao);
  }

  private async executarAcaoJogos(acao: JogosAcao): Promise<void> {
    if (!this.faseAtual) {
      await this.toast('Selecione uma fase primeiro.', 'danger');
      return;
    }
    switch (acao) {
      case 'add-rodada':
        await this.adicionarRodada();
        return;
      case 'add-partida':
        await this.adicionarPartidaVazia();
        return;
      case 'editar-rodada': {
        await this.escolherRodadaEEditar();
        return;
      }
      case 'reordenar-rodadas': {
        const modal = await this.modalCtrl.create({
          component: ReordenarRodadasModalComponent,
          componentProps: {
            campeonatoId: this.campeonatoId,
            categoriaId: this.categoriaId,
            fase: this.faseAtual,
          },
          backdropDismiss: true,
        });
        await modal.present();
        return;
      }
      case 'gerar-partidas':
        await this.gerarPartidas();
        return;
      case 'exportar':
        await this.exportarJogos();
        return;
    }
  }

  /** Exporta os jogos da fase atual em CSV. */
  async exportarJogos(): Promise<void> {
    const [jogos, equipes] = await Promise.all([
      firstValueFrom(this.jogosSrv.list$(this.campeonatoId, this.categoriaId)),
      firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
    ]);
    const filtrados = this.faseAtual
      ? jogos.filter(j => !j.fase || j.fase === this.faseAtual!.nome)
      : jogos;
    if (filtrados.length === 0) {
      await this.toast('Nenhum jogo para exportar.', 'danger');
      return;
    }
    const eqMap = new Map(equipes.map(e => [e.id!, e.nome]));
    const header = ['Fase', 'Rodada', 'Mandante', 'Visitante', 'Gols M', 'Gols V', 'Status', 'Data/Hora', 'Local'];
    const rows: (string | number)[][] = [header];
    filtrados.forEach(j => {
      rows.push([
        j.fase ?? '',
        j.rodada ?? '',
        eqMap.get(j.mandanteId) ?? '?',
        eqMap.get(j.visitanteId) ?? '?',
        j.golsMandante ?? '',
        j.golsVisitante ?? '',
        j.status,
        j.dataHora ?? '',
        j.local ?? '',
      ]);
    });
    const csv = rows
      .map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jogos-${this.faseAtual?.nome?.replace(/\s+/g, '_').toLowerCase() ?? 'fase'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await this.toast('CSV exportado.', 'success');
  }

  // ─── PE (penalização) inline ────────────────────────────────
  async editarPenalizacao(eq: Equipe): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Penalização',
      message: `Pontos descontados de "${eq.nome}":`,
      inputs: [
        {
          name: 'pe',
          type: 'number',
          min: 0,
          value: (eq.penalizacao ?? 0).toString(),
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { pe: string }) => {
            const pe = Math.max(0, parseInt(data.pe, 10) || 0);
            await this.equipesSrv.atualizar(this.campeonatoId, this.categoriaId, eq.id!, {
              penalizacao: pe,
            });
          },
        },
      ],
    });
    await alert.present();
  }

  trackByGrupo(_i: number, g: ClassificacaoGrupo): string {
    return g.grupo?.id ?? 'geral';
  }

  trackByLinhaId(_i: number, l: { equipe: Equipe }): string {
    return l.equipe.id ?? '';
  }

  /** Gera um array de N elementos pra renderizar slots vazios (placeholder)
   *  da coluna "ÚLT. JOGOS" quando a equipe ainda não jogou os 5 jogos. */
  vazios(n: number): unknown[] {
    return n > 0 ? new Array(n) : [];
  }

  /**
   * Gera sigla de 3 letras a partir do nome da equipe. Usado na tabela
   * compacta do mobile no lugar do nome completo.
   *
   * Algoritmo:
   *  1. Remove conteúdo entre parênteses (ex: "(BOM DESPACHO/MG)")
   *  2. Remove acentos e caracteres não-letras
   *  3. Ignora palavras genéricas (FC, EC, CLUBE, DE, DA, etc.)
   *  4. Se sobrar 1 palavra → 3 primeiras letras dela
   *     Se sobrarem 2+ palavras → primeira letra das 3 primeiras
   *  5. Fallback: 3 primeiras letras do nome original
   *
   * Ex: "Palmeiras" → "PAL"
   *     "Atlético Mineiro" → "ATL" (palavra única significativa)
   *     "Cruz Azul Football Club" → "CAF" (3 palavras significativas)
   *     "ATALANTA - LAGOA DA PRATA/MG" → "ATA"
   */
  gerarSigla(nome: string | undefined | null): string {
    if (!nome) return '???';
    let clean = nome.replace(/\([^)]*\)/g, '');
    // Remove acentos via NFD + faixa Unicode de combining marks (̀-ͯ)
    clean = clean.normalize('NFD').replace(/[̀-ͯ]/g, '');
    clean = clean.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return '???';

    const ignorar = new Set([
      'FC', 'CF', 'EC', 'SC', 'AC', 'CD', 'CR', 'CA', 'CB', 'AA', 'AAB',
      'CLUBE', 'CLUB', 'ESPORTE', 'ESPORTES', 'SPORT', 'SPORTS', 'SPORTING',
      'ASSOCIACAO', 'ATLETICO', 'ATLETICA', 'FUTEBOL', 'TIME',
      'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'AS', 'OS',
      'MG', 'SP', 'RJ', 'RS', 'PR', 'SC', 'BA', 'CE', 'PE', 'GO', 'DF',
    ]);

    const palavras = clean.toUpperCase().split(' ').filter(p => p && !ignorar.has(p));
    if (palavras.length === 0) {
      return clean.toUpperCase().replace(/\s/g, '').substring(0, 3) || '???';
    }
    if (palavras.length === 1) {
      return palavras[0].substring(0, 3);
    }
    // 2+ palavras: pega a 1ª letra das 3 primeiras
    return palavras.slice(0, 3).map(p => p[0]).join('');
  }

  trackByJogo(_i: number, j: JogoView): string {
    return j.id ?? '';
  }

  /** Formata "2026-05-10T15:30" → "10/05/2026 15:30". Se já vier em formato BR ou inválido, devolve como está. */
  formatarDataBr(iso?: string | null): string {
    if (!iso) return '';
    return dataHoraIsoParaBr(iso) || iso;
  }

  /** Retorna a cor de destaque pra uma posição da tabela, se houver. */
  corDaPosicao(pos: number): string | null {
    const ds = this.faseAtual?.destaques;
    if (!ds || ds.length === 0) return null;
    for (const d of ds) {
      if (pos >= d.de && pos <= d.ate) return d.cor;
    }
    return null;
  }

  get destaquesAtivos(): PosicaoDestaque[] {
    return this.faseAtual?.destaques ?? [];
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'bottom',
      color,
    });
    await t.present();
  }
}
