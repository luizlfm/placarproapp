import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

/**
 * Tema = SEMPRE light. Dark mode está completamente desativado no app.
 *
 * O tipo abaixo é mantido apenas pra compatibilidade com chamadores
 * antigos (ex: `themeSrv.setMode('dark')` em telas legadas) — qualquer
 * valor recebido é ignorado e tratado como 'light'.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'placarpro.theme';

/**
 * Tema fixo claro — não respeita `prefers-color-scheme` do SO, ignora
 * qualquer valor armazenado em localStorage de versões antigas e nunca
 * aplica a classe `.dark` no body.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly mode = signal<ThemeMode>('light');
  /** Mantido por compatibilidade — sempre false. */
  readonly isDark = signal<boolean>(false);

  constructor() {
    // Limpa qualquer valor antigo gravado em localStorage por versões
    // anteriores que permitiam dark/system (em PWAs instalados ele fica).
    try {
      this.doc.defaultView?.localStorage?.removeItem(STORAGE_KEY);
    } catch { /* SSR / privado */ }
    this.apply();
  }

  /** No-op — qualquer modo é forçado pra light. */
  setMode(_mode: ThemeMode): void {
    this.mode.set('light');
    this.apply();
  }

  private apply(): void {
    this.isDark.set(false);
    const body = this.doc.body;
    const root = this.doc.documentElement;
    body.classList.add('light');
    body.classList.remove('dark');
    body.classList.remove('ion-palette-dark');
    root.classList.remove('dark');
    root.classList.remove('ion-palette-dark');
    // Reforça o color-scheme inline (vence overrides de extensões/Ionic dark).
    root.style.colorScheme = 'light';
    body.style.colorScheme = 'light';
  }
}
