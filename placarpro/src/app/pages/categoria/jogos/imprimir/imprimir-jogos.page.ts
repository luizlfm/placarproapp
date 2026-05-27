import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { NavBackService } from '../../../../shared/nav-back.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { dataHoraIsoParaBr } from '../../../../shared/directives/mask.directive';

interface JogoLinha {
  jogo: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  dataBr: string;
}

interface GrupoRodada {
  fase: string;
  rodada: number;
  jogos: JogoLinha[];
}

interface ImprimirView {
  campeonato?: Campeonato;
  categoria?: Categoria;
  totalJogos: number;
  totalEncerrados: number;
  totalAgendados: number;
  grupos: GrupoRodada[];
}

/**
 * Página de impressão da TABELA DE JOGOS (todas as partidas da categoria).
 *
 * Layout A4 portrait: cabeçalho com identificação + lista agrupada por
 * fase/rodada, cada grupo com tabela compacta de partidas. Use o botão
 * "Imprimir" no toolbar pra gerar o PDF.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/jogos/imprimir`
 */
@Component({
  selector: 'app-imprimir-jogos',
  templateUrl: './imprimir-jogos.page.html',
  styleUrls: ['./imprimir-jogos.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ImprimirJogosPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly navBack = inject(NavBackService);

  readonly campeonatoId = this.lerParam('id');
  readonly categoriaId = this.lerParam('catId');

  view$: Observable<ImprimirView | undefined> = of(undefined);

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) {
      console.error('[ImprimirJogos] params ausentes');
      return;
    }
    this.view$ = this.montarView();
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogos',
    ]);
  }

  imprimir(): void {
    window.print();
  }

  formatarDataBr(iso?: string | null): string {
    if (!iso) return 'A definir';
    return dataHoraIsoParaBr(iso) || iso;
  }

  rotuloStatus(s: Jogo['status']): string {
    switch (s) {
      case 'encerrado': return 'Encerrado';
      case 'em-andamento': return 'Ao vivo';
      case 'agendado': return 'Agendado';
      case 'cancelado': return 'Cancelado';
      case 'wo': return 'W.O.';
      default: return s;
    }
  }

  private montarView(): Observable<ImprimirView | undefined> {
    const campeonato$ = this.campsSrv.get$(this.campeonatoId).pipe(catchError(() => of(undefined)));
    const categoria$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));
    const jogos$ = this.jogosSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Jogo[]>([]), catchError(() => of<Jogo[]>([])));
    const equipes$ = this.equipesSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Equipe[]>([]), catchError(() => of<Equipe[]>([])));

    return combineLatest([campeonato$, categoria$, jogos$, equipes$]).pipe(
      map(([camp, cat, jogos, equipes]) => {
        const linhas: JogoLinha[] = jogos.map(j => ({
          jogo: j,
          mandante: equipes.find(e => e.id === j.mandanteId),
          visitante: equipes.find(e => e.id === j.visitanteId),
          dataBr: this.formatarDataBr(j.dataHora),
        }));

        // Agrupa por fase + rodada
        const mapa = new Map<string, GrupoRodada>();
        for (const l of linhas) {
          const fase = (l.jogo.fase || '').trim() || 'Geral';
          const rodada = l.jogo.rodada ?? 0;
          const chave = `${fase}__${rodada}`;
          if (!mapa.has(chave)) {
            mapa.set(chave, { fase, rodada, jogos: [] });
          }
          mapa.get(chave)!.jogos.push(l);
        }

        // Ordena os grupos por fase (alfabético) + rodada (numérico)
        const grupos = Array.from(mapa.values()).sort((a, b) => {
          if (a.fase !== b.fase) return a.fase.localeCompare(b.fase, 'pt-BR');
          return a.rodada - b.rodada;
        });

        // Ordena partidas dentro de cada grupo pela data
        for (const g of grupos) {
          g.jogos.sort((a, b) => {
            const da = a.jogo.dataHora ?? '';
            const db = b.jogo.dataHora ?? '';
            return da.localeCompare(db);
          });
        }

        return {
          campeonato: camp,
          categoria: cat,
          totalJogos: jogos.length,
          totalEncerrados: jogos.filter(j => j.status === 'encerrado').length,
          totalAgendados: jogos.filter(j => j.status === 'agendado').length,
          grupos,
        };
      }),
    );
  }

  private lerParam(name: string): string {
    let cursor: ActivatedRoute | null = this.route;
    while (cursor) {
      const v = cursor.snapshot.paramMap.get(name);
      if (v) return v;
      cursor = cursor.parent;
    }
    return '';
  }

  trackByGrupo(_i: number, g: GrupoRodada): string {
    return `${g.fase}__${g.rodada}`;
  }

  trackByJogo(_i: number, l: JogoLinha): string {
    return l.jogo.id ?? '';
  }
}
