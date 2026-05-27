import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ActionModalService } from '../../../../shared/components/action-modal/action-modal.service';
import { Observable, Subscription, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, shareReplay, startWith } from 'rxjs/operators';
import { Timestamp } from '@angular/fire/firestore';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import { EventoJogo, EventoTipo, Jogo, JogoStatus } from '../../../../campeonatos/models/jogo.model';
import { EventoModalComponent } from '../evento-modal/evento-modal.component';
import { NavBackService } from '../../../../shared/nav-back.service';

interface JogoView extends Jogo {
  nomeMandante: string;
  nomeVisitante: string;
  logoMandante?: string;
  logoVisitante?: string;
}

interface EventoView extends EventoJogo {
  jogadorNome?: string;
}

interface PainelTipo {
  tipo: EventoTipo | 'lances';
  label: string;
}

const PAINEIS: PainelTipo[] = [
  { tipo: 'gol', label: 'GOLS' },
  { tipo: 'amarelo', label: 'CARTÃO AMARELO' },
  { tipo: 'vermelho', label: 'CARTÃO VERMELHO' },
  { tipo: 'azul', label: 'CARTÃO AZUL' },
  { tipo: 'falta', label: 'FALTAS' },
  { tipo: 'sub-entrou', label: 'SUBSTITUIÇÕES' },
  { tipo: 'gol-contra', label: 'GOLS CONTRA' },
  { tipo: 'defesa', label: 'DEFESAS' },
  { tipo: 'lances', label: 'LANCES DA PARTIDA' },
];

const STATUS_LABEL: Record<JogoStatus, string> = {
  'agendado': 'NÃO REALIZADO',
  'em-andamento': 'EM ANDAMENTO',
  'encerrado': 'ENCERRADO',
  'cancelado': 'CANCELADO',
  'wo': 'W.O.',
};

