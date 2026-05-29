import { Component, Input, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { AlertController } from '@ionic/angular';
import { AuthService } from '../../../auth/auth.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { NavBackService } from '../../nav-back.service';

interface SubMenuItem {
  label: string;
  icon: string;
  path: string;
}

/**
 * Header navy MOBILE compartilhado pelo shell admin do campeonato.
 *
 * Aparece somente em viewport ≤767px e renderiza:
 *  - Brand row: back + logo + título + sair
 *  - Segments row: ícones de navegação (Início / Mídia / Config)
 *    com indicador lime no item ativo.
 *
 * Por que componente, e não shell-via-routing:
 *  - O shell-routing original optou pela estrutura FLAT (sem ion-router-outlet
 *    aninhado). Quando tentamos usar `CampeonatoPage` como wrapper de rota
 *    (loadChildren), as telas travavam — Ionic não lida bem com
 *    ion-router-outlet aninhado em ion-page.
 *  - Solução: cada child page de `campeonato/:id/**` inclui este componente
 *    no topo do template. A duplicação é minimizada (1 import, 1 tag) e
 *    o comportamento fica consistente sem hacking de routing.
 *
 * Uso:
 *   <app-campeonato-mobile-header
 *     [campeonatoId]="campeonatoId"
 *   ></app-campeonato-mobile-header>
 */
@Component({
  selector: 'app-campeonato-mobile-header',
  templateUrl: './campeonato-mobile-header.component.html',
  styleUrls: ['./campeonato-mobile-header.component.scss'],
  standalone: false,
})
export class CampeonatoMobileHeaderComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly navBack = inject(NavBackService);

  /** ID do campeonato — esperado vir do template via [campeonatoId]. Se
   *  vazio, o componente cai num fallback olhando o paramMap da rota (útil
   *  pra pages que não armazenam o id em variável). */
  @Input() campeonatoId = '';

  /** Stream do usuário logado — usado pra esconder o botão "Sair" quando
   *  ninguém tá logado (caso edge: visitante anônimo abriu o shell admin
   *  por deep-link antes do guard rejeitar). */
  readonly user$ = this.auth.user$;

  /** Stream do campeonato — busca o doc pelo `campeonatoId` (input) ou
   *  pelo `id` da rota como fallback. Usado pra exibir logo + título. */
  readonly campeonato$: Observable<Campeonato | undefined> = this.route.paramMap.pipe(
    switchMap(p => {
      const id = this.campeonatoId || p.get('id') || '';
      return id ? this.campeonatosSrv.get$(id) : of(undefined);
    }),
  );

  /** Menu fixo do shell admin — 3 itens (Início, Mídia, Config). Mesma
   *  estrutura do `CampeonatoPage.menu`. Caminho calculado a partir do
   *  `campeonatoId` resolvido pelo paramMap caso o input venha vazio. */
  get menu(): SubMenuItem[] {
    const id = this.campeonatoId || this.route.snapshot.paramMap.get('id') || '';
    const base = `/app/campeonato/${id}`;
    return [
      { label: 'Início',                  icon: 'home-outline',     path: `${base}/inicio` },
      { label: 'Fotos, Vídeos e notícias', icon: 'images-outline',  path: `${base}/midia` },
      { label: 'Configurações',           icon: 'settings-outline', path: `${base}/config` },
    ];
  }

  voltar(): void {
    this.navBack.back('/app/meus-campeonatos');
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
            // Logout sempre cai na home pública.
            await this.router.navigateByUrl('/', { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }
}
