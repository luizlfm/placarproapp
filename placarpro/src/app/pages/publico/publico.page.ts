import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { Categoria } from '../../campeonatos/categoria.model';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../campeonatos/categorias.service';
import { MidiasService } from '../../campeonatos/midias.service';
import { Midia, MidiaTipo } from '../../campeonatos/models/midia.model';
import { getModalidade } from '../../campeonatos/modalidades';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { ConvitesEquipeService, MeuConvite } from '../../campeonatos/convites-equipe.service';
import { EquipesService } from '../../campeonatos/equipes.service';
import { Equipe } from '../../campeonatos/models/equipe.model';
import { ModalController, ToastController } from '@ionic/angular';
import { ViewerModalComponent } from '../../shared/midia/viewer/viewer.modal';
import { firstValueFrom } from 'rxjs';
import { NavBackService } from '../../shared/nav-back.service';

/** Filtro disponível no chip-bar acima do grid de mídias. */
type FiltroMidia = 'todas' | MidiaTipo;
interface FiltroOpcao {
  id: FiltroMidia;
  label: string;
  icon: string;
}

type SecaoPub = 'inicio' | 'midia' | 'minha-equipe';

interface MenuItem {
  id: SecaoPub;
  label: string;
  icon: string;
}

/**
 * Página pública de um campeonato — não exige login.
 * URL: /:slug   (também aceita slug, shortCode ou id direto)
 *
 * Shell público com sidebar navy (igual ao admin) mas SOMENTE LEITURA:
 * - Sem botões de "editar", "adicionar", "configurações".
 * - Rodapé com "Fazer Login" pra organizadores.
 */
