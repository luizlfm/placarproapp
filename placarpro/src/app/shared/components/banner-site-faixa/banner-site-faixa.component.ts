import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  inject,
} from '@angular/core';
import { Observable, Subscription, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Patrocinador } from '../../../users/models/patrocinador.model';
import { UsersService } from '../../../users/users.service';

/**
 * Variantes visuais — controlam cor de fundo, sombra e bordas.
 * - `claro`     → fundo branco (padrão pra topo de página)
 * - `escuro`    → fundo navy translúcido (pra overlay no banner do campeonato)
 * - `impresso`  → preto/branco com borda fina (otimizado pra @media print)
 * - `sticky`    → faixa fixa no rodapé com sombra superior
 */
export type BannerSiteVariante = 'claro' | 'escuro' | 'impresso' | 'sticky';

/**
 * Faixa horizontal rotativa que exibe o `bannerSiteUrl` (970×90) dos
 * patrocinadores cadastrados pelo organizador do campeonato.
 *
 * - Carrega da subcoleção `users/{ownerId}/patrocinadores`.
 * - Filtra só os que têm `bannerSiteUrl` preenchido (≠ logo, ≠ bannerApp).
 * - Rotaciona automaticamente entre eles (default 6s).
 * - Click abre o link/site externo em nova aba.
 * - Quando não há nenhum patrocinador com bannerSite, o componente
 *   simplesmente não renderiza nada (sem placeholder ocupando espaço).
 *
 * Uso:
 * ```html
 * <app-banner-site-faixa
 *   [ownerId]="camp.ownerId"
 *   variante="claro"
 * ></app-banner-site-faixa>
 * ```
 */
