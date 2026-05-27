import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Observable, of, switchMap } from 'rxjs';
import { User } from '@angular/fire/auth';
import { AuthService } from '../../auth/auth.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../campeonatos/categorias.service';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { Categoria } from '../../campeonatos/categoria.model';
import { NavBackService } from '../../shared/nav-back.service';

interface SubMenuItem {
  label: string;
  icon: string;
  path: string;
}

/** Sub-shell da Categoria — sidebar contextual com Início/Classificação/Rankings/Mídia/Config. */
@Component({
  selector: 'app-categoria',
  templateUrl: './categoria.page.html',
  styleUrls: ['./categoria.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class CategoriaPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly navBack = inject(NavBackService);

  readonly user$: Observable<User | null> = this.auth.user$;
  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  readonly campeonato$: Observable<Campeonato | undefined> = this.route.paramMap.pipe(
    switchMap(p => {
      const id = p.get('id');
      return id ? this.campeonatosSrv.get$(id) : of(undefined);
    }),
  );

  readonly categoria$: Observable<Categoria | undefined> = this.route.paramMap.pipe(
    switchMap(p => {
      const cId = p.get('id');
      const catId = p.get('catId');
      return cId && catId ? this.categoriasSrv.get$(cId, catId) : of(undefined);
    }),
  );

  get menu(): SubMenuItem[] {
    const base = `/app/campeonato/${this.campeonatoId}/categoria/${this.categoriaId}`;
    return [
      { label: 'Início', icon: 'home-outline', path: `${base}/inicio` },
      { label: 'Equipes', icon: 'shield-outline', path: `${base}/equipes` },
      { label: 'Jogos', icon: 'calendar-outline', path: `${base}/jogos` },
      { label: 'Classificação', icon: 'podium-outline', path: `${base}/classificacao` },
      { label: 'Rankings e votações', icon: 'stats-chart-outline', path: `${base}/rankings` },
      { label: 'Fotos, Vídeos e notícias', icon: 'images-outline', path: `${base}/midia` },
      { label: 'Relatórios', icon: 'print-outline', path: `${base}/relatorios` },
      { label: 'Configurações', icon: 'settings-outline', path: `${base}/config` },
    ];
  }

  async confirmLogout(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sair da conta?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Sair',
          role: 'destructive',
          handler: async () => {
            await this.auth.signOut();
            // Logout sempre cai na home pública (tela principal), não em /login.
            await this.router.navigateByUrl('/', { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }

  voltarParaCampeonato(): void {
    this.navBack.back(['/app/campeonato', this.campeonatoId]);
  }

  initials(user: User | null): string {
    return (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  }
}
