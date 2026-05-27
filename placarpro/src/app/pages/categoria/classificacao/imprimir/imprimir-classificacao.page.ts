import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { NavBackService } from '../../../../shared/nav-back.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import {
  ClassificacaoGrupo,
  ClassificacaoService,
} from '../../../../campeonatos/classificacao.service';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';

interface ImprimirClassifView {
  campeonato?: Campeonato;
  categoria?: Categoria;
  grupos: ClassificacaoGrupo[];
  totalEquipes: number;
  totalJogos: number;
}

/**
 * Página de impressão da CLASSIFICAÇÃO da categoria.
 *
 * Layout A4 portrait com cabeçalho + uma tabela por grupo (ou única se sem
 * agrupamento). Inclui legendas de critérios (P/J/V/E/D/GP/GC/SG/%).
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/classificacao/imprimir`
 */
@Component({
  selector: 'app-imprimir-classificacao',
  templateUrl: './imprimir-classificacao.page.html',
  styleUrls: ['./imprimir-classificacao.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ImprimirClassificacaoPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly classifSrv = inject(ClassificacaoService);
  private readonly navBack = inject(NavBackService);

  readonly campeonatoId = this.lerParam('id');
  readonly categoriaId = this.lerParam('catId');

  view$: Observable<ImprimirClassifView | undefined> = of(undefined);

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) {
      console.error('[ImprimirClassif] params ausentes');
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
      'classificacao',
    ]);
  }

  imprimir(): void {
    window.print();
  }

  private montarView(): Observable<ImprimirClassifView | undefined> {
    const campeonato$ = this.campsSrv.get$(this.campeonatoId).pipe(catchError(() => of(undefined)));
    const categoria$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));
    // Passa fase=null (todas) + manual=false (ordenação por critério)
    const classif$ = this.classifSrv
      .classificacao$(this.campeonatoId, this.categoriaId, null, false)
      .pipe(
        startWith<ClassificacaoGrupo[]>([]),
        catchError(() => of<ClassificacaoGrupo[]>([])),
      );

    return combineLatest([campeonato$, categoria$, classif$]).pipe(
      map(([camp, cat, grupos]) => {
        const totalEquipes = grupos.reduce((s, g) => s + g.linhas.length, 0);
        const totalJogos = grupos.reduce(
          (s, g) => s + g.linhas.reduce((sj, l) => sj + l.jogos, 0),
          0,
        ) / 2; // cada jogo conta duas vezes (uma por equipe)
        return {
          campeonato: camp,
          categoria: cat,
          grupos,
          totalEquipes,
          totalJogos: Math.round(totalJogos),
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

  trackByGrupo(_i: number, g: ClassificacaoGrupo): string {
    return g.grupo?.id ?? '__all';
  }

  trackByLinha(_i: number, l: { equipe: { id?: string } }): string {
    return l.equipe.id ?? '';
  }

  today(): string {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  }
}
