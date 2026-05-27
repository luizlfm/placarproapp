import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';

@Component({
  selector: 'app-home-publica',
  templateUrl: './home-publica.page.html',
  styleUrls: ['./home-publica.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class HomePublicaPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly campSrv = inject(CampeonatosService);
  private readonly authSrv = inject(AuthService);
  private readonly usersSrv = inject(UsersService);

  /** Cache pra não rodar migração mais de uma vez por id. */
  private migrados = new Set<string>();
  private migSub?: Subscription;
  private segSub?: Subscription;

  /** IDs dos campeonatos que o usuário logado segue. Atualizado em tempo
   *  real via `seguindoIds$`. Quando vazio (deslogado), o filtro
   *  "Apenas seguindo" fica indisponível na UI. */
  seguindoIds = new Set<string>();

  /** Toggle do chip "Apenas seguindo" — só faz sentido pra usuário logado. */
  apenasSeguindo = false;

  /**
   * Lista exibida: junta os campeonatos públicos (visíveis pra todo mundo)
   * com OS CAMPEONATOS DO USUÁRIO LOGADO (independente do flag publico).
   *
   * Justificativa: se eu (organizador) entro logado na home pública, quero
   * ver os meus campeonatos aqui — mesmo se eu tiver deixado algum privado.
   * Visitantes anônimos só veem os marcados como públicos.
   *
   * IMPORTANTE: usamos `listTodosVisiveis$()` em vez de `listPublicos$()`
   * porque a versão estrita `where('publico', '==', true)` EXCLUI campeonatos
   * legacy (cadastrados antes do campo `publico` existir, valor `undefined`).
   * O cliente filtra `publico !== false` — assim legacy entra como público.
   */
  readonly campeonatos$: Observable<Campeonato[]> = this.authSrv.user$.pipe(
    switchMap(user => {
      const publicos$ = this.campSrv.listTodosVisiveis$().pipe(
        startWith([] as Campeonato[]),
        catchError(err => {
          console.error('[HomePublica] listTodosVisiveis erro', err);
          return of([] as Campeonato[]);
        }),
      );
      if (!user) return publicos$;
      // Logado: junta com listMeus$
      return combineLatest([
        publicos$,
        this.campSrv.listMeus$().pipe(
          startWith([] as Campeonato[]),
          catchError(err => {
            console.error('[HomePublica] listMeus erro', err);
            return of([] as Campeonato[]);
          }),
        ),
      ]).pipe(
        map(([pubs, meus]) => {
          const ids = new Set<string>();
          const out: Campeonato[] = [];
          // Meus primeiro (UX: organizador vê o que é dele no topo).
          // Filtra privados — campeonato marcado como privado não deve
          // aparecer na home pública mesmo pro próprio dono logado.
          for (const c of meus) {
            if (c.id && !ids.has(c.id) && c.publico !== false) {
              ids.add(c.id);
              out.push(c);
            }
          }
          for (const c of pubs) {
            if (c.id && !ids.has(c.id)) {
              ids.add(c.id);
              out.push(c);
            }
          }
          return out;
        }),
      );
    }),
  );

  /** Termo de busca livre (filtra cliente-side). */
  busca = '';

  /**
   * Auto-migração retroativa: quando um usuário logado visita a home,
   * percorre OS CAMPEONATOS DELE e seta `publico: true` em quem está sem
   * o flag (legado, criado antes do campo existir). Idempotente.
   *
   * Isso garante que, após o organizador entrar pela 1ª vez no app, seus
   * campeonatos antigos passem a aparecer pra visitantes anônimos.
   */
  ngOnInit(): void {
    this.migSub = this.authSrv.user$
      .pipe(
        switchMap(user => (user ? this.campSrv.listMeus$() : of([] as Campeonato[]))),
      )
      .subscribe(list => {
        for (const c of list) {
          if (!c.id || this.migrados.has(c.id)) continue;
          this.migrados.add(c.id);
          if (c.publico === undefined) {
            this.campSrv
              .atualizar(c.id, { publico: true })
              .catch(err => console.error('[HomePublica] migração publico erro', err));
          }
        }
      });

    // Stream dos IDs que o usuário segue — atualiza o Set local pra refletir
    // em tempo real no filtro "Apenas seguindo" e em qualquer indicador visual.
    this.segSub = this.usersSrv.seguindoIds$().pipe(
      catchError(() => of([] as string[])),
    ).subscribe(ids => {
      this.seguindoIds = new Set(ids);
      // Se o usuário fez logout e o filtro estava ativo, reseta pra evitar
      // ficar com a lista vazia sem motivo aparente.
      if (this.seguindoIds.size === 0) this.apenasSeguindo = false;
    });
  }

  ngOnDestroy(): void {
    this.migSub?.unsubscribe();
    this.segSub?.unsubscribe();
  }

  get estaLogado(): boolean {
    return !!this.authSrv.currentUser;
  }

  abrir(c: Campeonato): void {
    const id = c.slug || c.shortCode || c.id;
    if (!id) return;
    this.router.navigate(['/', id]);
  }

  /**
   * Navega DIRETO pra tela pública da transmissão ao vivo —
   * /transmissao/{campId}/{catId}/{jogoId}.
   *
   * Lê os IDs da flag `transmissaoLiveAtiva` no campeonato (denormalizada
   * pelo broadcaster ao iniciar). `stopPropagation` impede o clique de
   * subir pro card pai.
   */
  assistirAoVivo(c: Campeonato, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    const live = c.transmissaoLiveAtiva;
    if (!live || !c.id) return;
    this.router.navigate([
      '/transmissao',
      c.id,
      live.categoriaId,
      live.jogoId,
    ]);
  }

  irParaLogin(): void {
    this.router.navigate(['/login']);
  }

  /**
   * "Entrar no PlacarPro" da seção de Racha — vai pro login já selecionando
   * o tipo 'racha' como padrão (assim o usuário não precisa clicar nos cards).
   * Persiste em localStorage pra a página de login restaurar.
   */
  entrarNoRacha(): void {
    try { localStorage.setItem('placarpro_tipo_login', 'racha'); } catch { /* ignore */ }
    this.router.navigate(['/login']);
  }

  /**
   * "Criar racha grátis" — vai pra signup com tipo 'racha' pré-selecionado.
   * Se já tiver logado COMO racha, leva direto pra /racha/novo.
   */
  criarRacha(): void {
    const ehRacha = this.ehRacha;
    if (ehRacha) {
      this.router.navigate(['/racha/novo']);
      return;
    }
    try { localStorage.setItem('placarpro_tipo_login', 'racha'); } catch { /* ignore */ }
    this.router.navigate(['/cadastro']);
  }

  /** True quando o usuário logado é do tipo racha (lê do localStorage). */
  get ehRacha(): boolean {
    try {
      return localStorage.getItem('placarpro_tipo_login') === 'racha' && this.estaLogado;
    } catch { return false; }
  }

  /** True quando o usuário logado escolheu "Sou Espectador" no login. */
  get ehEspectador(): boolean {
    try {
      return localStorage.getItem('placarpro_tipo_login') === 'cliente';
    } catch { return false; }
  }

  /** Logout do espectador — limpa auth e navega pra home pública (esta tela). */
  async sair(): Promise<void> {
    try {
      await this.authSrv.signOut();
      // Já estamos na home; navegueByUrl com replaceUrl força refresh de
      // estado sem reload completo da página (mantém SPA).
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      console.error('[HomePublica] signOut erro', err);
    }
  }

  irParaCadastro(): void {
    this.router.navigate(['/cadastro']);
  }

  /** "Meu painel" leva o organizador pra área admin. Espectadores não
   *  precisam disso — pra eles, a própria home pública JÁ é o "painel". */
  irParaPainel(): void {
    if (this.ehEspectador) {
      // Espectador permanece na home; mostra um toast / scrolla pra lista
      const el = document.querySelector('#campeonatos');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    this.router.navigate(['/app/meus-campeonatos']);
  }

  filtrar(lista: Campeonato[] | null): Campeonato[] {
    if (!lista) return [];
    let out = lista;
    // 1) Filtro "Apenas seguindo" (só se logado e com pelo menos 1 seguido).
    if (this.apenasSeguindo && this.seguindoIds.size > 0) {
      out = out.filter(c => !!(c.id && this.seguindoIds.has(c.id)));
    }
    // 2) Filtro por busca (nome/subtitulo/descricao)
    const t = this.busca.trim().toLowerCase();
    if (!t) return out;
    return out.filter(c =>
      (c.titulo ?? '').toLowerCase().includes(t) ||
      (c.subtitulo ?? '').toLowerCase().includes(t) ||
      (c.descricao ?? '').toLowerCase().includes(t),
    );
  }

  /** Sempre mostra os chips de filtro — dá descoberta da feature mesmo
   *  pra deslogados (que verão o "Que sigo" e podem clicar pra logar). */
  get podeFiltrarSeguindo(): boolean {
    return true;
  }

  /** Quantidade de campeonatos seguidos — exibido no chip pra dar contexto. */
  get qtdSeguindo(): number {
    return this.seguindoIds.size;
  }

  toggleApenasSeguindo(): void {
    this.apenasSeguindo = !this.apenasSeguindo;
  }

  /**
   * Chamado ao clicar no chip "Que sigo". Se o usuário não estiver logado,
   * redireciona pro login com returnUrl voltando pra cá (com âncora pra
   * a seção de campeonatos). Se já estiver logado, só ativa o filtro.
   */
  ativarSeguindo(): void {
    if (!this.estaLogado) {
      this.router.navigate(['/login'], {
        queryParams: { returnUrl: '/#campeonatos' },
      });
      return;
    }
    this.apenasSeguindo = true;
  }

  trackById(_i: number, c: Campeonato): string {
    return c.id ?? '';
  }

  limparBusca(): void {
    this.busca = '';
  }
}
