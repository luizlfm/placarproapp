import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Observable, of, switchMap } from 'rxjs';
import { User } from '@angular/fire/auth';
import { AuthService } from '../../auth/auth.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { NavBackService } from '../../shared/nav-back.service';

interface SubMenuItem {
  label: string;
  icon: string;
  path: string;
}

/**
 * Sub-shell do Campeonato.
 * Substitui a sidebar global pelo menu contextual (Início / Mídia / Config).
 * Filhos renderizam via <ion-router-outlet> dentro deste componente.
 */
@Component({
  selector: 'app-campeonato',
  templateUrl: './campeonato.page.html',
  styleUrls: ['./campeonato.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class CampeonatoPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly alertCtrl = inject(AlertController);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly navBack = inject(NavBackService);

  readonly user$: Observable<User | null> = this.auth.user$;
  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly campeonato$: Observable<Campeonato | undefined> = this.route.paramMap.pipe(
    switchMap(p => {
      const id = p.get('id');
      return id ? this.campeonatosSrv.get$(id) : of(undefined);
    }),
  );

  get menu(): SubMenuItem[] {
    const base = `/app/campeonato/${this.campeonatoId}`;
    return [
      { label: 'Início', icon: 'home-outline', path: `${base}/inicio` },
      { label: 'Fotos, Vídeos e notícias', icon: 'images-outline', path: `${base}/midia` },
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

  voltar(): void {
    this.navBack.back('/app/meus-campeonatos');
  }

  initials(user: User | null): string {
    return (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  }
}
