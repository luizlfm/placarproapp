import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, startWith, tap } from 'rxjs/operators';
import { Patrocinador } from '../../../users/models/patrocinador.model';
import { UsersService } from '../../../users/users.service';

/**
 * Faixa horizontal de patrocinadores para exibir nas páginas públicas.
 *
 * Modos de exibição:
 *  - **MOBILE** (≤ 600px): SEMPRE rotativo — 1 banner por vez, troca
 *    a cada `intervaloMs` (default 5s). Não importa quantos banners.
 *  - **DESKTOP** (> 600px): tenta mostrar todos numa linha só. Se a
 *    largura da viewport não comporta (cards quebrariam pra 2ª linha
 *    ou mais), vira rotativo automaticamente — exibindo UMA LINHA POR
 *    VEZ (N cards = quantos cabem na largura atual), trocando de
 *    "página" a cada `intervaloMs`. Assim nunca aparece quebra feia
 *    nem desperdícia espaço horizontal mostrando 1 banner solto.
 *
 * Detecção da quebra: medimos `scrollHeight` do scroller — se passar de
 * UMA_LINHA + tolerância, sabemos que a grid wrappou (auto-fill faz isso
 * silenciosamente, sem gerar overflow horizontal).
 *
 * Regras de filtragem (escopo) seguem inalteradas — vide docstring antiga.
 */
