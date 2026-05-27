import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { RachaService } from '../../../racha.service';
import { RachaEvento, RachaJogador, RachaPartida } from '../../../models/racha.model';
import { computarStatsJogador } from '../../../stats-jogador.helper';

/** Linha do mercado — jogador + valor calculado + variação. */
interface LinhaMercado {
  jogador: RachaJogador;
  valor: number;
  /** Variação % vs último cálculo (mock por enquanto — random ±15%). */
  variacao: number;
  /** Stats que compõem o valor (transparência pro user). */
  gols: number;
  assists: number;
  jogos: number;
  cartoes: number;
}

/**
 * Mercado de Notas — analogia ao stock-market: cada jogador tem um
 * "valor" calculado das suas estatísticas. A intenção é gamificar o
 * desempenho dos jogadores e gerar competição entre eles.
 *
 * Algoritmo (versão MVP):
 *   valor = 100 (base) + (gols × 10) + (assists × 5) + (jogos × 2) - (cartões × 3)
 *
 * Variação é mockada por enquanto — futuro: persiste valor em
 * `rachas/{id}/mercado/{jogadorId}` por data e calcula diff real.
 */
@Component({
  selector: 'app-racha-mercado',
  templateUrl: './mercado.page.html',
  styleUrls: ['./mercado.page.scss'],
  standalone: false,
})
export class RachaMercadoPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);

  rachaId = '';
  loading = true;
  linhas: LinhaMercado[] = [];
  /** Soma de todos os valores — usado pro "market cap" agregado. */
  totalCap = 0;
  private sub?: Subscription;

  /** Configuração de pesos do algoritmo. Centralizado pra fácil tunning. */
  private readonly PESOS = {
    base: 100,
    gol: 10,
    assist: 5,
    jogo: 2,
    cartao: -3,
  };

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) return;

    // combineLatest: jogadores + partidas + eventos do racha → recalcula valor
    // sempre que qualquer um muda. Stats agora vêm dos eventos REAIS.
    this.sub = combineLatest([
      this.rachaSrv.listJogadores$(this.rachaId),
      this.rachaSrv.listPartidas$(this.rachaId),
      this.rachaSrv.listEventosDoRacha$(this.rachaId),
    ])
      .pipe(
        map(([jogadores, partidas, eventos]) => {
          const ativos = jogadores.filter(j => j.ativo !== false);
          return ativos
            .map(j => this.calcularValor(j, eventos, partidas))
            .sort((a, b) => b.valor - a.valor);
        }),
      )
      .subscribe(linhas => {
        this.linhas = linhas;
        this.totalCap = linhas.reduce((s, l) => s + l.valor, 0);
        this.loading = false;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /**
   * Calcula o valor de mercado de um jogador a partir das stats REAIS
   * agregadas dos eventos das partidas. Quando o jogador ainda não tem
   * eventos, retorna valor base.
   */
  private calcularValor(
    j: RachaJogador,
    eventos: RachaEvento[],
    partidas: RachaPartida[],
  ): LinhaMercado {
    if (!j.id) {
      return this.linhaVazia(j);
    }
    const stats = computarStatsJogador(j.id, eventos, partidas);

    const valor =
      this.PESOS.base +
      stats.gols * this.PESOS.gol +
      stats.assistencias * this.PESOS.assist +
      stats.jogos * this.PESOS.jogo +
      stats.cartoes * this.PESOS.cartao;

    // Variação mockada — uniforme entre -15% e +15% baseada no id pra
    // ser determinística (não fica trocando a cada render). Futuro:
    // persistir valor anterior em `rachas/{id}/mercado/{jogadorId}` e
    // calcular diff real entre cálculos.
    const seed = this.hashCode(j.id);
    const variacao = ((seed % 30) - 15);

    return {
      jogador: j,
      valor: Math.max(0, valor),
      variacao,
      gols: stats.gols,
      assists: stats.assistencias,
      jogos: stats.jogos,
      cartoes: stats.cartoes,
    };
  }

  /** Linha vazia pra jogador sem id (não deveria acontecer, fallback). */
  private linhaVazia(j: RachaJogador): LinhaMercado {
    return {
      jogador: j,
      valor: this.PESOS.base,
      variacao: 0,
      gols: 0,
      assists: 0,
      jogos: 0,
      cartoes: 0,
    };
  }

  /** Hash determinístico de string → int (pra variação mockada estável). */
  private hashCode(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  /** Helper template — classe CSS pra variação (alta/baixa/neutra). */
  classeVariacao(v: number): string {
    if (v > 1) return 'alta';
    if (v < -1) return 'baixa';
    return 'neutra';
  }

  trackByLinha(_i: number, l: LinhaMercado): string {
    return l.jogador.id ?? `${_i}`;
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }
}
