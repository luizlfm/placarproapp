import { Injectable, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { NavController } from '@ionic/angular';

/**
 * Serviço utilitário para "voltar" mantendo o comportamento esperado:
 *
 * - Se há histórico no navegador (usuário chegou aqui via clique/navegação),
 *   volta para a rota anterior real.
 * - Se NÃO há histórico (acessou direto via URL/refresh/bookmark), navega
 *   pra rota fallback informada (ou `/app/meus-campeonatos` por padrão).
 *
 * Uso típico em uma página:
 *   constructor(private navBack: NavBackService) {}
 *   voltar(): void {
 *     this.navBack.back('/app/campeonato/' + this.campeonatoId + '/inicio');
 *   }
 *
 * Usa NavController do Ionic (que mantém a stack do `ion-router-outlet`)
 * e Location do Angular como fallback. Isso evita o "salto" feio quando
 * o histórico está vazio.
 */
@Injectable({ providedIn: 'root' })
export class NavBackService {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly navCtrl = inject(NavController);

  /**
   * Volta para a tela anterior real.
   * @param fallback rota (string) ou comando array pra quando não houver histórico
   */
  back(fallback?: string | unknown[]): void {
    // history.length === 1 significa que essa é a primeira página da sessão
    // (chegou via URL direta ou refresh). Nesse caso, usa fallback.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      // NavController do Ionic respeita a animação reversa do ion-router-outlet
      this.navCtrl.back();
      return;
    }

    if (fallback) {
      if (typeof fallback === 'string') {
        this.router.navigateByUrl(fallback);
      } else {
        this.router.navigate(fallback);
      }
      return;
    }

    // Default: vai pra home da área autenticada
    this.router.navigateByUrl('/app/meus-campeonatos');
  }

  /**
   * Versão estrita: SEMPRE usa `location.back()`. Útil quando você tem
   * certeza que veio de outra rota válida (ex.: pop modal sem histórico).
   */
  backStrict(): void {
    this.location.back();
  }
}
