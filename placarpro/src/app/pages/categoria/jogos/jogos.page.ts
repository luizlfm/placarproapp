import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  ModalController,
  PopoverController,
  ToastController,
} from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, map, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { FasesService } from '../../../campeonatos/fases.service';
import { Fase } from '../../../campeonatos/models/fase.model';
import { JogoModalComponent } from '../../../shared/components/jogo-modal/jogo-modal.component';
import {
  JogoAcao,
  JogoAcoesPopoverComponent,
} from '../../../shared/components/jogo-acoes-popover/jogo-acoes-popover.component';
import {
  JogosAcao,
  JogosAcoesPopoverComponent,
} from '../../../shared/components/jogos-acoes-popover/jogos-acoes-popover.component';

interface JogoView extends Jogo {
  nomeMandante: string;
  nomeVisitante: string;
  logoMandante?: string;
  logoVisitante?: string;
}

@Component({
  selector: 'app-jogos',
  templateUrl: './jogos.page.html',
  styleUrls: ['./jogos.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class JogosPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly fasesSrv = inject(FasesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly popoverCtrl = inject(PopoverController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  equipes: Equipe[] = [];
  fases: Fase[] = [];

  readonly campeonato$: Observable<Campeonato | undefined> = this.campeonatoId
    ? this.campeonatosSrv.get$(this.campeonatoId)
    : of(undefined);

  readonly categoria$: Observable<Categoria | undefined> =
    this.campeonatoId && this.categoriaId
      ? this.categoriasSrv.get$(this.campeonatoId, this.categoriaId)
      : of(undefined);

  private readonly fases$ = this.campeonatoId && this.categoriaId
    ? this.fasesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Fase[]>([]),
        catchError(() => of<Fase[]>([])),
      )
    : of<Fase[]>([]);

  /** Filtros */
  readonly filtroFase$ = new BehaviorSubject<string>('');
  readonly filtroRodada$ = new BehaviorSubject<string>('');

  readonly fasesDisponiveis$: Observable<string[]> = combineLatest([
    this.fases$,
    this.campeonatoId && this.categoriaId
      ? this.jogosSrv.list$(this.campeonatoId, this.categoriaId).pipe(
          startWith<Jogo[]>([]),
          catchError(() => of<Jogo[]>([])),
        )
      : of<Jogo[]>([]),
  ]).pipe(
    map(([fs, js]) => {
      const nomes = new Set<string>();
      fs.forEach(f => nomes.add(f.nome));
      js.forEach(j => {
        if (j.fase) nomes.add(j.fase);
      });
      return Array.from(nomes).sort();
    }),
  );

  readonly rodadasDisponiveis$: Observable<number[]> =
    this.campeonatoId && this.categoriaId
      ? combineLatest([
          this.jogosSrv.list$(this.campeonatoId, this.categoriaId).pipe(
            startWith<Jogo[]>([]),
            catchError(() => of<Jogo[]>([])),
          ),
          this.filtroFase$,
        ]).pipe(
          map(([js, fase]) => {
            const filtrados = fase ? js.filter(j => (j.fase ?? '') === fase) : js;
            return Array.from(
              new Set(
                filtrados.map(j => j.rodada).filter((r): r is number => r != null),
              ),
            ).sort((a, b) => a - b);
          }),
        )
      : of<number[]>([]);

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
          this.filtroFase$,
          this.filtroRodada$,
        ]).pipe(
          map(([js, eqs, fase, rodada]) => {
            this.equipes = eqs;
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
        )
      : of([]);

  constructor() {
    this.fases$.subscribe(fs => (this.fases = fs));
  }

  onFiltroFase(value: string): void {
    this.filtroFase$.next(value);
    this.filtroRodada$.next('');
  }
  onFiltroRodada(value: string): void {
    this.filtroRodada$.next(value);
  }

  /** Popover "+" do header — abre as 6 ações de gerenciamento. */
  async abrirPopoverJogos(ev: Event): Promise<void> {
    ev.stopPropagation();
    const pop = await this.popoverCtrl.create({
      component: JogosAcoesPopoverComponent,
      event: ev,
      showBackdrop: true,
      dismissOnSelect: false,
      cssClass: 'popover-jogos-acoes',
      // Abre EMBAIXO do botão sem seta nem cantos brancos.
      // Veja classificacao.page.ts pra explicação completa.
      side: 'bottom',
      alignment: 'end',
      arrow: false,
    });
    await pop.present();
    const { data } = await pop.onDidDismiss<{ acao?: JogosAcao }>();
    if (!data?.acao) return;
    await this.executarAcaoJogos(data.acao);
  }

  private async executarAcaoJogos(acao: JogosAcao): Promise<void> {
    // Por simplicidade, todas as ações redirecionam pra Classificação,
    // onde os modais ficam declarados.
    if (acao === 'add-partida') {
      await this.novoJogo();
      return;
    }
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'classificacao',
    ]);
  }

  async novoJogo(): Promise<void> {
    if (this.equipes.length < 2) {
      const t = await this.toastCtrl.create({
        message: 'Cadastre pelo menos 2 equipes antes de criar um jogo.',
        duration: 2800,
        position: 'top',
        color: 'warning',
      });
      await t.present();
      return;
    }
    const modal = await this.modalCtrl.create({
      component: JogoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipes: this.equipes,
        faseDefault: this.filtroFase$.value || this.fases[0]?.nome,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  async abrirAcoes(ev: Event, jogo: JogoView): Promise<void> {
    ev.stopPropagation();
    const pop = await this.popoverCtrl.create({
      component: JogoAcoesPopoverComponent,
      event: ev,
      showBackdrop: true,
      dismissOnSelect: false,
      cssClass: 'popover-jogo-acoes',
    });
    await pop.present();
    const { data } = await pop.onDidDismiss<{ acao?: JogoAcao }>();
    if (!data?.acao) return;
    await this.executarAcaoJogo(data.acao, jogo);
  }

  private async executarAcaoJogo(acao: JogoAcao, jogo: JogoView): Promise<void> {
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
        this.router.navigate(baseRoute);
        return;
      case 'equipes':
      case 'resultado':
      case 'informacoes': {
        const equipes = await firstValueFrom(
          this.equipesSrv.list$(this.campeonatoId, this.categoriaId),
        );
        const modal = await this.modalCtrl.create({
          component: JogoModalComponent,
          componentProps: {
            campeonatoId: this.campeonatoId,
            categoriaId: this.categoriaId,
            equipes,
            jogoExistente: jogo,
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
        await this.removerJogo(jogo);
        return;
    }
  }

  private async restaurarJogo(j: JogoView): Promise<void> {
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

  private async removerJogo(j: JogoView): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover partida?',
      message: `${j.nomeMandante} × ${j.nomeVisitante} será removido.`,
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

  irParaDetalhe(jogo: JogoView): void {
    if (!jogo.id) return;
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      jogo.id,
    ]);
  }

  /**
   * Clique direto no escudo (mandante ou visitante) abre alert com lista
   * de equipes para atribuir aquele lado sem passar pela tela de detalhe.
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
    const atualId = lado === 'mandante' ? jogo.mandanteId : jogo.visitanteId;
    const adversarioId = lado === 'mandante' ? jogo.visitanteId : jogo.mandanteId;

    const inputs = [
      {
        name: 'eq',
        type: 'radio' as const,
        label: '— Sem equipe (placeholder) —',
        value: '',
        checked: !atualId,
      },
      ...equipes.map(e => ({
        name: 'eq',
        type: 'radio' as const,
        label: e.nome + (e.id === adversarioId ? '  (já é o adversário)' : ''),
        value: e.id!,
        checked: atualId === e.id,
        disabled: e.id === adversarioId,
      })),
    ];

    const alert = await this.alertCtrl.create({
      header: lado === 'mandante' ? 'Selecionar mandante' : 'Selecionar visitante',
      cssClass: 'alert-tall',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Aplicar',
          handler: async (novoId: string) => {
            const patch =
              lado === 'mandante'
                ? { mandanteId: novoId ?? '' }
                : { visitanteId: novoId ?? '' };
            try {
              await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, jogoId, patch);
              await this.toast('Equipe atualizada.', 'success');
            } catch (err) {
              console.error('[Jogos] selecionar equipe erro', err);
              await this.toast('Erro ao atualizar.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
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

  /** Formata `dataHora` (ISO ou "YYYY-MM-DD HH:mm") em formato amigável
   *  "DD/MM · HH:MM". Retorna a string original se não conseguir parsear. */
  formatarDataHora(s: string | null | undefined): string {
    if (!s) return '';
    // Aceita "2026-05-21T15:42" ou "2026-05-21 15:42" ou Date.toISOString()
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
    if (!m) return s;
    const [, , mes, dia, hh, mm] = m;
    return `${dia}/${mes} · ${hh}:${mm}`;
  }

  /** Conta jogos por status (pra badges no header). */
  contarPorStatus(lista: JogoView[] | null, status: string): number {
    if (!lista) return 0;
    return lista.filter(j => j.status === status).length;
  }

  trackById(_i: number, j: Jogo): string {
    return j.id ?? '';
  }

  /** Abre a página de impressão da tabela de partidas. */
  abrirImprimir(): void {
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogos',
      'imprimir',
    ]);
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
      color,
    });
    await t.present();
  }
}
