import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, interval, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { RachaService } from '../../../racha.service';
import { RachaJogador } from '../../../models/racha.model';

/**
 * Página AO VIVO — replica o print do FutBora:
 *  - Card "Minhas estatísticas no evento"
 *  - Card "Aguardando o início de uma nova partida"
 *  - Card "Sorteio dos Times"
 *  - Card "Ranking" (tabela vazia até ter partidas)
 *  - Card "Partidas"
 *
 * Dados reais (placar, jogos rolando) virão de subcoleção
 * `rachas/{id}/sessoes/{ativa}/jogos`. Por enquanto exibe o estado
 * "aguardando" — exatamente como o print.
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

  /** Countdown da "prévia ao vivo" — cosmético. */
  segundos = 20;

  private sub?: Subscription;
  private tick?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.sub = this.rachaSrv.listJogadores$(this.rachaId).pipe(
      startWith([] as RachaJogador[]),
      catchError(() => of([] as RachaJogador[])),
    ).subscribe(arr => {
      this.jogadores = arr.filter(j => j.ativo !== false);
      this.loading = false;
    });

    this.tick = interval(1000).subscribe(() => {
      this.segundos = this.segundos > 0 ? this.segundos - 1 : 30;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.tick?.unsubscribe();
  }

  vincularAoTime(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }

  irSorteio(): void {
    this.router.navigate(['/racha', this.rachaId, 'sortear']);
  }

  /** Top 10 jogadores ordenados por nota geral — usado na tabela placeholder. */
  get topJogadores(): RachaJogador[] {
    return [...this.jogadores]
      .sort((a, b) => (b.notaGeral ?? 0) - (a.notaGeral ?? 0))
      .slice(0, 10);
  }

  trackByJogador(_i: number, j: RachaJogador): string {
    return j.id ?? '';
  }
  /** Volta pra tela anterior usando histórico do browser; fallback pra
   *  home do racha quando entrou direto via URL. */
  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}