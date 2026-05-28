import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { AuthService } from '../../auth/auth.service';
import { ConvitesEquipeService, MeuConvite } from '../../campeonatos/convites-equipe.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { UsersService } from '../../users/users.service';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { ToastController } from '@ionic/angular';

interface CardConvite {
  convite: MeuConvite;
  campeonato?: Campeonato;
}

interface CardCampeonato {
  campeonato: Campeonato;
  /** True se o usuário segue. Reativo via `seguindoIds$()`. */
  segue: boolean;
}

/**
 * Tela do ESPECTADOR. 2 seções:
 *  1) "Minhas equipes" — convites vinculados ao UID (campeonatos onde o
 *     usuário pode preencher atletas via link)
 *  2) "Campeonatos" — todos os campeonatos públicos do sistema com busca
 *     + toggle Seguir/Deixar de seguir
 *
 * Rota: `/espectador`
 */
@Component({
  selector: 'app-espectador',
  templateUrl: './espectador.page.html',
  styleUrls: ['./espectador.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class EspectadorPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly authSrv = inject(AuthService);
  private readonly convitesSrv = inject(ConvitesEquipeService);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly usersSrv = inject(UsersService);
  private readonly toastCtrl = inject(ToastController);

  // Seção 1: convites
  cards: CardConvite[] = [];
  loadingConvites = true;

  // Seção 2: todos campeonatos
  todosCampeonatos: Campeonato[] = [];
  seguindoIds = new Set<string>();
  loadingCampeonatos = true;
  busca = '';
  /** Toggle do chip "Apenas seguindo" — quando ativo, filtra a lista
   *  pra mostrar só campeonatos que o usuário segue. Em uma tela de
   *  ESPECTADOR isso é o caso de uso mais comum (acompanhar). */
  apenasSeguindo = false;

  /** Subscriptions ativas — limpas no destroy. */
  private subs: Subscription[] = [];

  ngOnInit(): void {
    const uid = this.authSrv.currentUser?.uid;
    if (!uid) {
      this.authSrv.waitForAuthInit().then(u => {
        if (u) {
          this.iniciarStreams(u.uid);
        } else {
          this.router.navigateByUrl('/login');
        }
      });
      return;
    }
    this.iniciarStreams(uid);
  }

  private iniciarStreams(uid: string): void {
    // ─── Stream 1: convites vinculados ao UID ───
    this.subs.push(
      this.convitesSrv
        .listMeusConvites$(uid)
        .pipe(
          startWith([] as MeuConvite[]),
          catchError(err => {
            console.warn('[Espectador] listMeusConvites erro', err);
            return of([] as MeuConvite[]);
          }),
        )
        .subscribe(convites => {
          this.cards = convites.map(c => ({ convite: c }));
          this.loadingConvites = false;
          this.cards.forEach(card => {
            this.campsSrv.get$(card.convite.campeonatoId).subscribe(c => {
              if (c) card.campeonato = c;
            });
          });
        }),
    );

    // ─── Stream 2: todos os campeonatos visíveis + seguindo do usuário ───
    // Usamos `listTodosVisiveis$` (que inclui legacy sem campo `publico`)
    // pra mostrar TODOS os campeonatos do sistema, não só os marcados
    // explicitamente como publico=true.
    const publicos$: Observable<Campeonato[]> = this.campsSrv.listTodosVisiveis$().pipe(
      startWith([] as Campeonato[]),
      catchError(err => {
        console.warn('[Espectador] listTodosVisiveis erro', err);
        return of([] as Campeonato[]);
      }),
    );
    const seguindo$ = this.usersSrv.seguindoIds$().pipe(
      startWith([] as string[]),
      catchError(() => of([] as string[])),
    );

    this.subs.push(
      combineLatest([publicos$, seguindo$]).subscribe(([publicos, ids]) => {
        this.todosCampeonatos = publicos;
        this.seguindoIds = new Set(ids);
        this.loadingCampeonatos = false;
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  // ============== Convites ==============

  abrirInscricao(c: CardConvite): void {
    this.router.navigate(['/inscricao', c.convite.token]);
  }
  abrirCampeonatoConvite(c: CardConvite): void {
    if (!c.campeonato) return;
    const slug = c.campeonato.slug || c.campeonato.shortCode || c.campeonato.id;
    this.router.navigate(['/', slug]);
  }

  // ============== Campeonatos públicos ==============

  /** Lista filtrada pela busca + opcionalmente pelo toggle "Apenas seguindo". */
  get campeonatosFiltrados(): Campeonato[] {
    let out = this.todosCampeonatos;
    if (this.apenasSeguindo && this.seguindoIds.size > 0) {
      out = out.filter(c => !!(c.id && this.seguindoIds.has(c.id)));
    }
    const q = this.busca.trim().toLowerCase();
    if (!q) return out;
    return out.filter(c =>
      (c.titulo ?? '').toLowerCase().includes(q) ||
      (c.subtitulo ?? '').toLowerCase().includes(q) ||
      (c.localizacao ?? '').toLowerCase().includes(q),
    );
  }

  /** Sempre mostra o chip — mesmo se ainda não segue ninguém — pra dar
   *  affordance da feature (o badge mostra "0" e o empty state explica). */
  get podeFiltrarSeguindo(): boolean {
    return true;
  }
  get qtdSeguindo(): number {
    return this.seguindoIds.size;
  }

  segueCampeonato(camp: Campeonato): boolean {
    return !!(camp.id && this.seguindoIds.has(camp.id));
  }

  async toggleSeguir(camp: Campeonato, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!camp.id) return;
    try {
      if (this.segueCampeonato(camp)) {
        await this.usersSrv.deixarDeSeguir(camp.id);
        await this.toast(`Você deixou de seguir ${camp.titulo}.`, 'medium');
      } else {
        await this.usersSrv.seguir(camp.id);
        await this.toast(`Agora você segue ${camp.titulo}!`, 'success');
      }
    } catch (err) {
      console.error('[Espectador] toggle seguir erro', err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  abrirCampeonato(camp: Campeonato): void {
    const slug = camp.slug || camp.shortCode || camp.id;
    this.router.navigate(['/', slug]);
  }

  /**
   * Navega DIRETO pra tela pública da transmissão ao vivo —
   * `/transmissao/{campId}/{catId}/{jogoId}`.
   *
   * Lê os IDs da flag `transmissaoLiveAtiva` no campeonato (denormalizada
   * pelo broadcaster ao iniciar). `stopPropagation` impede o clique de
   * subir pro card pai e abrir a home do campeonato.
   *
   * Mesma lógica do `home-publica.page.ts` — espelhar comportamento entre
   * as duas telas públicas pra UX consistente.
   */
  assistirAoVivo(camp: Campeonato, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    const live = camp.transmissaoLiveAtiva;
    if (!live || !camp.id) return;
    this.router.navigate([
      '/transmissao',
      camp.id,
      live.categoriaId,
      live.jogoId,
    ]);
  }

  // ============== Geral ==============

  async sair(): Promise<void> {
    try {
      await this.authSrv.signOut();
      // Volta pra home pública (tela principal) em vez de /login.
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      console.error('[Espectador] signOut erro', err);
    }
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }

  trackByConvite(_i: number, c: CardConvite): string {
    return c.convite.token;
  }
  trackByCampeonato(_i: number, c: Campeonato): string {
    return c.id ?? '';
  }
}
