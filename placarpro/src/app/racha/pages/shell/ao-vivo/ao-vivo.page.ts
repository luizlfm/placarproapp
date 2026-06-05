import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, combineLatest, of } from 'rxjs';
import { catchError, switchMap, map } from 'rxjs/operators';
import { RachaService } from '../../../racha.service';
import { RachaEvento, RachaJogador, RachaPartida } from '../../../models/racha.model';

/** Evento pronto pra exibição no feed ao vivo. */
interface EventoView {
  tipo: string;
  label: string;
  icone: string;
  cor: string;
  nome: string;
  assist?: string;
  lado: 'A' | 'B' | '';
  minuto?: number;
}

/**
 * Página AO VIVO — mostra a partida EM ANDAMENTO (status `rascunho`) do
 * racha com placar e feed de eventos em tempo real (via Firestore stream),
 * além das últimas partidas finalizadas. Quando não há partida em
 * andamento, exibe o estado "aguardando" com atalho pro sorteio.
 */
@Component({
  selector: 'app-racha-ao-vivo',
  templateUrl: './ao-vivo.page.html',
  styleUrls: ['./ao-vivo.page.scss'],
  standalone: false,
})
export class RachaAoVivoPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly navBack = inject(NavBackService);

  rachaId = '';
  loading = true;
  jogadores: RachaJogador[] = [];

  /** Partida em andamento (rascunho) — null se nenhuma. */
  live: RachaPartida | null = null;
  /** Eventos da partida ao vivo (ordenados). */
  liveEventos: EventoView[] = [];
  /** Últimas partidas finalizadas. */
  recentes: RachaPartida[] = [];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }

    this.sub = combineLatest([
      this.rachaSrv.listPartidas$(this.rachaId),
      this.rachaSrv.listJogadores$(this.rachaId),
    ]).pipe(
      switchMap(([partidas, jogadores]) => {
        const live = partidas.find(p => p.status !== 'finalizada') ?? null;
        const eventos$ = live?.id
          ? this.rachaSrv.listEventos$(this.rachaId, live.id)
          : of([] as RachaEvento[]);
        return eventos$.pipe(map(eventos => ({ partidas, jogadores, live, eventos })));
      }),
      catchError(err => {
        console.error('[AoVivo] stream', err);
        return of({ partidas: [] as RachaPartida[], jogadores: [] as RachaJogador[], live: null, eventos: [] as RachaEvento[] });
      }),
    ).subscribe(({ partidas, jogadores, live, eventos }) => {
      this.jogadores = jogadores.filter(j => j.ativo !== false);
      this.live = live;
      this.recentes = partidas.filter(p => p.status === 'finalizada').slice(0, 6);

      const nome = new Map<string, string>();
      for (const j of jogadores) if (j.id) nome.set(j.id, j.apelido || j.nome);

      this.liveEventos = [...eventos]
        .sort((a, b) => this.tsEvento(a) - this.tsEvento(b))
        .map(ev => this.eventoView(ev, live, nome));

      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private tsEvento(ev: RachaEvento): number {
    const ms = (ev.criadoEm as { toMillis?: () => number } | undefined)?.toMillis?.();
    return ms ?? (ev.minuto ?? 0) * 60000;
  }

  private eventoView(ev: RachaEvento, live: RachaPartida | null, nome: Map<string, string>): EventoView {
    const meta: Record<string, { label: string; icone: string; cor: string }> = {
      gol:         { label: 'Gol',             icone: 'football',            cor: '#16a34a' },
      penalti:     { label: 'Gol de pênalti',  icone: 'football-outline',    cor: '#16a34a' },
      assistencia: { label: 'Assistência',     icone: 'hand-right-outline',  cor: '#0ea5e9' },
      amarelo:     { label: 'Cartão amarelo',  icone: 'square',              cor: '#f5c518' },
      vermelho:    { label: 'Cartão vermelho', icone: 'square',              cor: '#e55353' },
      azul:        { label: 'Cartão azul',     icone: 'square',              cor: '#4dabf7' },
    };
    const m = meta[ev.tipo] ?? { label: ev.tipo, icone: 'ellipse', cor: '#9ca3af' };
    let lado: 'A' | 'B' | '' = '';
    if (live && ev.timeId) {
      if (ev.timeId === live.timeAId) lado = 'A';
      else if (ev.timeId === live.timeBId) lado = 'B';
    }
    return {
      tipo: ev.tipo,
      label: m.label,
      icone: m.icone,
      cor: m.cor,
      nome: (ev.jogadorId && nome.get(ev.jogadorId)) || 'Jogador',
      assist: ev.assistJogadorId ? nome.get(ev.assistJogadorId) : undefined,
      lado,
      minuto: ev.minuto,
    };
  }

  get temLive(): boolean {
    return !!this.live;
  }

  // ============== Navegação ==============

  vincularAoTime(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }
  irSorteio(): void {
    this.router.navigate(['/racha', this.rachaId, 'sortear']);
  }
  irPartidas(): void {
    this.router.navigate(['/racha', this.rachaId, 'partidas']);
  }

  /** Top 10 jogadores ordenados por nota geral — tabela de referência. */
  get topJogadores(): RachaJogador[] {
    return [...this.jogadores]
      .sort((a, b) => (b.notaGeral ?? 0) - (a.notaGeral ?? 0))
      .slice(0, 10);
  }

  trackByJogador(_i: number, j: RachaJogador): string {
    return j.id ?? '';
  }
  trackByEvento(i: number): number {
    return i;
  }
  trackByPartida(_i: number, p: RachaPartida): string {
    return p.id ?? '';
  }

  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}