@Component({
  selector: 'app-patrocinadores-faixa',
  templateUrl: './patrocinadores-faixa.component.html',
  styleUrls: ['./patrocinadores-faixa.component.scss'],
  standalone: false,
})
export class PatrocinadoresFaixaComponent
  implements OnChanges, AfterViewInit, OnDestroy
{
  @Input() ownerId = '';
  @Input() campeonatoId?: string;
  @Input() categoriaId?: string;
  @Input() titulo = 'Apoios e Patrocinadores';
  @Input() variante: 'claro' | 'escuro' = 'claro';
  /** Tempo em ms entre rotações automáticas. Patrocinadores com
   *  `tempoBanner` configurado (em segundos) sobrescrevem esse valor
   *  individualmente. */
  @Input() intervaloMs = 5000;

  private readonly usersSrv = inject(UsersService);

  @ViewChild('scroller') scrollerRef?: ElementRef<HTMLElement>;

  patrocinadores$: Observable<Patrocinador[]> = of([]);
  /** Cache local da lista mais recente — usada pra decidir rotação. */
  listaAtual: Patrocinador[] = [];

  /** True quando o modo "rotativo" está ativo (mobile OU desktop com
   *  cards que não caberiam em uma linha). */
  rotativoAtivo = false;
  /** Índice do banner visível quando rotativo em modo mobile (1 por vez). */
  indiceAtual = 0;
  /** Offset do PRIMEIRO card visível em desktop quando rotativo. A cada
   *  tick incrementa em 1 (não em `cardsPorPagina`) — assim os cards
   *  deslizam continuamente em loop e TODOS aparecem rotacionando, sem
   *  o efeito anterior de "só o último card trocava enquanto os outros
   *  ficavam estáticos". */
  paginaAtual = 0;
  /** Quantos cards cabem numa linha — calculado a partir da largura do
   *  scroller e do tamanho de cada card. Vai pra 1 no mobile. */
  cardsPorPagina = 1;

  /** True quando o modo "marquee" (carrossel contínuo) deve ser usado.
   *  Ativa em mobile E desktop sempre que houver mais de 1 patrocinador
   *  rotacionando — cards deslizam continuamente, sem pausa nem dots. */
  get usarMarquee(): boolean {
    return this.rotativoAtivo && this.listaAtual.length > 1;
  }

  /** Duração da animação marquee em segundos — 4s por card. Mais cards
   *  = animação mais longa pra manter a velocidade visual constante
   *  (caso contrário, com 20 cards ficaria absurdamente rápido). */
  get marqueeDuration(): string {
    const segundosPorCard = 4;
    return `${this.listaAtual.length * segundosPorCard}s`;
  }
  /** True quando viewport é ≤767px — usado pra escolher entre banner
   *  app web (805×453) e mobile (1:1). Atualizado no resize. */
  ehMobile = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 767px)').matches
    : false;

  /** Helper template — retorna o banner correto pro viewport atual.
   *  Mobile: bannerAppMobileUrl (380×126 — 3:1) → fallback bannerAppUrl → logoUrl.
   *  Web:    bannerAppUrl (805×453 — 16:9) → fallback bannerAppMobileUrl → logoUrl. */
  bannerAppParaViewport(p: Patrocinador): string {
    if (this.ehMobile) {
      return p.bannerAppMobileUrl || p.bannerAppUrl || p.logoUrl || '';
    }
    return p.bannerAppUrl || p.bannerAppMobileUrl || p.logoUrl || '';
  }

  private rotacaoTimeout?: ReturnType<typeof setTimeout>;
  /** Observer pra detectar quando o scroller ganha/muda dimensões — sem ele,
   *  navegar entre seções (`*ngIf` no parent destruindo/recriando este
   *  componente) deixava a rotação inativa porque `atualizarModoRotativo()`
   *  rodava com `scrollHeight === 0` antes do layout estar pronto. */
  private resizeObserver?: ResizeObserver;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['ownerId'] || changes['campeonatoId'] || changes['categoriaId']) {
      this.patrocinadores$ = this.ownerId
        ? this.usersSrv.patrocinadoresDoOwner$(this.ownerId).pipe(
            map(list => this.filtrarPorEscopo(list)),
            // Cacheia a lista pra decidir rotação depois do render
            tap(list => {
              this.listaAtual = list;
              this.indiceAtual = 0;
              this.paginaAtual = 0;
              // Reavalia rotação em múltiplos ticks — o primeiro vai
              // catch o cenário "DOM pronto", os subsequentes garantem
              // que pegamos depois que imagens carregaram (que mudam
              // o layout final). Sem isso, navegar entre seções deixava
              // rotativoAtivo=false até refresh manual.
              setTimeout(() => this.atualizarModoRotativo(), 0);
              setTimeout(() => this.atualizarModoRotativo(), 100);
              setTimeout(() => this.atualizarModoRotativo(), 400);
            }),
            startWith<Patrocinador[]>([]),
            catchError(err => {
              console.warn('[PatrocinadoresFaixa] erro ao carregar', err);
              return of<Patrocinador[]>([]);
            }),
          )
        : of([]);
    }
  }

  ngAfterViewInit(): void {
    // Avaliação imediata após primeiro render
    setTimeout(() => this.atualizarModoRotativo(), 50);

    // ResizeObserver: dispara sempre que o scroller mudar de tamanho —
    // inclui o caso de "componente acabou de ser recriado e o layout
    // ainda não estava pronto no setTimeout 50ms". Mais robusto que
    // confiar em timeouts fixos.
    if (typeof ResizeObserver !== 'undefined' && this.scrollerRef) {
      this.resizeObserver = new ResizeObserver(() => {
        this.atualizarModoRotativo();
      });
      this.resizeObserver.observe(this.scrollerRef.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.pararRotacao();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.ehMobile = window.matchMedia('(max-width: 767px)').matches;
    this.atualizarModoRotativo();
  }

  /**
   * Decide se ativa o modo rotativo e calcula quantos cards cabem por
   * linha (= por "página" do carrossel):
   *  - Mobile (≤ 600px): SEMPRE rotativo, 1 card por página.
   *  - Desktop: cálculo matemático direto a partir da largura do
   *    scroller — `cardsPorLinha = floor((width + gap) / (cardW + gap))`.
   *    Se `total > cardsPorLinha`, ativa rotativo. Mais robusto que
   *    medir `scrollHeight` (que pode estar zerado em momentos
   *    transitórios — ex: componente recém-criado, imagens ainda
   *    carregando, navegação entre seções).
   */
  private atualizarModoRotativo(): void {
    const ehMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
    let novoModo = false;
    let cardsPorPag = 1;

    if (ehMobile && this.listaAtual.length >= 1) {
      novoModo = true;
      cardsPorPag = 1;
    } else if (this.scrollerRef) {
      const el = this.scrollerRef.nativeElement;
      const larguraScroller = el.clientWidth;
      if (larguraScroller > 0) {
        // Sincronizado com .pf-scroller no SCSS: `grid-template-columns:
        // repeat(auto-fill, minmax(180px, 180px))`, `gap: 10px`. Cada
        // card ocupa 180+10 = 190px efetivos, mas o gap só conta entre
        // cards, então a fórmula é `floor((W + gap) / (cardW + gap))`.
        const CARD_W = 180;
        const GAP = 10;
        cardsPorPag = Math.max(
          1,
          Math.floor((larguraScroller + GAP) / (CARD_W + GAP)),
        );
        novoModo = this.listaAtual.length > cardsPorPag;
      }
    }

    const mudou = novoModo !== this.rotativoAtivo;
    this.rotativoAtivo = novoModo;
    this.cardsPorPagina = Math.max(1, cardsPorPag);

    // Reajusta paginaAtual se o offset ficou fora do range (ex: lista
    // diminuiu ou modo mudou).
    const totalPag = this.totalPaginas();
    if (totalPag > 0 && this.paginaAtual >= totalPag) {
      this.paginaAtual = this.paginaAtual % totalPag;
    }

    if (this.rotativoAtivo && totalPag > 1) {
      this.iniciarRotacao();
    } else {
      this.pararRotacao();
    }

    // Se mudou pra ativo, reseta posição
    if (mudou && this.rotativoAtivo) {
      this.indiceAtual = 0;
      this.paginaAtual = 0;
    }
  }

  /** Quantos "estados" o carrossel tem no modo atual.
   *  - Mobile (1 por vez): total de cards.
   *  - Desktop (shift contínuo): total de cards (loop completo de N ticks).
   *  - Não rotativo: 1. */
  totalPaginas(): number {
    if (!this.rotativoAtivo) return 1;
    return this.listaAtual.length;
  }

  /** True se o card `i` deve estar visível com o offset atual.
   *
   *  Em modo NÃO rotativo, todos ficam visíveis.
   *
   *  Em modo rotativo com `cardsPorPagina > 1` (desktop com várias
   *  linhas), usamos um RANGE CIRCULAR a partir do `offsetAtual`
   *  (=`paginaAtual`). A cada tick o offset incrementa em 1 → todos
   *  os cards passam pela linha visível ao longo do loop, num efeito
   *  de carrossel contínuo. Ex: 6 cards, N=5:
   *    offset=0 → 0,1,2,3,4
   *    offset=1 → 1,2,3,4,5
   *    offset=2 → 2,3,4,5,0
   *    ...
   *    offset=5 → 5,0,1,2,3 → e volta. */
  cardVisivel(i: number): boolean {
    if (!this.rotativoAtivo) return true;
    if (this.cardsPorPagina === 1) return i === this.indiceAtual;

    const total = this.listaAtual.length;
    const N = this.cardsPorPagina;
    if (total === 0) return false;

    const start = this.paginaAtual % total;
    for (let k = 0; k < N; k++) {
      if ((start + k) % total === i) return true;
    }
    return false;
  }

  /** Inicia a rotação automática.
   *  - Modo "1 por vez" (mobile): respeita o `tempoBanner` individual de
   *    cada patrocinador (com fallback pro intervaloMs default).
   *  - Modo "marquee" (desktop com várias linhas): animação CSS toma
   *    conta — NÃO inicia timer JS aqui pra evitar conflito.
   */
  private iniciarRotacao(): void {
    this.pararRotacao();
    if (this.totalPaginas() <= 1) return;
    // Marquee é puramente CSS — não precisa de timer JS.
    if (this.usarMarquee) return;
    this.agendarProximaRotacao();
  }

  private agendarProximaRotacao(): void {
    let ms = this.intervaloMs;
    const total = this.listaAtual.length;

    if (this.cardsPorPagina === 1) {
      // Modo mobile / 1-por-vez: respeita tempoBanner individual.
      const atual = this.listaAtual[this.indiceAtual];
      const seg = atual?.tempoBanner;
      if (seg != null && seg > 0) ms = Math.max(1000, seg * 1000);
    } else {
      // Modo carrossel contínuo (shift de 1 card por tick): usa o
      // `tempoBanner` do PRÓXIMO card que vai entrar — assim o intervalo
      // dá tempo do "novato" ser lido antes de sair de cena.
      const idxQueEntra = (this.paginaAtual + this.cardsPorPagina) % total;
      const seg = this.listaAtual[idxQueEntra]?.tempoBanner ?? 0;
      if (seg > 0) ms = Math.max(1000, seg * 1000);
    }

    this.rotacaoTimeout = setTimeout(() => {
      if (this.cardsPorPagina === 1) {
        this.indiceAtual = (this.indiceAtual + 1) % total;
      } else {
        // Shift de 1 card por tick — todos passam pela linha em loop.
        this.paginaAtual = (this.paginaAtual + 1) % total;
      }
      this.agendarProximaRotacao();
    }, ms);
  }

  private pararRotacao(): void {
    if (this.rotacaoTimeout) {
      clearTimeout(this.rotacaoTimeout);
      this.rotacaoTimeout = undefined;
    }
  }

  /** Clicou num dot indicador → pula pro banner/página correspondente e
   *  reinicia o cronômetro. */
  irPara(idx: number): void {
    if (idx < 0) return;
    if (this.cardsPorPagina === 1) {
      if (idx >= this.listaAtual.length) return;
      this.indiceAtual = idx;
    } else {
      if (idx >= this.totalPaginas()) return;
      this.paginaAtual = idx;
    }
    if (this.rotativoAtivo) {
      this.iniciarRotacao();
    }
  }

  /** Order CSS de cada card — REORDENA visualmente conforme o offset
   *  atual vai avançando. O card no offset `start` fica com order=0
   *  (primeiro da linha), o próximo order=1, e assim por diante. Cards
   *  fora da página caem em ordens >= N (`display: none` cuida deles). */
  ordemCard(i: number): number {
    if (!this.rotativoAtivo || this.cardsPorPagina === 1) return i;
    const total = this.listaAtual.length;
    if (total === 0) return i;
    const start = this.paginaAtual % total;
    return ((i - start) % total + total) % total;
  }

  /** Array de dots — 1 por card (em ambos os modos agora). */
  paginas(): number[] {
    return Array.from({ length: this.listaAtual.length }, (_, i) => i);
  }

  /** Índice ativo nos dots — em desktop, o "primeiro visível" da linha
   *  representa o ponto atual do loop. */
  indiceAtivoDots(): number {
    return this.cardsPorPagina === 1 ? this.indiceAtual : this.paginaAtual;
  }

  // ============== Filtros de escopo (inalterados) ==============

  private filtrarPorEscopo(lista: Patrocinador[]): Patrocinador[] {
    return lista.filter(p => {
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
    });
  }

  /** Trata erro de carregamento de imagem do banner — substitui pelo
   *  ícone megafone (data URI SVG) pra não aparecer o "broken image"
   *  feio do browser. Acontece quando a URL do Storage expirou, foi
   *  removida ou tem CORS restritivo. */
  onImgErro(ev: Event): void {
    const img = ev.target as HTMLImageElement;
    // SVG inline minimalista com fundo neutro + ícone megafone
    img.src =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
          <rect width="64" height="64" fill="#f4f4f6"/>
          <path d="M14 28v8h6l14 8V20l-14 8h-6z" fill="#9ca3af"/>
        </svg>`,
      );
    img.style.objectFit = 'contain';
  }

  abrirLink(p: Patrocinador, ev: Event): void {
    const url = p.link || p.site;
    if (!url) return;
    ev.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  trackById(_i: number, p: Patrocinador): string {
    return p.id ?? '';
  }

  trackByIdx(i: number): number {
    return i;
  }

  rotuloTipo(t?: Patrocinador['tipo']): string {
    switch (t) {
      case 'apoiador': return 'Apoiador';
      case 'organizador': return 'Organizador';
      default: return 'Patrocinador';
    }
  }
}
