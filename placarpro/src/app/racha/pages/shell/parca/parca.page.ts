import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { RachaService } from '../../../racha.service';
import { RachaEvento, RachaJogador } from '../../../models/racha.model';
import {
  computarDuplasGol,
  computarCompanheiros,
} from '../../../stats-jogador.helper';

/** Dupla pronta pra exibição (nomes resolvidos). */
interface DuplaView {
  aNome: string;
  bNome: string;
  aFoto?: string;
  bFoto?: string;
  valor: number;
}

/**
 * Página PARÇA DO RACHA — descobre as duplas do racha a partir dos
 * eventos das partidas:
 *  - Duplas de gol (quem mais combinou gol + assistência)
 *  - Companheiros de time (quem mais jogou junto no mesmo time)
 */
@Component({
  selector: 'app-racha-parca',
  templateUrl: './parca.page.html',
  styleUrls: ['./parca.page.scss'],
  standalone: false,
})
export class RachaParcaPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);

  rachaId = '';
  loading = true;

  duplasGol: DuplaView[] = [];
  companheiros: DuplaView[] = [];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }

    this.sub = combineLatest([
      this.rachaSrv.listJogadores$(this.rachaId),
      this.rachaSrv.listEventosDoRacha$(this.rachaId),
    ]).pipe(
      catchError(err => {
        console.error('[Parca] stream', err);
        return of([[], []] as [RachaJogador[], RachaEvento[]]);
      }),
    ).subscribe(([jogadores, eventos]) => {
      const nome = new Map<string, RachaJogador>();
      for (const j of jogadores) if (j.id) nome.set(j.id, j);
      const resolver = (id: string): RachaJogador | undefined => nome.get(id);

      this.duplasGol = computarDuplasGol(eventos)
        .slice(0, 8)
        .map(d => this.toView(resolver(d.aId), resolver(d.bId), d.gols))
        .filter((d): d is DuplaView => d !== null);

      this.companheiros = computarCompanheiros(eventos)
        .slice(0, 8)
        .map(d => this.toView(resolver(d.aId), resolver(d.bId), d.partidas))
        .filter((d): d is DuplaView => d !== null);

      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get temDados(): boolean {
    return this.duplasGol.length > 0 || this.companheiros.length > 0;
  }

  private toView(a: RachaJogador | undefined, b: RachaJogador | undefined, valor: number): DuplaView | null {
    if (!a || !b) return null;
    return {
      aNome: a.apelido || a.nome,
      bNome: b.apelido || b.nome,
      aFoto: a.fotoUrl,
      bFoto: b.fotoUrl,
      valor,
    };
  }

  iniciais(nome: string): string {
    return (nome || '?').trim().charAt(0).toUpperCase();
  }

  trackByDupla(_i: number, d: DuplaView): string {
    return d.aNome + '|' + d.bNome;
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  irJogadores(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }

  irPartidas(): void {
    this.router.navigate(['/racha', this.rachaId, 'partidas']);
  }
}
