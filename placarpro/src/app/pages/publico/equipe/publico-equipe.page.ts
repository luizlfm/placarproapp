import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { ClassificacaoService } from '../../../campeonatos/classificacao.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { NavBackService } from '../../../shared/nav-back.service';

/** Resumo agregado dos jogos da equipe (calculado client-side). */
interface ResumoEquipe {
  jogosTotal: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  golsPro: number;
  golsContra: number;
  saldo: number;
  aproveitamento: number; // % (V*3 + E) / (Jogos*3) * 100
}

/** Jogo enriquecido com o adversário (já contextualizado pra equipe). */
interface JogoEquipe {
  jogo: Jogo;
  adversarioNome: string;
  adversarioLogo?: string;
  resultado: 'V' | 'E' | 'D' | '-';
  placar: string; // "2 × 1" (mandante × visitante na perspectiva da equipe)
  ehMandante: boolean;
}

/**
 * Página pública da Equipe — exibe dados básicos + jogadores + comissão técnica
 * + histórico de jogos da equipe.
 *
 * Rota: `/:slug/categoria/:catId/equipe/:equipeId`
 *
 * Acessível a qualquer visitante (mesmo anônimo), desde que o campeonato seja
 * público. As regras Firestore permitem leitura quando o campeonato tem
 * `publico: true`.
 */
