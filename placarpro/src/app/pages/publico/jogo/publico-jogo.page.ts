import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
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
import { NavBackService } from '../../../shared/nav-back.service';
import { RefreshService } from '../../../shared/refresh.service';

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
  selector: 'app-publico-jogo',
  templateUrl: './publico-jogo.page.html',
  styleUrls: ['./publico-jogo.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PublicoJogoPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campSrv = inject(CampeonatosService);
  private readonly catSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly navBack = inject(NavBackService);
  private readonly refreshSrv = inject(RefreshService);

  campeonato?: Campeonato;
  categoria?: Categoria;
  slug = '';
  catId = '';
  jogoId = '';
  loading = true;
  erro = false;

  /** Viewport mobile? Sincronizado via matchMedia. */
  ehMobile = false;

  /** Retorna a capa apropriada — fallback no `bannerUrl` legacy. */
  capaCamp(c: Campeonato | null | undefined): string | null {
    if (!c) return null;
    if (this.ehMobile && c.capaMobileUrl) return c.capaMobileUrl;
    return c.capaUrl ?? c.bannerUrl ?? null;
  }

  jogo$: Observable<JogoView | undefined> = of(undefined);
  eventos$: Observable<EventoView[]> = of([]);
  escalacaoMandante$: Observable<JogadorEscalado[]> = of([]);
  escalacaoVisitante$: Observable<JogadorEscalado[]> = of([]);

  async ngOnInit(): Promise<void> {
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(max-width: 767px)');
      this.ehMobile = mql.matches;
      mql.addEventListener('change', ev => { this.ehMobile = ev.matches; });
    }
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.catId = this.route.snapshot.paramMap.get('catId') ?? '';
    this.jogoId = this.route.snapshot.paramMap.get('jogoId') ?? '';
    if (!this.slug || !this.catId || !this.jogoId) {
      this.erro = true;
      this.loading = false;
      return;
    }
    try {
      let c = await this.campSrv.getBySlug(this.slug);
      if (!c) {
        c = await new Promise<Campeonato | undefined>(resolve => {
          const sub = this.campSrv.get$(this.slug).subscribe(d => {
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
        const sub = this.catSrv.get$(c!.id!, this.catId).subscribe(d => {
          resolve(d);
          setTimeout(() => sub.unsubscribe(), 0);
        });
      });
      if (!this.categoria) {
        this.erro = true;
        return;
      }
      this.setupStreams(c.id!, this.catId, this.jogoId);
    } catch (err) {
      console.error('[PublicoJogo] erro', err);
      this.erro = true;
    } finally {
      this.loading = false;
    }
  }

  private setupStreams(campId: string, catId: string, jogoId: string): void {
    const safe = <T>(o$: Observable<T>, fb: T) =>
      o$.pipe(startWith(fb), catchError(() => of(fb)));

    const equipes$ = safe(this.equipesSrv.list$(campId, catId), [] as Equipe[]);
    const jogadores$ = safe(this.jogadoresSrv.list$(campId, catId), [] as Jogador[]);

    this.jogo$ = combineLatest([
      this.jogosSrv.get$(campId, catId, jogoId),
      equipes$,
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
        } as JogoView;
      }),
      catchError(() => of(undefined)),
    );

    this.eventos$ = combineLatest([
      safe(this.jogosSrv.listEventos$(campId, catId, jogoId), [] as EventoJogo[]),
      this.jogo$,
      equipes$,
      jogadores$,
    ]).pipe(
      map(([evs, jogo, eqs, js]) => {
        if (!jogo) return [] as EventoView[];
        return evs.map(e => {
          const eq = eqs.find(x => x.id === e.equipeId);
          const jg = e.jogadorId ? js.find(j => j.id === e.jogadorId) : undefined;
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

    this.escalacaoMandante$ = this.jogo$.pipe(
      switchMap(j => {
        if (!j?.id) return of<JogadorEscalado[]>([]);
        return combineLatest([
          safe(this.jogosSrv.escalacao$(campId, catId, j.id, j.mandanteId), [] as string[]),
          jogadores$,
          this.eventos$,
        ]).pipe(map(([ids, jgs, evs]) => this.montarEscalados(ids, jgs, evs, j.mandanteId)));
      }),
    );

    this.escalacaoVisitante$ = this.jogo$.pipe(
      switchMap(j => {
        if (!j?.id) return of<JogadorEscalado[]>([]);
        return combineLatest([
          safe(this.jogosSrv.escalacao$(campId, catId, j.id, j.visitanteId), [] as string[]),
          jogadores$,
          this.eventos$,
        ]).pipe(map(([ids, jgs, evs]) => this.montarEscalados(ids, jgs, evs, j.visitanteId)));
      }),
    );
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

  /** Pull-to-refresh — recarrega APENAS esta rota via Angular Router. */
  async onRefresh(ev: CustomEvent): Promise<void> {
    await this.refreshSrv.refreshAtual(ev);
  }

  voltar(): void {
    this.navBack.back(['/', this.slug, 'categoria', this.catId]);
  }

  rotuloStatus(s?: string): string {
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
      // TypeScript strict mode exige return em todos os caminhos. Como
      // `EventoTipo` é union de literais conhecidos o switch acima cobre
      // todos os casos válidos, mas o compilador não infere exaustividade.
      // Fallback defensivo evita o erro TS2366.
      default: return String(t).toUpperCase();
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

  trackByEvento(_i: number, e: EventoView): string {
    return e.id ?? '';
  }

  trackByEscalado(_i: number, e: JogadorEscalado): string {
    return e.jogador.id ?? '';
  }
}
