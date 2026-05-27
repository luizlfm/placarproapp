import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { getModalidade } from '../../../campeonatos/modalidades';

@Component({
  selector: 'app-cat-inicio',
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class InicioPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly equipesSrv = inject(EquipesService);

  /** Viewport mobile? Sincronizado via matchMedia. Usado pra escolher
   *  entre logo/capa web vs mobile da categoria (mesmo padrão do
   *  publico-categoria.page.ts). */
  ehMobile = false;
  private mqMobile?: MediaQueryList;
  private onMqChange = (e: MediaQueryListEvent) => { this.ehMobile = e.matches; };

  ngOnInit(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mqMobile = window.matchMedia('(max-width: 767px)');
      this.ehMobile = this.mqMobile.matches;
      this.mqMobile.addEventListener?.('change', this.onMqChange);
    }
  }

  ngOnDestroy(): void {
    this.mqMobile?.removeEventListener?.('change', this.onMqChange);
  }

  /** Retorna a capa apropriada — mobile-first fallback chain:
   *  mobile-variant → web-variant → banner legacy. Espelha `capaCamp` da
   *  publico-categoria pra dar consistência. */
  capaCategoria(c: Categoria | null | undefined): string | null {
    if (!c) return null;
    if (this.ehMobile && c.capaMobileUrl) return c.capaMobileUrl;
    return c.capaUrl ?? c.bannerUrl ?? null;
  }

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  readonly categoria$: Observable<Categoria | undefined> = this.route
    ? this.route.paramMap.pipe(
        switchMap(p => {
          const cId = p.get('id');
          const catId = p.get('catId');
          return cId && catId ? this.categoriasSrv.get$(cId, catId) : of(undefined);
        }),
      )
    : of(undefined);

  /** Stream do campeonato — precisamos do `ownerId` pra alimentar o
   *  `<app-banner-site-faixa>` (busca patrocinadores do dono). */
  readonly campeonato$: Observable<Campeonato | undefined> =
    this.campeonatoId
      ? this.campeonatosSrv.get$(this.campeonatoId)
      : of(undefined);

  readonly equipes$: Observable<Equipe[]> =
    this.campeonatoId && this.categoriaId
      ? this.equipesSrv.list$(this.campeonatoId, this.categoriaId)
      : of([]);

  /** Pull-to-refresh — arrasta pra baixo pra recarregar. */
  async onRefresh(ev: CustomEvent): Promise<void> {
    try {
      window.location.reload();
    } finally {
      const target = ev?.target as { complete?: () => void } | null;
      target?.complete?.();
    }
  }

  modalidadeOf(c: Categoria | undefined) {
    return c ? getModalidade(c.modalidade) : undefined;
  }

  trackById(_i: number, e: Equipe): string {
    return e.id ?? '';
  }
}
