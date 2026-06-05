import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { RachaService } from '../../../racha.service';
import { computarStatsJogador } from '../../../stats-jogador.helper';

type Categoria = 'gols' | 'assist' | 'jogos' | 'pg';

interface RankItem {
  jogadorId: string;
  nome: string;
  rachaNome: string;
  foto?: string;
  gols: number;
  assist: number;
  jogos: number;
  /** Participações em gols (gols + assistências). */
  pg: number;
}

/**
 * Página RANKING MUNDIAL — leaderboard que cruza TODOS os rachas do
 * organizador (cross-racha). Agrega gols, assistências, jogos e
 * participações em gols por jogador, em cima dos eventos das partidas.
 *
 * Obs.: ranking verdadeiramente global (entre todos os usuários) exigiria
 * agregação no servidor (Cloud Function) por privacidade/escala — aqui
 * consolidamos os rachas do próprio usuário, que é seguro e imediato.
 */
@Component({
  selector: 'app-racha-ranking-mundial',
  templateUrl: './ranking-mundial.page.html',
  styleUrls: ['./ranking-mundial.page.scss'],
  standalone: false,
})
export class RachaRankingMundialPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);

  rachaId = '';
  loading = true;
  categoria: Categoria = 'gols';

  /** Quantos rachas entraram na conta (pra exibir contexto). */
  totalRachas = 0;

  private itens: RankItem[] = [];
  private sub?: Subscription;

  readonly categorias: Array<{ id: Categoria; label: string; icon: string; cor: string; unidade: string }> = [
    { id: 'gols',   label: 'Artilheiros',   icon: 'football',          cor: '#f59e0b', unidade: 'gols' },
    { id: 'assist', label: 'Garçons',       icon: 'hand-right',        cor: '#16a34a', unidade: 'assist.' },
    { id: 'pg',     label: 'Craques',       icon: 'star',              cor: '#7c3aed', unidade: 'G+A' },
    { id: 'jogos',  label: 'Presença',      icon: 'calendar',          cor: '#3b82f6', unidade: 'jogos' },
  ];

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }

    this.sub = this.rachaSrv.listAgregadoMeusRachas$().pipe(
      catchError(err => {
        console.error('[RankingMundial] stream', err);
        return of([] as Array<{ racha: { id?: string; nome: string }; jogadores: { id?: string; nome: string; apelido?: string; fotoUrl?: string }[]; eventos: import('../../../models/racha.model').RachaEvento[] }>);
      }),
    ).subscribe(rachas => {
      this.totalRachas = rachas.length;
      const acc: RankItem[] = [];
      for (const { racha, jogadores, eventos } of rachas) {
        for (const j of jogadores) {
          if (!j.id) continue;
          const s = computarStatsJogador(j.id, eventos, []);
          if (s.gols === 0 && s.assistencias === 0 && s.jogos === 0) continue;
          acc.push({
            jogadorId: `${racha.id}_${j.id}`,
            nome: j.apelido || j.nome,
            rachaNome: racha.nome,
            foto: j.fotoUrl,
            gols: s.gols,
            assist: s.assistencias,
            jogos: s.jogos,
            pg: s.gols + s.assistencias,
          });
        }
      }
      this.itens = acc;
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  selecionar(c: Categoria): void {
    this.categoria = c;
  }

  get catAtual(): { id: Categoria; label: string; icon: string; cor: string; unidade: string } {
    return this.categorias.find(c => c.id === this.categoria) ?? this.categorias[0];
  }

  private valor(i: RankItem, key: Categoria): number {
    switch (key) {
      case 'gols': return i.gols;
      case 'assist': return i.assist;
      case 'jogos': return i.jogos;
      case 'pg': return i.pg;
    }
  }

  /** Ranking ordenado pela categoria atual (top 30, só quem pontuou). */
  get ranking(): RankItem[] {
    return this.itens
      .filter(i => this.valor(i, this.categoria) > 0)
      .sort((a, b) => this.valor(b, this.categoria) - this.valor(a, this.categoria))
      .slice(0, 30);
  }

  get temDados(): boolean {
    return this.itens.length > 0;
  }

  valorAtual(i: RankItem): number {
    return this.valor(i, this.categoria);
  }

  iniciais(nome: string): string {
    return (nome || '?').trim().charAt(0).toUpperCase();
  }

  trackByItem(_i: number, i: RankItem): string {
    return i.jogadorId;
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }
  irRankingLocal(): void {
    this.router.navigate(['/racha', this.rachaId, 'ranking']);
  }
  irPartidas(): void {
    this.router.navigate(['/racha', this.rachaId, 'partidas']);
  }
}
