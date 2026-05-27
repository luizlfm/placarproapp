import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { RachaJogador, RachaTime } from '../../../models/racha.model';

type CriterioSorteio = 'notas' | 'aleatorio' | 'posicoes' | 'mercado';

/**
 * Resultado do sorteio: agrupamento de jogadores por time. `null` significa
 * "jogador no banco" (sobrou da capacidade). Times mantêm ordem de
 * `RachaTime.ordem`.
 */
interface TimeSorteado {
  time: RachaTime | { id: string; nome: string; cor?: string; ordem?: number };
  jogadores: RachaJogador[];
  /** Média da nota geral do time — pra mostrar equilíbrio. */
  mediaNota: number;
}

/**
 * Página SORTEAR TIMES — algoritmo de balanceamento de times.
 *
 * Critérios:
 *  - `notas`: ordena jogadores por nota desc, distribui em zig-zag
 *    (snake draft) pros times. Mais equilibrado.
 *  - `aleatorio`: shuffle puro.
 *  - `posicoes`: distribui goleiros primeiro, depois linha. Placeholder
 *    (até termos `RachaJogador.posicao` mais robusto).
 *  - `mercado`: usa notas peer-to-peer (avaliação). Placeholder.
 */
@Component({
  selector: 'app-racha-sortear',
  templateUrl: './sortear.page.html',
  styleUrls: ['./sortear.page.scss'],
  standalone: false,
})
export class RachaSortearPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly toastCtrl = inject(ToastController);

  rachaId = '';
  loading = true;

  /** Times e jogadores do racha (carregados via subcoleção). */
  times: RachaTime[] = [];
  jogadores: RachaJogador[] = [];

  /** Configuração ajustável na UI. */
  qtdTimes = 2;
  jogadoresPorTime = 5;
  criterio: CriterioSorteio = 'notas';

  /** Resultado do último sorteio. */
  resultado: TimeSorteado[] = [];
  /** Jogadores que sobraram do sorteio (banco). */
  banco: RachaJogador[] = [];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.sub = combineLatest([
      this.rachaSrv.get$(this.rachaId).pipe(startWith(null), catchError(() => of(null))),
      this.rachaSrv.listTimes$(this.rachaId).pipe(startWith([] as RachaTime[]), catchError(() => of([] as RachaTime[]))),
      this.rachaSrv.listJogadores$(this.rachaId).pipe(startWith([] as RachaJogador[]), catchError(() => of([] as RachaJogador[]))),
    ]).subscribe(([racha, times, jogadores]) => {
      this.times = times;
      this.jogadores = jogadores.filter(j => j.ativo !== false);
      if (racha && this.loading) {
        // Inicializa com valores do racha (só na primeira carga)
        this.qtdTimes = racha.qtdTimes ?? 2;
        this.jogadoresPorTime = racha.jogadoresPorTime ?? 5;
      }
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get totalDentro(): number {
    return Math.min(this.jogadores.length, this.qtdTimes * this.jogadoresPorTime);
  }
  get capacidade(): number {
    return this.qtdTimes * this.jogadoresPorTime;
  }
  get sobraNoBanco(): number {
    return Math.max(0, this.jogadores.length - this.capacidade);
  }
  get jogadoresDisponiveis(): RachaJogador[] {
    return this.jogadores;
  }

  // ============== Ações ==============

  limparJogadores(): void {
    // No FutBora isso remove jogadores da fila do sorteio. Aqui não temos
    // "fila" separada — então apenas reseta o resultado.
    this.resultado = [];
    this.banco = [];
    this.toast('Resultado limpo.', 'medium');
  }

  limparSorteio(): void {
    this.resultado = [];
    this.banco = [];
    this.toast('Sorteio resetado.', 'medium');
  }

  /** Sorteia times com base no critério selecionado. */
  async sortear(): Promise<void> {
    if (this.jogadores.length === 0) {
      this.toast('Cadastre jogadores antes de sortear.', 'danger');
      return;
    }
    if (this.qtdTimes < 2) {
      this.toast('Mínimo de 2 times.', 'danger');
      return;
    }
    const candidatos = [...this.jogadores];
    const totalNecessario = this.qtdTimes * this.jogadoresPorTime;

    // Aplica critério de ordenação/embaralhamento
    let ordenados: RachaJogador[];
    switch (this.criterio) {
      case 'notas':
      case 'mercado': // até termos market: cai pra notas
        ordenados = candidatos.sort((a, b) =>
          (b.notaGeral ?? 0) - (a.notaGeral ?? 0));
        break;
      case 'posicoes':
        // Goleiros primeiro, depois linha — desempate por nota
        ordenados = candidatos.sort((a, b) => {
          const ga = a.posicao === 'goleiro' ? 0 : 1;
          const gb = b.posicao === 'goleiro' ? 0 : 1;
          if (ga !== gb) return ga - gb;
          return (b.notaGeral ?? 0) - (a.notaGeral ?? 0);
        });
        break;
      case 'aleatorio':
      default:
        ordenados = this.shuffle(candidatos);
    }

    // Pega só os primeiros (capacidade do racha). Resto vai pro banco.
    const ativos = ordenados.slice(0, totalNecessario);
    const banco = ordenados.slice(totalNecessario);

    // Distribui em "snake draft": 1ª rodada 1→N, 2ª rodada N→1, etc.
    // Resultado: times ficam balanceados quando ordenamos por nota.
    const buckets: RachaJogador[][] = Array.from({ length: this.qtdTimes }, () => []);
    for (let i = 0; i < ativos.length; i++) {
      const rodada = Math.floor(i / this.qtdTimes);
      const posNaRodada = i % this.qtdTimes;
      const timeIdx = rodada % 2 === 0 ? posNaRodada : this.qtdTimes - 1 - posNaRodada;
      buckets[timeIdx].push(ativos[i]);
    }

    // Monta resultado usando os Times reais (subcoleção) quando disponíveis,
    // ou times virtuais quando o usuário ainda não criou os times.
    const timesReais = [...this.times].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    this.resultado = buckets.map((jogadores, idx) => {
      const time = timesReais[idx] ?? {
        id: `virtual-${idx}`,
        nome: `Time ${idx + 1}`,
        cor: this.corPadrao(idx),
        ordem: idx + 1,
      };
      const soma = jogadores.reduce((acc, j) => acc + (j.notaGeral ?? 0), 0);
      const media = jogadores.length ? soma / jogadores.length : 0;
      return { time, jogadores, mediaNota: Math.round(media * 10) / 10 };
    });
    this.banco = banco;

    this.toast(`Times sorteados com critério "${this.labelCriterio(this.criterio)}"!`, 'success');
  }

  /**
   * Sorteio "com IA" — otimização multi-iteração que considera 3 fatores
   * simultaneamente (em vez de só um, como nos critérios manuais):
   *
   *  1. Equilíbrio de NOTAS: minimiza variância das médias entre times
   *  2. Distribuição de GOLEIROS: cada time idealmente tem 1 (se houver)
   *  3. Diversidade de POSIÇÕES: evita time só de "linha" + outro só de "ala"
   *
   * Roda ~800 iterações aleatórias, calcula um score combinado pra cada
   * configuração, e fica com a melhor. Vantagem sobre snake-draft (`notas`):
   * snake é greedy/determinístico e nem sempre acha o ótimo. Random search
   * com 800 tentativas explora muito mais o espaço de soluções.
   *
   * Não é LLM (não chama API externa, sem custo) — é heurística clássica
   * que dá resultado "inteligente" pra fins práticos.
   */
  async sorteioComIA(): Promise<void> {
    if (this.jogadores.length === 0) {
      this.toast('Cadastre jogadores antes de sortear.', 'danger');
      return;
    }
    if (this.qtdTimes < 2) {
      this.toast('Mínimo de 2 times.', 'danger');
      return;
    }

    const t = await this.toastCtrl.create({
      message: '🤖 Otimizando combinações...',
      duration: 1200,
      position: 'top',
      color: 'medium',
    });
    await t.present();

    // dá um respiro pra UI atualizar antes do loop pesado
    await new Promise(r => setTimeout(r, 50));

    const totalNecessario = this.qtdTimes * this.jogadoresPorTime;
    const candidatos = [...this.jogadores];

    // Pre-computa estatísticas globais pra usar como referência no score
    const globalAvg =
      candidatos.reduce((acc, j) => acc + (j.notaGeral ?? 5), 0) / candidatos.length;
    const goleirosTotal = candidatos.filter(j => j.posicao === 'goleiro').length;
    const goleirosPorTimeIdeal = Math.min(1, Math.floor(goleirosTotal / this.qtdTimes));

    let melhorScore = Infinity;
    let melhorBuckets: RachaJogador[][] = [];
    let melhorBanco: RachaJogador[] = [];

    const ITER = 800;
    for (let iter = 0; iter < ITER; iter++) {
      // Embaralha e divide nos times
      const embaralhado = this.shuffle(candidatos);
      const ativos = embaralhado.slice(0, totalNecessario);
      const banco = embaralhado.slice(totalNecessario);
      const buckets: RachaJogador[][] = Array.from(
        { length: this.qtdTimes },
        () => [],
      );
      for (let i = 0; i < ativos.length; i++) {
        buckets[i % this.qtdTimes].push(ativos[i]);
      }

      // Calcula score (menor = melhor)
      let score = 0;
      for (const time of buckets) {
        const soma = time.reduce((a, j) => a + (j.notaGeral ?? 5), 0);
        const media = time.length ? soma / time.length : 0;
        // 1. Distância da média global (peso 10) — fator principal
        score += Math.abs(media - globalAvg) * 10;

        // 2. Goleiros distribuídos (peso 5)
        const golsNoTime = time.filter(j => j.posicao === 'goleiro').length;
        if (goleirosTotal > 0) {
          score += Math.abs(golsNoTime - goleirosPorTimeIdeal) * 5;
        }

        // 3. Diversidade de posições (peso 2) — pune times com 1 só tipo
        const posicoesUnicas = new Set(
          time.map(j => j.posicao ?? 'linha'),
        ).size;
        score += Math.max(0, 3 - posicoesUnicas) * 2;
      }

      if (score < melhorScore) {
        melhorScore = score;
        melhorBuckets = buckets;
        melhorBanco = banco;
      }
    }

    // Monta resultado com os melhores buckets encontrados
    const timesReais = [...this.times].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    this.resultado = melhorBuckets.map((jogadores, idx) => {
      const time = timesReais[idx] ?? {
        id: `virtual-${idx}`,
        nome: `Time ${idx + 1}`,
        cor: this.corPadrao(idx),
        ordem: idx + 1,
      };
      const soma = jogadores.reduce((acc, j) => acc + (j.notaGeral ?? 0), 0);
      const media = jogadores.length ? soma / jogadores.length : 0;
      return { time, jogadores, mediaNota: Math.round(media * 10) / 10 };
    });
    this.banco = melhorBanco;

    // Calcula diferença entre maior e menor média pra dar feedback
    const medias = this.resultado.map(r => r.mediaNota);
    const diff = Math.max(...medias) - Math.min(...medias);
    const qualidade =
      diff < 0.2 ? '🎯 Perfeito!' :
      diff < 0.5 ? '✅ Muito bom' :
      diff < 1.0 ? '⚠️ Razoável' :
      '🔄 Pode tentar de novo';
    this.toast(
      `${qualidade} Diferença entre times: ${diff.toFixed(1)} pontos.`,
      diff < 0.5 ? 'success' : 'medium',
    );
  }

  cadastrarJogadores(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }

  compartilhar(): void {
    if (this.resultado.length === 0) {
      this.toast('Sorteie primeiro pra compartilhar.', 'danger');
      return;
    }
    const linhas: string[] = ['🏆 *Sorteio de times*', ''];
    this.resultado.forEach(r => {
      linhas.push(`*${r.time.nome}* (média ${r.mediaNota})`);
      r.jogadores.forEach(j => linhas.push(`  • ${j.apelido || j.nome}`));
      linhas.push('');
    });
    if (this.banco.length > 0) {
      linhas.push(`*Banco:* ${this.banco.map(j => j.apelido || j.nome).join(', ')}`);
    }
    const texto = linhas.join('\n');
    navigator.clipboard?.writeText(texto).then(
      () => this.toast('Resumo copiado! Cole no WhatsApp.', 'success'),
      () => this.toast('Falha ao copiar.', 'danger'),
    );
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  // ============== Helpers ==============

  /** Fisher-Yates shuffle in-place. */
  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private corPadrao(i: number): string {
    const paleta = ['#7CC61D', '#4DABF7', '#f5c518', '#ef4444', '#845EF7', '#14b8a6'];
    return paleta[i % paleta.length];
  }

  labelCriterio(c: CriterioSorteio): string {
    switch (c) {
      case 'notas':     return 'Notas';
      case 'aleatorio': return 'Aleatório';
      case 'posicoes':  return 'Posições';
      case 'mercado':   return 'Mercado de Notas';
    }
  }

  inicial(j: RachaJogador): string {
    const fonte = j.apelido?.trim() || j.nome?.trim() || '?';
    return fonte.charAt(0).toUpperCase();
  }

  trackByJogador(_i: number, j: RachaJogador): string {
    return j.id ?? '';
  }
  trackByTimeSorteado(_i: number, t: TimeSorteado): string {
    return t.time.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