@Component({
  selector: 'app-banner-site-faixa',
  templateUrl: './banner-site-faixa.component.html',
  styleUrls: ['./banner-site-faixa.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BannerSiteFaixaComponent implements OnInit, OnChanges, OnDestroy {
  /** UID do organizador (do `campeonato.ownerId`). */
  @Input() ownerId = '';
  /** Contexto opcional: id do campeonato atual. Filtra patrocinadores com
   *  `campeonatosVisivel` definido pra mostrar só os habilitados aqui. */
  @Input() campeonatoId?: string;
  /** Contexto opcional: id da categoria atual. Filtra pelos com
   *  `categoriasVisivel` no formato "campId:catId". */
  @Input() categoriaId?: string;
  /** Variante visual — afeta cores/bordas/sombras. */
  @Input() variante: BannerSiteVariante = 'claro';
  /**
   * Intervalo de troca em ms — usado como FALLBACK quando o patrocinador
   * NÃO tem `tempoBanner` configurado individualmente. A rotação real
   * respeita o `tempoBanner` (em segundos) de cada banner — assim cada
   * patrocinador pode aparecer pelo tempo que pagou. `0` desliga a
   * rotação inteira (banner fica fixo).
   */
  @Input() intervaloMs = 6000;

  private readonly usersSrv = inject(UsersService);
  /** Necessário pra forçar re-render quando o subscribe atualiza `banners`
   *  — sem isso, OnPush não percebe que a lista mudou e o banner some. */
  private readonly cdr = inject(ChangeDetectorRef);

  /** Indica se estamos em viewport mobile (≤767px). Atualizado por
   *  matchMedia listener pra re-renderizar em resize sem reload. */
  eMobile = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 767px)').matches
    : false;
  private mqList?: MediaQueryList;
  private mqHandler = (e: MediaQueryListEvent): void => {
    this.eMobile = e.matches;
    this.cdr.markForCheck();
  };

  /** Retorna a URL do banner correta pro viewport atual.
   *  Mobile: prefere bannerSiteMobileUrl, fallback pro web (com crop CSS).
   *  Web: prefere bannerSiteUrl, fallback pro mobile (raro). */
  bannerUrlParaViewport(p: Patrocinador): string {
    if (this.eMobile) {
      return p.bannerSiteMobileUrl || p.bannerSiteUrl || '';
    }
    return p.bannerSiteUrl || p.bannerSiteMobileUrl || '';
  }

  /** Patrocinadores filtrados (apenas com bannerSite preenchido). */
  banners: Patrocinador[] = [];
  /** Índice atual da rotação. */
  indiceAtual = 0;

  /** Subscription do timer da rotação (legacy — agora usamos setTimeout). */
  private timerSub?: Subscription;
  private listSub?: Subscription;
  /** Handle do setTimeout que dispara a próxima rotação. Usamos setTimeout
   *  em vez de `timer()` da RxJS porque cada banner tem um intervalo
   *  diferente (`tempoBanner`), então não dá pra usar período fixo. */
  private rotacaoTimeout?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.recarregar();
    // Listener de viewport pra trocar entre banner mobile e web sem reload.
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mqList = window.matchMedia('(max-width: 767px)');
      this.mqList.addEventListener('change', this.mqHandler);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Recarrega se mudar qualquer input que afete o filtro de visibilidade.
    if (
      (changes['ownerId']      && !changes['ownerId'].firstChange) ||
      (changes['campeonatoId'] && !changes['campeonatoId'].firstChange) ||
      (changes['categoriaId']  && !changes['categoriaId'].firstChange)
    ) {
      this.recarregar();
    }
  }

  ngOnDestroy(): void {
    this.timerSub?.unsubscribe();
    this.listSub?.unsubscribe();
    this.pararRotacao();
    if (this.mqList) {
      this.mqList.removeEventListener('change', this.mqHandler);
    }
  }

  private recarregar(): void {
    this.timerSub?.unsubscribe();
    this.listSub?.unsubscribe();
    this.banners = [];
    this.indiceAtual = 0;
    if (!this.ownerId) return;

    // Stream público (regra `users/{uid}/patrocinadores/{id}` libera read pra todos).
    // Filtros aplicados em ordem:
    //  1. Tem `bannerSiteUrl` preenchido (970×90)
    //  2. Escopo de visibilidade (campeonatosVisivel / categoriasVisivel)
    //     bate com o contexto atual desta página
    const stream$: Observable<Patrocinador[]> = this.usersSrv
      .patrocinadoresDoOwner$(this.ownerId)
      .pipe(
        map((ps: Patrocinador[]) => {
          // Aceita patrocinadores que tenham OU o banner web (970×90 /
          // `bannerSiteUrl`) OU o banner mobile (640×200 /
          // `bannerSiteMobileUrl`). A escolha de qual imagem renderizar
          // (mobile vs web) é feita no template via getter `eMobile`.
          const comBanner = ps.filter(p => !!p.bannerSiteUrl || !!p.bannerSiteMobileUrl);
          const aprovados = comBanner.filter(p => this.respeitaEscopo(p));
          // Log de diagnóstico — ajuda a entender quando o usuário não vê
          // banner aparecer. Mostra quantos foram cortados pelo escopo.
          console.log('[BannerSite] contexto:', {
            ownerId: this.ownerId,
            campeonatoId: this.campeonatoId,
            categoriaId: this.categoriaId,
            variante: this.variante,
          });
          console.log('[BannerSite] resultado:', {
            totalPatrocinadores: ps.length,
            comBannerSite: comBanner.length,
            aprovadosNoEscopo: aprovados.length,
            descartadosPorEscopo: comBanner
              .filter(p => !this.respeitaEscopo(p))
              .map(p => ({
                nome: p.nome,
                campeonatosVisivel: p.campeonatosVisivel,
                categoriasVisivel: p.categoriasVisivel,
              })),
          });
          return aprovados;
        }),
        catchError(err => {
          console.warn('[BannerSite] falha ao carregar', err);
          return of([] as Patrocinador[]);
        }),
      );

    this.listSub = stream$.subscribe(ps => {
      this.banners = ps;
      this.indiceAtual = 0;
      this.iniciarRotacao();
      // OnPush: força re-render — sem isso o template não atualiza
      // quando o stream emite (banner some mesmo havendo dados).
      this.cdr.markForCheck();
    });
  }

  /**
   * Inicia (ou reinicia) a rotação dos banners. Cada banner usa seu
   * próprio `tempoBanner` (em segundos) — assim um patrocinador pode
   * pagar pra ficar 15s enquanto outro fica só 5s na rotação.
   *
   * Implementação com `setTimeout` recursivo em vez de `timer()` da RxJS
   * porque o intervalo MUDA a cada banner. RxJS timer() é fixo.
   */
  private iniciarRotacao(): void {
    this.pararRotacao();
    if (this.banners.length <= 1 || this.intervaloMs <= 0) return;
    this.agendarProximaRotacao();
  }

  /** Agenda o próximo flip baseado no `tempoBanner` do banner ATUAL. */
  private agendarProximaRotacao(): void {
    const atual = this.banners[this.indiceAtual];
    // Cada banner tem seu próprio tempo (em segundos). Fallback: intervaloMs.
    const segundosBanner = atual?.tempoBanner;
    const ms = segundosBanner != null && segundosBanner > 0
      ? Math.max(1000, segundosBanner * 1000) // mínimo 1s pra evitar loop infinito
      : this.intervaloMs;
    this.rotacaoTimeout = setTimeout(() => {
      this.indiceAtual = (this.indiceAtual + 1) % this.banners.length;
      this.cdr.markForCheck(); // OnPush precisa saber que o índice mudou
      this.agendarProximaRotacao();
    }, ms);
  }

  private pararRotacao(): void {
    if (this.rotacaoTimeout) {
      clearTimeout(this.rotacaoTimeout);
      this.rotacaoTimeout = undefined;
    }
  }

  /**
   * Aplica regras de visibilidade (mesma lógica do
   * `PatrocinadoresFaixaComponent.filtrarPorEscopo`):
   *
   * - Sem `campeonatosVisivel` nem `categoriasVisivel` → aparece sempre
   * - Com `campeonatosVisivel` → só aparece quando `campeonatoId` atual está na lista
   * - Com `categoriasVisivel` → só aparece quando o par "campId:catId" atual bate
   */
  private respeitaEscopo(p: Patrocinador): boolean {
    const escopoCamp = (p.campeonatosVisivel ?? []).filter(Boolean);
    const escopoCat  = (p.categoriasVisivel  ?? []).filter(Boolean);

    if (escopoCamp.length === 0 && escopoCat.length === 0) return true;

    if (escopoCat.length > 0 && !this.categoriaId) {
      if (escopoCamp.length > 0 && this.campeonatoId) {
        return escopoCamp.includes(this.campeonatoId);
      }
      return false;
    }
    if (escopoCamp.length > 0) {
      if (!this.campeonatoId) return false;
      if (!escopoCamp.includes(this.campeonatoId)) return false;
    }
    if (escopoCat.length > 0 && this.categoriaId && this.campeonatoId) {
      const par = `${this.campeonatoId}:${this.categoriaId}`;
      if (!escopoCat.includes(par)) return false;
    }
    return true;
  }

  /** Click no banner → abre link/site em nova aba quando definido. */
  abrirLink(p: Patrocinador, ev: Event): void {
    ev.stopPropagation();
    const url = p.link || p.site;
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  trackById(_i: number, p: Patrocinador): string { return p.id ?? `${_i}`; }
}
