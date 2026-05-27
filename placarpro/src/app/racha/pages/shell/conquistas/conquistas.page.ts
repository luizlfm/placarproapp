import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { RachaService } from '../../../racha.service';
import { RachaJogador } from '../../../models/racha.model';
import { computarStatsJogador, statsZero } from '../../../stats-jogador.helper';

/**
 * Definição de um badge — critério calculado a partir de stats do jogador.
 * A stats vem do `notaGeral` + futuro: gols, jogos, assistências (quando
 * a subcoleção `partidas/eventos` for implementada).
 */
interface Badge {
  id: string;
  nome: string;
  descricao: string;
  icon: string;
  /** Cor do badge — usada no SCSS via CSS variable. */
  cor: string;
  /** Função que recebe o jogador (com stats agregadas) e retorna boolean. */
  desbloqueado: (j: JogadorComStats) => boolean;
}

/** Jogador com stats agregadas (gols/assists/jogos/cartões vêm dos
 *  eventos REAIS das partidas; `notaGeral` continua do doc do jogador). */
interface JogadorComStats {
  jogador: RachaJogador;
  gols: number;
  assists: number;
  jogos: number;
  cartoes: number;
  hatTricks: number;
  notaGeral: number;
}

/**
 * Página de Conquistas — badges que cada jogador desbloqueia ao atingir
 * marcos. Os critérios são calculados em runtime; não há documento
 * persistente por enquanto (futuro: subcoleção `conquistas` pra histórico).
 */
@Component({
  selector: 'app-racha-conquistas',
  templateUrl: './conquistas.page.html',
  styleUrls: ['./conquistas.page.scss'],
  standalone: false,
})
export class RachaConquistasPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);

  rachaId = '';
  loading = true;
  /** Lista de jogadores com suas stats + badges desbloqueados. */
  jogadores: Array<JogadorComStats & { badges: Badge[] }> = [];
  private sub?: Subscription;

  /** Catálogo de badges disponíveis. Critérios simples baseados em
   *  stats que dá pra calcular hoje. Pra extender: adicione mais entradas. */
  readonly badges: Badge[] = [
    {
      id: 'primeiro-gol',
      nome: 'Primeiro gol',
      descricao: 'Marcou pelo menos 1 gol no racha',
      icon: 'football',
      cor: '#7CC61D',
      desbloqueado: j => j.gols >= 1,
    },
    {
      id: 'artilheiro',
      nome: 'Artilheiro',
      descricao: 'Mais de 5 gols no histórico',
      icon: 'trophy',
      cor: '#f5c518',
      desbloqueado: j => j.gols >= 5,
    },
    {
      id: 'hat-trick',
      nome: 'Hat-Trick',
      descricao: '3 ou mais gols numa mesma partida',
      icon: 'flame',
      cor: '#ef4444',
      desbloqueado: j => j.hatTricks >= 1,
    },
    {
      id: 'maestro',
      nome: 'Maestro',
      descricao: 'Mais de 3 assistências',
      icon: 'sparkles',
      cor: '#a855f7',
      desbloqueado: j => j.assists >= 3,
    },
    {
      id: 'veterano',
      nome: 'Veterano',
      descricao: 'Participou de 10+ peladas',
      icon: 'medal',
      cor: '#0ea5e9',
      desbloqueado: j => j.jogos >= 10,
    },
    {
      id: 'fair-play',
      nome: 'Fair Play',
      descricao: 'Zero cartões no histórico',
      icon: 'shield-checkmark',
      cor: '#22c55e',
      desbloqueado: j => j.cartoes === 0 && j.jogos > 0,
    },
    {
      id: 'craque',
      nome: 'Craque',
      descricao: 'Nota geral 8.0 ou mais',
      icon: 'star',
      cor: '#f97316',
      desbloqueado: j => j.notaGeral >= 8,
    },
    {
      id: 'goleiro-imbativel',
      nome: 'Goleiro Imbatível',
      descricao: 'Goleiro que pegou pênaltis',
      icon: 'hand-left',
      cor: '#06b6d4',
      desbloqueado: j => j.jogador.posicao === 'goleiro' && j.notaGeral >= 7,
    },
  ];

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) return;

    // Stats vêm dos eventos REAIS das partidas (não mais do proxy notaGeral).
    this.sub = combineLatest([
      this.rachaSrv.listJogadores$(this.rachaId),
      this.rachaSrv.listPartidas$(this.rachaId),
      this.rachaSrv.listEventosDoRacha$(this.rachaId),
    ])
      .pipe(
        map(([jogadores, partidas, eventos]) =>
          jogadores
            .filter(j => j.ativo !== false)
            .map(j => {
              const s = j.id
                ? computarStatsJogador(j.id, eventos, partidas)
                : statsZero('');
              const stats: JogadorComStats = {
                jogador: j,
                gols: s.gols,
                assists: s.assistencias,
                jogos: s.jogos,
                cartoes: s.cartoes,
                hatTricks: s.hatTricks,
                notaGeral: j.notaGeral ?? 0,
              };
              const badges = this.badges.filter(b => b.desbloqueado(stats));
              return { ...stats, badges };
            })
            // Ordena por quantidade de badges (desc) → quem mais desbloqueou no topo.
            .sort((a, b) => b.badges.length - a.badges.length),
        ),
      )
      .subscribe(jogadoresComBadges => {
        this.jogadores = jogadoresComBadges;
        this.loading = false;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Lista de badges que o jogador AINDA não tem — pra mostrar "próximas". */
  badgesPendentes(j: JogadorComStats & { badges: Badge[] }): Badge[] {
    const conquistadosIds = new Set(j.badges.map(b => b.id));
    return this.badges.filter(b => !conquistadosIds.has(b.id));
  }

  trackByJogador(_i: number, item: { jogador: RachaJogador }): string {
    return item.jogador.id ?? `${_i}`;
  }

  trackByBadge(_i: number, b: Badge): string {
    return b.id;
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }
}
