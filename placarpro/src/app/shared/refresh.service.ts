import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Helper de pull-to-refresh.
 *
 * Antes cada `onRefresh` chamava `window.location.reload()` — isso
 * recarrega o app inteiro no Angular/Ionic, dispara os guards de boot
 * e em muitos casos o usuário acabava caindo em `/app/meus-campeonatos`
 * (rota fallback) em vez de permanecer na tela atual.
 *
 * Esta abordagem força o Angular Router a destruir+recriar APENAS o
 * componente da rota atual, sem perder a URL nem reentrar nos guards
 * de boot. Funciona da seguinte forma:
 *  1. Salva o `shouldReuseRoute` original
 *  2. Substitui temporariamente por `() => false` (força recriação)
 *  3. Re-navega pra mesma URL
 *  4. Restaura o `shouldReuseRoute` original
 *
 * Resultado: `ngOnInit` roda de novo, observables re-emitem, dados
 * são re-buscados — sem `location.reload()`.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly router = inject(Router);

  /**
   * Recarrega a rota atual.
   * @param ev opcional `CustomEvent` do ion-refresher; após o reload chamamos `target.complete()`.
   */
  async refreshAtual(ev?: CustomEvent): Promise<void> {
    const urlAtual = this.router.url || '/';
    const reuseOriginal = this.router.routeReuseStrategy.shouldReuseRoute;
    const onSameUrlOriginal = this.router.onSameUrlNavigation;

    this.router.routeReuseStrategy.shouldReuseRoute = () => false;
    this.router.onSameUrlNavigation = 'reload';
    // `navigated = false` faz com que o Router considere isto uma navegação
    // nova (mesmo pra URL idêntica) e dispare os lifecycle hooks de novo.
    (this.router as unknown as { navigated: boolean }).navigated = false;

    try {
      await this.router.navigateByUrl(urlAtual);
    } catch (err) {
      console.warn('[RefreshService] navegação falhou, caindo no fallback reload', err);
      window.location.reload();
    } finally {
      this.router.routeReuseStrategy.shouldReuseRoute = reuseOriginal;
      this.router.onSameUrlNavigation = onSameUrlOriginal;
      const target = ev?.target as { complete?: () => void } | null;
      try { target?.complete?.(); } catch { /* ignore */ }
    }
  }
}