@Component({
  selector: 'app-editor-partida',
  templateUrl: './editor-partida.page.html',
  styleUrls: ['./editor-partida.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class EditorPartidaPage implements OnInit, OnDestroy {
  /** Subscription do jogo$ pra reagir a mudanças de status/iniciadoEm. */
  private subCrono?: Subscription;

  ngOnDestroy(): void {
    this.pararCronometro();
    this.subCrono?.unsubscribe();
  }
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionCtrl = inject(ActionModalService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly navBack = inject(NavBackService);

  // Sobe a cadeia de rotas (route → parent → parent.parent → ...) até
  // achar o param. Necessário porque com lazy modules o paramMap pode
  // estar definido no shell (grandparent), não no route direto.
  private readParam(name: string): string {
    let cursor: import('@angular/router').ActivatedRoute | null = this.route;
    while (cursor) {
      const v = cursor.snapshot.paramMap.get(name);
      if (v) return v;
      cursor = cursor.parent;
    }
    return '';
  }

  readonly campeonatoId = this.readParam('id');
  readonly categoriaId = this.readParam('catId');
  readonly jogoId = this.readParam('jogoId');

  readonly paineis = PAINEIS;
  readonly statusOpcoes: JogoStatus[] = ['agendado', 'em-andamento', 'encerrado', 'cancelado', 'wo'];
  readonly STATUS_LABEL = STATUS_LABEL;

  /** Index do painel atual (compartilhado entre os 2 times). */
  painelIdx = 0;

  /** Mensagem de erro exibida quando o jogo$ falha em carregar. */
  erroCarregamento = '';

  private readonly equipes$ = this.campeonatoId && this.categoriaId
    ? this.equipesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Equipe[]>([]),
        catchError(() => of<Equipe[]>([])),
        shareReplay({ bufferSize: 1, refCount: true }),
      )
    : of<Equipe[]>([]);

  private readonly jogadores$ = this.campeonatoId && this.categoriaId
    ? this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Jogador[]>([]),
        catchError(() => of<Jogador[]>([])),
        shareReplay({ bufferSize: 1, refCount: true }),
      )
    : of<Jogador[]>([]);

  /** Marca se já houve pelo menos uma emissão do jogo$ (pra diferenciar
   *  "ainda carregando" de "doc não existe"). Público para o template
   *  poder exibir no painel de diagnóstico. */
  jogoEmitiu = false;

  readonly jogo$: Observable<JogoView | undefined> = this.jogoId
    ? combineLatest([
        this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogoId).pipe(
          catchError(err => {
            console.error('[EditorPartida] get$ erro', err);
            return of(undefined);
          }),
        ),
        this.equipes$,
      ]).pipe(
        map(([j, eqs]) => {
          // Marca que houve emissão — usado pra distinguir "carregando" de "doc não existe".
          this.jogoEmitiu = true;
          if (!j) {
            if (!this.erroCarregamento) {
              this.erroCarregamento = 'Partida não encontrada (ID inválido ou removido).';
            }
            return undefined;
          }
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
        shareReplay({ bufferSize: 1, refCount: true }),
      )
    : of(undefined);

  readonly eventos$: Observable<EventoView[]> = this.jogoId
    ? combineLatest([
        this.jogosSrv.listEventos$(this.campeonatoId, this.categoriaId, this.jogoId).pipe(
          startWith<EventoJogo[]>([]),
          catchError(() => of<EventoJogo[]>([])),
        ),
        this.jogadores$,
      ]).pipe(
        map(([evs, jogadores]) =>
          evs.map(e => ({
            ...e,
            jogadorNome: e.jogadorId ? jogadores.find(j => j.id === e.jogadorId)?.nome : undefined,
          })),
        ),
        shareReplay({ bufferSize: 1, refCount: true }),
      )
    : of([] as EventoView[]);

  /** Mapa de eventos pré-computado: { mandanteId: { gol: [...], amarelo: [...] }, ... }
   *  CRIADO UMA ÚNICA VEZ. O template lê dele via getter, sem criar observable novo
   *  a cada CD. Antes a função eventosDaEquipe$ era chamada no template e criava
   *  observable novo a cada change detection — gerava loop infinito de subscriptions. */
  readonly mapaEventos$: Observable<Record<string, Partial<Record<EventoTipo | 'lances', EventoView[]>>>> =
    combineLatest([this.eventos$, this.jogo$]).pipe(
      map(([evs, jogo]) => {
        const mapa: Record<string, Partial<Record<EventoTipo | 'lances', EventoView[]>>> = {};
        if (!jogo) return mapa;
        const equipeIds = [jogo.mandanteId, jogo.visitanteId];
        for (const eqId of equipeIds) {
          const meus = evs.filter(e => e.equipeId === eqId);
          const subEntrouOuSaiu = meus.filter(
            e => e.tipo === 'sub-entrou' || e.tipo === 'sub-saiu',
          );
          mapa[eqId] = {
            gol: meus.filter(e => e.tipo === 'gol'),
            amarelo: meus.filter(e => e.tipo === 'amarelo'),
            vermelho: meus.filter(e => e.tipo === 'vermelho'),
            azul: meus.filter(e => e.tipo === 'azul'),
            falta: meus.filter(e => e.tipo === 'falta'),
            'sub-entrou': subEntrouOuSaiu,
            'gol-contra': meus.filter(e => e.tipo === 'gol-contra'),
            defesa: meus.filter(e => e.tipo === 'defesa'),
            lances: meus,
          };
        }
        return mapa;
      }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

  ngOnInit(): void {
    console.log('[EditorPartida] init', {
      url: this.router.url,
      campeonatoId: this.campeonatoId,
      categoriaId: this.categoriaId,
      jogoId: this.jogoId,
      paramsAtuais: this.route.snapshot.params,
      paramsParent: this.route.parent?.snapshot.params,
    });

    // Validação dos params — sem isso o jogo$ fica em loop infinito.
    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) {
      console.error('[EditorPartida] params ausentes');
      this.erroCarregamento =
        'Parâmetros da rota ausentes. Volte e tente novamente.';
      this.cdr.markForCheck();
      return;
    }

    // Timeout de segurança: se em 2s o jogo$ ainda não emitiu, mostra erro
    // com painel de diagnóstico (IDs lidos, etc.) direto na tela.
    setTimeout(() => {
      if (!this.jogoEmitiu && !this.erroCarregamento) {
        console.warn('[EditorPartida] timeout 2s sem resposta do Firestore');
        this.erroCarregamento =
          'Sem resposta do Firestore. Veja o diagnóstico abaixo.';
        this.cdr.markForCheck();
      }
    }, 2000);

    // ============ Cronômetro reativo ============
    // Observa o jogo: se status=em-andamento E tem iniciadoEm → liga timer
    // que atualiza `tempoDecorridoSeg` a cada segundo. Encerrado → para.
    this.subCrono = this.jogo$.subscribe(j => {
      if (j?.status === 'em-andamento' && j.iniciadoEm) {
        this.iniciarCronometro(j.iniciadoEm);
      } else if (j?.status === 'encerrado' && j.iniciadoEm && j.encerradoEm) {
        // Mostra tempo final fixo
        const dur = Math.floor(
          (j.encerradoEm.toDate().getTime() - j.iniciadoEm.toDate().getTime()) / 1000,
        );
        this.pararCronometro();
        this.tempoDecorridoSeg = Math.max(0, dur);
      } else {
        this.pararCronometro();
        this.tempoDecorridoSeg = 0;
      }
    });
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      this.jogoId,
    ]);
  }

  proxPainel(): void {
    this.painelIdx = (this.painelIdx + 1) % this.paineis.length;
  }
  antPainel(): void {
    this.painelIdx = (this.painelIdx - 1 + this.paineis.length) % this.paineis.length;
  }
  irPainel(idx: number): void {
    this.painelIdx = idx;
  }

  async trocarStatus(): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const sheet = await this.actionCtrl.create({
      header: 'Status da partida',
      buttons: [
        ...this.statusOpcoes.map(s => ({
          text: STATUS_LABEL[s],
          handler: () => {
            void this.salvarStatus(s);
          },
        })),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Atalho: muda direto para "em-andamento" sem abrir o action sheet.
   *  Grava `iniciadoEm = serverTimestamp()` pra ligar o cronômetro reativo. */
  async iniciarPartida(): Promise<void> {
    await this.salvarStatus('em-andamento', { gravarInicio: true });
  }

  /** Pausa cronômetro mantendo o "iniciadoEm" — só muda status. Útil pra
   *  intervalo entre tempos. */
  async pausarPartida(): Promise<void> {
    await this.salvarStatus('agendado'); // ou criar status 'pausado' depois
  }

  /** Encerra a partida e grava `encerradoEm` pra travar o cronômetro. */
  async encerrarPartida(): Promise<void> {
    await this.salvarStatus('encerrado', { gravarFim: true });
  }

  private async salvarStatus(
    status: JogoStatus,
    opts: { gravarInicio?: boolean; gravarFim?: boolean } = {},
  ): Promise<void> {
    try {
      const patch: Partial<Jogo> = { status };
      if (opts.gravarInicio) {
        // serverTimestamp não está disponível direto aqui — usa Date.now()
        // como aproximação. O service vai converter pra Timestamp interno.
        patch.iniciadoEm = Timestamp.fromDate(new Date());
      }
      if (opts.gravarFim) {
        patch.encerradoEm = Timestamp.fromDate(new Date());
      }
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogoId, patch);
    } catch (err) {
      console.error('[EditorPartida] status erro', err);
    }
  }

  // ============ Cronômetro reativo ============

  /** Tempo decorrido em segundos (atualizado por setInterval). */
  tempoDecorridoSeg = 0;
  /** Timer interno do setInterval. */
  private cronoTimer?: number;

  /** Inicia o setInterval que atualiza o cronômetro a cada segundo.
   *  Chamado quando a stream do jogo emite e status = em-andamento. */
  private iniciarCronometro(iniciadoEm: Timestamp): void {
    this.pararCronometro();
    const tickar = () => {
      const inicio = iniciadoEm.toDate().getTime();
      this.tempoDecorridoSeg = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
    };
    tickar();
    this.cronoTimer = window.setInterval(tickar, 1000);
  }

  private pararCronometro(): void {
    if (this.cronoTimer) {
      window.clearInterval(this.cronoTimer);
      this.cronoTimer = undefined;
    }
  }

  /** Formata segundos como MM:SS. */
  formatarCrono(seg: number): string {
    if (seg < 0) return '00:00';
    const m = Math.floor(seg / 60);
    const s = seg % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** Retorna o minuto atual do jogo (arredondado pra cima). Usado pra
   *  pré-preencher o campo "minuto" do modal de eventos. */
  get minutoAtual(): number | null {
    if (this.tempoDecorridoSeg <= 0) return null;
    return Math.max(1, Math.ceil(this.tempoDecorridoSeg / 60));
  }

  async adicionarEvento(lado: 'mandante' | 'visitante'): Promise<void> {
    const painel = this.paineis[this.painelIdx];
    const tipoPadrao: EventoTipo = painel.tipo === 'lances' ? 'gol' : (painel.tipo as EventoTipo);
    return this.adicionarEventoEm(lado, tipoPadrao);
  }

  /** Versão que abre o modal já com o tipo pré-selecionado do card clicado. */
  async adicionarEventoEm(
    lado: 'mandante' | 'visitante',
    tipo: EventoTipo | 'lances',
  ): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const tipoPadrao: EventoTipo = tipo === 'lances' ? 'gol' : (tipo as EventoTipo);
    const modal = await this.modalCtrl.create({
      component: EventoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogoId: jogo.id,
        mandante: { id: jogo.mandanteId, nome: jogo.nomeMandante },
        visitante: { id: jogo.visitanteId, nome: jogo.nomeVisitante },
        ladoPadrao: lado,
        tipoPadrao,
        /** Pré-preenche o minuto com o tempo atual do cronômetro
         *  (quando o jogo está em andamento). UX matador — admin não
         *  precisa digitar o minuto manualmente, já vem certo. */
        minutoSugerido: this.minutoAtual,
      },
      cssClass: 'modal-evento',
      backdropDismiss: true,
    });
    await modal.present();
  }

  async editarEvento(e: EventoView): Promise<void> {
    const jogo = await firstValueFrom(this.jogo$);
    if (!jogo?.id) return;
    const modal = await this.modalCtrl.create({
      component: EventoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogoId: jogo.id,
        mandante: { id: jogo.mandanteId, nome: jogo.nomeMandante },
        visitante: { id: jogo.visitanteId, nome: jogo.nomeVisitante },
        eventoExistente: e,
      },
      cssClass: 'modal-evento',
      backdropDismiss: true,
    });
    await modal.present();
  }

  async abrirMenu(): Promise<void> {
    const sheet = await this.actionCtrl.create({
      header: 'Ações da partida',
      buttons: [
        {
          text: 'Editar informações',
          icon: 'create-outline',
          handler: () => {
            this.router.navigate(
              [
                '/app/campeonato',
                this.campeonatoId,
                'categoria',
                this.categoriaId,
                'jogo',
                this.jogoId,
              ],
              { queryParams: { action: 'info' } },
            );
          },
        },
        {
          text: 'Voltar para detalhe',
          icon: 'reader-outline',
          handler: () => this.voltar(),
        },
        {
          text: 'Restaurar partida',
          icon: 'refresh-outline',
          role: 'destructive',
          handler: () => {
            void this.restaurar();
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async restaurar(): Promise<void> {
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogoId, {
        status: 'agendado',
        golsMandante: null,
        golsVisitante: null,
      });
      const t = await this.toastCtrl.create({
        message: 'Partida restaurada.',
        duration: 2000,
        position: 'top',
        color: 'success',
      });
      await t.present();
    } catch {
      const t = await this.toastCtrl.create({
        message: 'Erro ao restaurar.',
        duration: 2000,
        position: 'top',
        color: 'danger',
      });
      await t.present();
    }
  }

  trackByEvento(_i: number, e: EventoView): string {
    return e.id ?? '';
  }

  nomeEvento(e: EventoView): string {
    return e.jogadorNome ?? '—';
  }
}
