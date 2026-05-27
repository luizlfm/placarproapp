import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { User } from '@angular/fire/auth';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly alertCtrl = inject(AlertController);

  readonly user$: Observable<User | null> = this.auth.user$;

  async confirmLogout(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sair da conta?',
      message: 'Você precisará entrar novamente para acessar.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Sair',
          role: 'destructive',
          handler: () => this.doLogout(),
        },
      ],
    });
    await alert.present();
  }

  private async doLogout(): Promise<void> {
    await this.auth.signOut();
    // Logout sempre cai na home pública (tela principal), não em /login.
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
