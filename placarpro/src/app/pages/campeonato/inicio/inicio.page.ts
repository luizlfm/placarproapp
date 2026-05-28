import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { ActionModalService } from '../../../shared/components/action-modal/action-modal.service';
import { RefreshService } from '../../../shared/refresh.service';
import { Observable, of, switchMap } from 'rxjs';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { UsersService } from '../../../users/users.service';
import { getModalidade } from '../../../campeonatos/modalidades';
import { NovaCategoriaModalComponent } from './nova-categoria-modal/nova-categoria-modal.component';
import { DuplicarCategoriaModalComponent } from './duplicar-categoria-modal/duplicar-categoria-modal.component';

@Component({
  selector: 'app-camp-inicio',
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class InicioPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionModalService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly usersSrv = inject(UsersService);
  private readonly refreshSrv = inject(RefreshService);

  /** Pega o :id da rota pai (CampeonatoPage). */
  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';

  /** Detecta viewport mobile pra escolher capa/logo Web vs Mobile. */
  ehMobile = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 767px)').matches
    : false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.matchMedia('(max-width: 767px)').addEventListener('change', ev => {
        this.ehMobile = ev.matches;
      });
    }
  }

  /** Retorna a capa apropriada pra viewport (mobile → mobile com fallback web). */
  /** Banner padrão exibido quando o campeonato ainda não tem capa. */
  readonly bannerPadrao = 'assets/branding/banner-default.svg';

  capaCamp(c: Campeonato | null | undefined): string {
    if (!c) return this.bannerPadrao;
    if (this.ehMobile && c.capaMobileUrl) return c.capaMobileUrl;
    return c.capaUrl || c.bannerUrl || this.bannerPadrao;
  }

  /** Retorna o logo apropriado pra viewport. */
  logoCamp(c: Campeonato | null | undefined): string | null {
    if (!c) return null;
    if (this.ehMobile && c.logoMobileUrl) return c.logoMobileUrl;
    return c.logoUrl ?? null;
  }

  readonly campeonato$: Observable<Campeonato | undefined> = this.route
    ? this.route.paramMap.pipe(
        switchMap(p => {
          const id = p.get('id');
          return id ? this.campeonatosSrv.get$(id) : of(undefined);
        }),
      )
    : of(undefined);

  readonly categorias$: Observable<Categoria[]> = this.campeonatoId
    ? this.categoriasSrv.list$(this.campeonatoId)
    : of([]);

  readonly segue$: Observable<boolean> = this.campeonatoId
    ? this.usersSrv.segue$(this.campeonatoId)
    : of(false);

  /** Pull-to-refresh — recarrega APENAS esta rota via Angular Router. */
  async onRefresh(ev: CustomEvent): Promise<void> {
    await this.refreshSrv.refreshAtual(ev);
  }

  async novaCategoria(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: NovaCategoriaModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ created?: boolean; id?: string }>();
    if (data?.created) {
      await this.toast('Categoria criada!', 'success');
      if (data.id) {
        this.router.navigate(['/app/campeonato', this.campeonatoId, 'categoria', data.id]);
      }
    }
  }

  /** Abre o modal de duplicação pra criar uma nova categoria a partir desta. */
  async duplicarCategoria(c: Categoria): Promise<void> {
    if (!c?.id) return;
    const modal = await this.modalCtrl.create({
      component: DuplicarCategoriaModalComponent,
      componentProps: { campeonatoId: this.campeonatoId, source: c },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ created?: boolean; id?: string }>();
    if (data?.created) {
      await this.toast('Categoria duplicada!', 'success');
      if (data.id) {
        this.router.navigate(['/app/campeonato', this.campeonatoId, 'categoria', data.id]);
      }
    }
  }

  /**
   * Action sheet com as opções: mover pra cima, mover pra baixo, excluir.
   * O `event.stopPropagation` no template impede que o click bubble e dispare
   * o routerLink do card.
   */
  async abrirMenu(c: Categoria, _ev: Event): Promise<void> {
    if (!c?.id) return;
    const sheet = await this.actionSheetCtrl.create({
      header: c.titulo,
      buttons: [
        {
          text: 'Mover para cima',
          icon: 'arrow-up-outline',
          handler: () => { void this.moverParaCima(c); },
        },
        {
          text: 'Mover para baixo',
          icon: 'arrow-down-outline',
          handler: () => { void this.moverParaBaixo(c); },
        },
        {
          text: 'Excluir categoria',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => { void this.confirmarExcluir(c); },
        },
        {
          text: 'Cancelar',
          icon: 'close-outline',
          role: 'cancel',
        },
      ],
    });
    await sheet.present();
  }

  private async moverParaCima(c: Categoria): Promise<void> {
    if (!c?.id) return;
    try {
      await this.categoriasSrv.moverParaCima(this.campeonatoId, c.id);
    } catch (err) {
      console.error('[moverParaCima] falhou', err);
      await this.toast('Falha ao mover.', 'danger');
    }
  }

  private async moverParaBaixo(c: Categoria): Promise<void> {
    if (!c?.id) return;
    try {
      await this.categoriasSrv.moverParaBaixo(this.campeonatoId, c.id);
    } catch (err) {
      console.error('[moverParaBaixo] falhou', err);
      await this.toast('Falha ao mover.', 'danger');
    }
  }

  private async confirmarExcluir(c: Categoria): Promise<void> {
    if (!c?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Excluir categoria?',
      message:
        `A categoria <strong>"${c.titulo}"</strong> e todas as equipes, jogadores e partidas ` +
        `cadastradas nela serão removidas. Essa ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Excluir',
          role: 'destructive',
          handler: () => { void this.excluir(c); },
        },
      ],
    });
    await alert.present();
  }

  private async excluir(c: Categoria): Promise<void> {
    if (!c?.id) return;
    try {
      await this.categoriasSrv.remover(this.campeonatoId, c.id);
      await this.toast('Categoria excluída.', 'success');
    } catch (err) {
      console.error('[excluir] falhou', err);
      await this.toast('Falha ao excluir a categoria.', 'danger');
    }
  }

  async toggleSeguir(estaSeguindo: boolean): Promise<void> {
    if (!this.campeonatoId) return;
    try {
      if (estaSeguindo) {
        await this.usersSrv.deixarDeSeguir(this.campeonatoId);
        try { await this.campeonatosSrv.ajustarContadorSeguidores(this.campeonatoId, -1); } catch { /* ignore */ }
        await this.toast('Você deixou de seguir este campeonato.', 'success');
      } else {
        await this.usersSrv.seguir(this.campeonatoId);
        try { await this.campeonatosSrv.ajustarContadorSeguidores(this.campeonatoId, +1); } catch { /* ignore */ }
        await this.toast('Pronto! Você está seguindo este campeonato.', 'success');
      }
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  async compartilhar(camp: Campeonato | undefined): Promise<void> {
    if (!camp) return;
    const slug = camp.slug || camp.id || '';
    const url = `${location.origin}/p/${slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: camp.titulo, text: 'Confira este campeonato no PlacarPro', url });
      } else {
        await navigator.clipboard.writeText(url);
        await this.toast('Link copiado!', 'success');
      }
    } catch { /* ignorado: usuário cancelou o share */ }
  }

  trackById(_i: number, c: Categoria): string {
    return c.id ?? '';
  }

  modalidadeOf(c: Categoria) {
    return getModalidade(c.modalidade);
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