@Component({
  selector: 'app-publico-equipe',
  templateUrl: './publico-equipe.page.html',
  styleUrls: ['./publico-equipe.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PublicoEquipePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campSrv = inject(CampeonatosService);
  private readonly catSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly classifSrv = inject(ClassificacaoService);
  private readonly navBack = inject(NavBackService);

  campeonato?: Campeonato;
  categoria?: Categoria;
  equipe?: Equipe;
  loading = true;
  erro = false;

  /** Aba ativa do segmento. Default abre em Jogos (mais relevante p/ torcedor). */
  aba: 'jogos' | 'jogadores' = 'jogos';
  /** Setter usado pelo (ionChange) do ion-segment. */
  selecionarAba(a: 'jogos' | 'jogadores'): void {
    this.aba = a;
  }

  jogadores$: Observable<Jogador[]> = of([]);
  jogos$: Observable<JogoEquipe[]> = of([]);
  resumo$: Observable<ResumoEquipe> = of(this.resumoVazio());

  /** Posição na tabela (1, 2, 3...) + total de equipes no grupo. */
  posicao$: Observable<{ pos: number; total: number; grupo?: string } | null> = of(null);

  /** UID-like params capturados da rota. */
  private slug = '';
  private catId = '';
  private equipeId = '';

  async ngOnInit(): Promise<void> {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.catId = this.route.snapshot.paramMap.get('catId') ?? '';
    this.equipeId = this.route.snapshot.paramMap.get('equipeId') ?? '';

    if (!this.slug || !this.catId || !this.equipeId) {
      this.erro = true;
      this.loading = false;
      return;
    }

    try {
      // 1) Resolve campeonato pelo slug
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

      // 2) Categoria
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

      // 3) Equipe específica
      this.equipe = await new Promise<Equipe | undefined>(resolve => {
        const sub = this.equipesSrv.get$(c!.id!, this.catId, this.equipeId).subscribe(d => {
          resolve(d);
          setTimeout(() => sub.unsubscribe(), 0);
        });
      });
      if (!this.equipe) {
        this.erro = true;
        return;
      }

      this.setupStreams(c.id!, this.catId, this.equipeId);
    } catch (err) {
      console.error('[PublicoEquipe] erro carregando', err);
      this.erro = true;
    } finally {
      this.loading = false;
    }
  }

  private setupStreams(campId: string, catId: string, equipeId: string): void {
    const safe = <T>(o$: Observable<T>, fb: T) =>
      o$.pipe(startWith(fb), catchError(() => of(fb)));

    // Jogadores da equipe específica
    this.jogadores$ = safe(
      this.jogadoresSrv.list$(campId, catId),
      [] as Jogador[],
    ).pipe(
      map(list => list
        .filter(j => j.equipeId === equipeId)
        .sort((a, b) => {
          // Ordena por número da camisa (asc, ignorando não-numérico), depois nome
          const na = Number(a.numeroCamisa) || 999;
          const nb = Number(b.numeroCamisa) || 999;
          if (na !== nb) return na - nb;
          return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
        }),
      ),
    );

    // Jogos onde a equipe participou (mandante OU visitante)
    const jogosAll$ = safe(this.jogosSrv.list$(campId, catId), [] as Jogo[]);
    const equipesAll$ = safe(this.equipesSrv.list$(campId, catId), [] as Equipe[]);

    this.jogos$ = combineLatest([jogosAll$, equipesAll$]).pipe(
      map(([jogos, equipes]) => {
        const eqMap = new Map(equipes.map(e => [e.id!, e]));
        return jogos
          .filter(j => j.mandanteId === equipeId || j.visitanteId === equipeId)
          .sort((a, b) => {
            // Mais recentes primeiro (encerrados depois)
            const ordemStatus: Record<string, number> = {
              'em-andamento': 0, 'agendado': 1, 'encerrado': 2, 'wo': 3, 'cancelado': 4,
            };
            const sa = ordemStatus[a.status ?? 'agendado'] ?? 99;
            const sb = ordemStatus[b.status ?? 'agendado'] ?? 99;
            if (sa !== sb) return sa - sb;
            return 0;
          })
          .map(j => this.enriquecerJogo(j, equipeId, eqMap));
      }),
    );

    // Resumo agregado (apenas jogos encerrados contam)
    this.resumo$ = this.jogos$.pipe(
      map(arr => this.calcularResumo(arr)),
    );

    // Posição na classificação geral — varre todos os grupos e procura
    // a linha cuja equipe.id == nosso equipeId. Se a categoria tem grupos
    // separados, retorna a posição dentro do grupo + nome do grupo.
    this.posicao$ = safe(
      this.classifSrv.classificacao$(campId, catId, null, false),
      [],
    ).pipe(
      map(grupos => {
        for (const g of grupos) {
          const linha = g.linhas.find(l => l.equipe.id === equipeId);
          if (linha) {
            return {
              pos: linha.pos,
              total: g.linhas.length,
              grupo: g.grupo?.nome,
            };
          }
        }
        return null;
      }),
    );
  }

  private enriquecerJogo(j: Jogo, equipeId: string, eqMap: Map<string, Equipe>): JogoEquipe {
    const ehMandante = j.mandanteId === equipeId;
    const advId = ehMandante ? j.visitanteId : j.mandanteId;
    const adv = eqMap.get(advId);

    let resultado: 'V' | 'E' | 'D' | '-' = '-';
    const gMand = j.golsMandante;
    const gVis = j.golsVisitante;
    if (j.status === 'encerrado' && gMand != null && gVis != null) {
      const meus = ehMandante ? gMand : gVis;
      const deles = ehMandante ? gVis : gMand;
      if (meus > deles) resultado = 'V';
      else if (meus < deles) resultado = 'D';
      else resultado = 'E';
    }

    const placar = (gMand != null && gVis != null) ? `${gMand} × ${gVis}` : '— × —';

    return {
      jogo: j,
      adversarioNome: adv?.nome ?? '?',
      adversarioLogo: adv?.logoUrl,
      resultado,
      placar,
      ehMandante,
    };
  }

  private calcularResumo(jogos: JogoEquipe[]): ResumoEquipe {
    const r = this.resumoVazio();
    for (const jg of jogos) {
      const j = jg.jogo;
      if (j.status !== 'encerrado') continue;
      const gMand = j.golsMandante ?? 0;
      const gVis = j.golsVisitante ?? 0;
      const meus = jg.ehMandante ? gMand : gVis;
      const deles = jg.ehMandante ? gVis : gMand;
      r.jogosTotal++;
      r.golsPro += meus;
      r.golsContra += deles;
      if (meus > deles) r.vitorias++;
      else if (meus < deles) r.derrotas++;
      else r.empates++;
    }
    r.saldo = r.golsPro - r.golsContra;
    r.aproveitamento = r.jogosTotal > 0
      ? Math.round(((r.vitorias * 3 + r.empates) / (r.jogosTotal * 3)) * 100)
      : 0;
    return r;
  }

  private resumoVazio(): ResumoEquipe {
    return {
      jogosTotal: 0, vitorias: 0, empates: 0, derrotas: 0,
      golsPro: 0, golsContra: 0, saldo: 0, aproveitamento: 0,
    };
  }

  /** Volta pra categoria. */
  voltar(): void {
    this.navBack.back(['/', this.slug, 'categoria', this.catId]);
  }

  /** Compartilha URL da equipe via Web Share API. */
  async compartilhar(): Promise<void> {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: this.equipe?.nome ?? 'Equipe',
          text: `Veja a ficha da equipe ${this.equipe?.nome} no PlacarPro`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch { /* cancelado */ }
  }

  trackByJogador(_i: number, j: Jogador): string {
    return j.id ?? `${_i}`;
  }
  trackByJogoEquipe(_i: number, j: JogoEquipe): string {
    return j.jogo.id ?? `${_i}`;
  }

  /** Cor do label de resultado (V/E/D). */
  corResultado(r: 'V' | 'E' | 'D' | '-'): string {
    switch (r) {
      case 'V': return '#7CC61D';
      case 'D': return '#E11D48';
      case 'E': return '#F59E0B';
      default:  return '#94A3B8';
    }
  }

  /** Label legível de posição. */
  labelPosicao(p?: string): string {
    if (!p) return '';
    return p;
  }
}