@Component({
  selector: 'app-publico',
  templateUrl: './publico.page.html',
  styleUrls: ['./publico.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PublicoPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campSrv = inject(CampeonatosService);
  private readonly catSrv = inject(CategoriasService);
  private readonly midiasSrv = inject(MidiasService);
  private readonly authSrv = inject(AuthService);
  private readonly usersSrv = inject(UsersService);
  private readonly convitesSrv = inject(ConvitesEquipeService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly navBack = inject(NavBackService);

  /** Viewport mobile? Detectado uma vez no boot + atualizado em resize.
   *  Usado pra escolher entre `logoUrl`/`logoMobileUrl` e
   *  `capaUrl`/`capaMobileUrl` quando o organizador subiu variante mobile. */
  ehMobile = false;

  /** Retorna o logo apropriado pra viewport atual — cai pro web se a
   *  variante mobile não foi cadastrada. */
  logoCamp(c: Campeonato | null | undefined): string | null {
    if (!c) return null;
    if (this.ehMobile && c.logoMobileUrl) return c.logoMobileUrl;
    return c.logoUrl ?? null;
  }

  /** Retorna a capa apropriada pra viewport. Considera também o campo
   *  legacy `bannerUrl` pra campeonatos antigos. */
  capaCamp(c: Campeonato | null | undefined): string | null {
    if (!c) return null;
    if (this.ehMobile && c.capaMobileUrl) return c.capaMobileUrl;
    return c.capaUrl ?? c.bannerUrl ?? null;
  }

  campeonato?: Campeonato;

  /** Convite vinculado ao usuário pra alguma equipe DESTE campeonato.
   *  Quando preenchido, exibe botão "Editar minha equipe" no sidebar. */
  conviteVinculado?: MeuConvite;
  /** Todas as fichas (convites) vinculadas ao usuário logado neste campeonato.
   *  Usado pela seção "Minha equipe" — pode ter mais de uma (uma por categoria). */
  convitesVinculados: MeuConvite[] = [];
  /** Map equipeId → Equipe (logo, nome, etc.) — carregado sob demanda para
   *  exibir o escudo do clube no card de "Minha equipe". */
  equipesMap: Record<string, Equipe> = {};
  categorias$: Observable<Categoria[]> = of([]);
  midias$: Observable<Midia[]> = of([]);
  /** Lista de mídias já filtrada pelo chip selecionado. */
  midiasFiltradas$: Observable<Midia[]> = of([]);
  /** Contadores por tipo — usado nos chips do filtro. */
  contadores$: Observable<Record<FiltroMidia, number>> = of({
    todas: 0, foto: 0, video: 0, youtube: 0, noticia: 0, link: 0,
  });
  /** Filtro atual (usuário clica nos chips). */
  readonly filtroMidia$ = new BehaviorSubject<FiltroMidia>('todas');
  /** Opções renderizadas no chip-bar (ordem fixa). */
  readonly filtros: FiltroOpcao[] = [
    { id: 'todas',   label: 'Todas',    icon: 'apps-outline' },
    { id: 'foto',    label: 'Fotos',    icon: 'image-outline' },
    { id: 'video',   label: 'Vídeos',   icon: 'film-outline' },
    { id: 'youtube', label: 'YouTube',  icon: 'logo-youtube' },
    { id: 'noticia', label: 'Notícias', icon: 'newspaper-outline' },
    { id: 'link',    label: 'Links',    icon: 'globe-outline' },
  ];

  loading = true;
  erro = false;
  segue = false;
  secao: SecaoPub = 'inicio';

  readonly menu: MenuItem[] = [
    { id: 'inicio', label: 'Início',                 icon: 'home-outline'   },
    { id: 'midia',  label: 'Fotos, Vídeos e notícias', icon: 'images-outline' },
  ];

  async ngOnInit(): Promise<void> {
    // Detecta viewport (≤ 767px = mobile) e mantém sincronizado em resize.
    // Não usa ChangeDetectorRef pq esta página NÃO é OnPush — Angular já
    // ronda detection no próximo tick após o evento DOM.
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(max-width: 767px)');
      this.ehMobile = mql.matches;
      mql.addEventListener('change', ev => { this.ehMobile = ev.matches; });
    }
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    if (!slug) {
      this.erro = true;
      this.loading = false;
      return;
    }
    try {
      const c = await this.campSrv.getBySlug(slug);
      if (!c) {
        this.erro = true;
        return;
      }
      if (c.publico === false) {
        this.erro = true;
        return;
      }
      this.campeonato = c;
      this.categorias$ = this.catSrv.list$(c.id!);
      // Mídias do nível do campeonato (campeonatos/{id}/midias).
      // Cobrimos com `catchError` pra evitar que rejeições silenciosas das
      // Firestore Rules quebrem a página inteira.
      this.midias$ = this.midiasSrv.list$(c.id!).pipe(
        catchError(err => {
          console.warn('[Publico] falhou ao listar mídias', err);
          return of([] as Midia[]);
        }),
      );
      // Contadores por tipo — base para os chips do filtro.
      this.contadores$ = this.midias$.pipe(
        map(mds => this.calcularContadores(mds)),
      );
      // Lista filtrada — atualiza quando o usuário muda o chip OU quando
      // novas mídias chegam pelo realtime.
      this.midiasFiltradas$ = combineLatest([this.midias$, this.filtroMidia$]).pipe(
        map(([mds, f]) => (f === 'todas' ? mds : mds.filter(m => m.tipo === f))),
      );

      if (this.authSrv.currentUser && c.id) {
        const sub = this.usersSrv.segue$(c.id).subscribe(v => {
          this.segue = v;
          setTimeout(() => sub.unsubscribe(), 0);
        });

        // Verifica se o usuário tem convite vinculado para ESTE campeonato.
        // Se sim, ativa o item "Minha equipe" no menu lateral e a seção interna.
        const subC = this.convitesSrv
          .listMeusConvites$(this.authSrv.currentUser.uid)
          .subscribe(convites => {
            this.convitesVinculados = convites.filter(cv => cv.campeonatoId === c.id);
            this.conviteVinculado = this.convitesVinculados[0];
            // Carrega dados das equipes (logo, cidade, etc) pra renderizar
            // o escudo nos cards de "Minha equipe". Dispara em paralelo, sem
            // bloquear a renderização da página.
            void this.carregarEquipesDosConvites();
            setTimeout(() => subC.unsubscribe(), 0);
          });
      }
    } catch (err) {
      console.error('[Publico] erro', err);
      this.erro = true;
    } finally {
      this.loading = false;
    }
  }

  /** Navega pro form de inscrição/edição da equipe do convite vinculado. */
  abrirInscricao(): void {
    if (!this.conviteVinculado) return;
    this.router.navigate(['/inscricao', this.conviteVinculado.token]);
  }

  /**
   * Abre o form de edição de uma ficha. Tentativa anterior com iframe ficava
   * em loop "Carregando convite..." — provável race condition entre Firebase
   * Auth e Firestore Rules dentro do iframe. Voltamos pra navegação direta;
   * o NavBackService garante que o usuário retorna pra cá ao clicar voltar.
   *
   * Passamos `from=publico` na query pra a inscricao saber que precisa
   * voltar pra cá ao concluir (ou cancelar).
   */
  async editarFicha(token: string): Promise<void> {
    if (!token) return;
    await this.router.navigate(['/inscricao', token], {
      queryParams: { from: 'publico', slug: this.route.snapshot.paramMap.get('slug') ?? '' },
    });
  }

  /**
   * Busca dados de cada equipe vinculada para popular `equipesMap`, usado
   * pra exibir o escudo do clube nos cards. Falhas silenciosas (se o usuário
   * não tem permissão de leitura em alguma equipe, ela simplesmente fica
   * sem logo — não quebra o resto da tela).
   */
  private async carregarEquipesDosConvites(): Promise<void> {
    if (!this.convitesVinculados.length) return;
    const promises = this.convitesVinculados.map(async cv => {
      try {
        const eq = await firstValueFrom(
          this.equipesSrv.get$(cv.campeonatoId, cv.categoriaId, cv.equipeId),
        );
        if (eq) {
          this.equipesMap = { ...this.equipesMap, [cv.equipeId]: eq };
        }
      } catch (err) {
        console.warn('[Publico] erro ao carregar equipe', cv.equipeId, err);
      }
    });
    await Promise.allSettled(promises);
  }

  /** Helper p/ template: retorna a equipe carregada para um convite (ou undefined). */
  equipeDoConvite(cv: MeuConvite): Equipe | undefined {
    return this.equipesMap[cv.equipeId];
  }

  selecionarSecao(s: SecaoPub): void {
    this.secao = s;
  }

  modalidadeOf(c: Categoria) {
    return getModalidade(c.modalidade);
  }

  /** Pull-to-refresh: arrasta pra baixo pra recarregar a tela. Usa
   *  `location.reload()` como solução simples e universal — recarrega
   *  dados, imagens e CSS atualizados sem precisar reinscrever em cada
   *  observable individualmente. */
  async onRefresh(ev: CustomEvent): Promise<void> {
    try {
      window.location.reload();
    } finally {
      const target = ev?.target as { complete?: () => void } | null;
      target?.complete?.();
    }
  }

  async clickSeguir(): Promise<void> {
    if (!this.authSrv.currentUser) {
      const slug = this.route.snapshot.paramMap.get('slug') ?? '';
      await this.router.navigate(['/login'], { queryParams: { returnUrl: `/${slug}` } });
      return;
    }
    const id = this.campeonato?.id;
    if (!id) return;
    try {
      if (this.segue) {
        await this.usersSrv.deixarDeSeguir(id);
        try { await this.campSrv.ajustarContadorSeguidores(id, -1); } catch { /* ignore */ }
        this.segue = false;
        await this.toast('Você deixou de seguir.', 'success');
      } else {
        await this.usersSrv.seguir(id);
        try { await this.campSrv.ajustarContadorSeguidores(id, +1); } catch { /* ignore */ }
        this.segue = true;
        await this.toast('Pronto! Você está seguindo.', 'success');
      }
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  async compartilhar(): Promise<void> {
    if (!this.campeonato) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: this.campeonato.titulo,
          text: 'Acompanhe este campeonato no PlacarPro',
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        await this.toast('Link copiado!', 'success');
      }
    } catch { /* cancelado */ }
  }

  abrirCategoria(c: Categoria): void {
    if (!c.id || !this.campeonato?.id) return;
    const slug = this.route.snapshot.paramMap.get('slug') ?? this.campeonato.id;
    this.router.navigate(['/', slug, 'categoria', c.id]);
  }

  fazerLogin(): void {
    // Passa a URL atual como returnUrl pra voltar pro mesmo campeonato após login
    this.router.navigate(['/login'], {
      queryParams: { returnUrl: this.router.url },
    });
  }

  /** Logout — volta pra home pública (tela principal). */
  async sair(): Promise<void> {
    try {
      await this.authSrv.signOut();
      // Vai pra home pública. replaceUrl: true evita que o usuário "volte"
      // de Histórico para esta tela já deslogada.
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      console.error('[Publico] signOut erro', err);
    }
  }

  /** Helper template — true se o user está logado. */
  get estaLogado(): boolean {
    return !!this.authSrv.currentUser;
  }
  /** Nome exibível do user logado (displayName, ou email truncado). */
  get nomeUsuarioLogado(): string {
    const u = this.authSrv.currentUser;
    if (!u) return '';
    if (u.displayName) return u.displayName;
    if (u.email) return u.email.split('@')[0];
    return 'Usuário';
  }
  /** Inicial pra avatar fallback (1 char). */
  get inicialUsuario(): string {
    return (this.nomeUsuarioLogado.charAt(0) || '?').toUpperCase();
  }
  /** Foto do user (Google etc), ou null. */
  get fotoUsuario(): string | null {
    return this.authSrv.currentUser?.photoURL ?? null;
  }

  voltarHome(): void {
    this.router.navigate(['/']);
  }

  /**
   * Botão "Voltar" do header / sidebar.
   *
   * Usa NavBackService → tenta voltar pra TELA ANTERIOR REAL (histórico
   * do browser). Antes ia hardcoded pra `/espectador` se logado, o que
   * "sequestrava" o fluxo: usuário que veio da Home pública clicando em
   * um campeonato esperava voltar pra Home, não pra Minhas Equipes.
   *
   * Fallback (acesso direto via URL / bookmark / refresh — sem histórico):
   *  - Logado  → `/espectador` (faz sentido como destino padrão)
   *  - Anônimo → `/`           (home pública)
   */
  voltarParaMinhasEquipes(): void {
    const fallback = this.estaLogado ? '/espectador' : '/';
    this.navBack.back(fallback);
  }

  trackById(_i: number, c: Categoria): string {
    return c.id ?? '';
  }

  // ───────────────────────────── Mídias ─────────────────────────────

  /** Seleciona um filtro (chip-bar acima do grid). */
  selecionarFiltro(f: FiltroMidia): void {
    this.filtroMidia$.next(f);
  }

  /** Calcula quantas mídias de cada tipo existem na lista. */
  private calcularContadores(mds: Midia[]): Record<FiltroMidia, number> {
    const c: Record<FiltroMidia, number> = {
      todas: mds.length, foto: 0, video: 0, youtube: 0, noticia: 0, link: 0,
    };
    for (const m of mds) c[m.tipo]++;
    return c;
  }

  trackByMidia(_i: number, m: Midia): string {
    return m.id ?? `${_i}`;
  }

  trackByFiltro(_i: number, f: FiltroOpcao): string {
    return f.id;
  }

  thumbMidia(m: Midia): string | null {
    if (m.tipo === 'foto') return m.arquivoUrl ?? null;
    if (m.tipo === 'noticia') return m.capaUrl ?? null;
    if (m.tipo === 'youtube' && m.youtubeId) {
      return `https://i.ytimg.com/vi/${m.youtubeId}/hqdefault.jpg`;
    }
    return null;
  }

  iconeMidia(t: Midia['tipo']): string {
    switch (t) {
      case 'foto':    return 'image-outline';
      case 'video':   return 'film-outline';
      case 'youtube': return 'logo-youtube';
      case 'link':    return 'globe-outline';
      case 'noticia': return 'newspaper-outline';
    }
  }

  labelMidia(t: Midia['tipo']): string {
    switch (t) {
      case 'foto':    return 'Foto';
      case 'video':   return 'Vídeo';
      case 'youtube': return 'YouTube';
      case 'link':    return 'Link';
      case 'noticia': return 'Notícia';
    }
  }

  /**
   * Click no card: abre o `ViewerModalComponent` por cima da página. O viewer
   * trata cada tipo de mídia internamente (foto/vídeo/youtube embed/notícia/link),
   * então não saímos da tela atual.
   */
  async abrirMidia(m: Midia): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ViewerModalComponent,
      componentProps: { midia: m },
      cssClass: 'midia-viewer-modal',
    });
    await modal.present();
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }
}
