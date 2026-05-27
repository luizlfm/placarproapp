import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'placarpro.theme';

/**
 * Gerencia o tema (claro/escuro/sistema).
 * Aplica/remove a classe `dark` no <body>.
 * Persiste a escolha no localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly mode = signal<ThemeMode>(this.readStored());
  /** True quando o tema efetivo é escuro (resolve 'system'). */
  readonly isDark = signal<boolean>(false);

  private mediaQuery?: MediaQueryList;

  constructor() {
    this.mediaQuery = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)');
    this.mediaQuery?.addEventListener('change', () => this.apply());
    this.apply();
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    this.doc.defaultView?.localStorage?.setItem(STORAGE_KEY, mode);
    this.apply();
  }

  private readStored(): ThemeMode {
    // Tema claro é fixo no app: design requer sidebar/header navy + conteúdo claro.
    // Mantemos o sinal/API por compatibilidade, mas ignoramos qualquer valor stored.
    return 'light';
  }

  private apply(): void {
    // Sempre modo claro — não respeita prefers-color-scheme do OS.
    this.isDark.set(false);
    const body = this.doc.body;
    body.classList.add('light');
    body.classList.remove('dark');
  }
}
