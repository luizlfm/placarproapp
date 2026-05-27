import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

/**
 * Aplica a cor do campeonato atual como CSS variables globais:
 *   --campeonato-cor            (hex)
 *   --campeonato-cor-rgb        (r, g, b)
 *   --ion-color-primary         (hex)  ← sobrescreve a primary do Ionic
 *   --ion-color-primary-rgb
 *   --ion-color-primary-shade
 *   --ion-color-primary-tint
 *   --ion-color-primary-contrast
 *   --ion-color-primary-contrast-rgb
 *
 * Sobrescrever as variáveis `--ion-color-primary` é a forma correta de
 * tematizar componentes Ionic (ion-toolbar[color="primary"], ion-button, etc.)
 * com uma cor dinâmica. Ao chamar `clear()`, todas as overrides inline são
 * removidas e o CSS volta para os valores declarados em variables.scss.
 *
 * Quando o usuário sai do campeonato, chamar `clear()`.
 */
@Injectable({ providedIn: 'root' })
export class CampeonatoThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly cor = signal<string | null>(null);

  constructor() {
    effect(() => {
      const c = this.cor();
      const root = this.doc.documentElement;
      const body = this.doc.body;

      if (!c) {
        // Remove todas as overrides inline — volta para variables.scss
        root.style.removeProperty('--campeonato-cor');
        root.style.removeProperty('--campeonato-cor-rgb');
        root.style.removeProperty('--ion-color-primary');
        root.style.removeProperty('--ion-color-primary-rgb');
        root.style.removeProperty('--ion-color-primary-shade');
        root.style.removeProperty('--ion-color-primary-tint');
        root.style.removeProperty('--ion-color-primary-contrast');
        root.style.removeProperty('--ion-color-primary-contrast-rgb');
        body.classList.remove('campeonato-themed');
        return;
      }

      const rgb = this.hexToRgb(c);

      // Variável customizada (usada em componentes próprios do app)
      root.style.setProperty('--campeonato-cor', c);
      if (rgb) root.style.setProperty('--campeonato-cor-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);

      // Override das variáveis Ionic primary — afeta ion-toolbar[color="primary"],
      // ion-button[color="primary"], ion-tabs, etc.
      root.style.setProperty('--ion-color-primary', c);
      if (rgb) root.style.setProperty('--ion-color-primary-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
      root.style.setProperty('--ion-color-primary-shade', this.shadeHex(c, 0.12));
      root.style.setProperty('--ion-color-primary-tint',  this.tintHex(c, 0.06));

      const contrast = rgb ? this.contrastColor(rgb) : '#ffffff';
      root.style.setProperty('--ion-color-primary-contrast', contrast);
      root.style.setProperty(
        '--ion-color-primary-contrast-rgb',
        contrast === '#ffffff' ? '255, 255, 255' : '0, 0, 0',
      );

      body.classList.add('campeonato-themed');
    });
  }

  setCor(cor: string | null | undefined): void {
    this.cor.set(cor && cor.startsWith('#') ? cor : null);
  }

  clear(): void {
    this.cor.set(null);
  }

  // ── Helpers de cor ──────────────────────────────────────────────────────

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const h = hex.replace('#', '');
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some(n => isNaN(n))) return null;
    return { r, g, b };
  }

  /** Escurece o hex por `amount` (0–1). */
  private shadeHex(hex: string, amount: number): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;
    const r = Math.max(0, Math.round(rgb.r * (1 - amount)));
    const g = Math.max(0, Math.round(rgb.g * (1 - amount)));
    const b = Math.max(0, Math.round(rgb.b * (1 - amount)));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /** Clareia o hex por `amount` (0–1). */
  private tintHex(hex: string, amount: number): string {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;
    const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount));
    const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount));
    const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Retorna `#ffffff` ou `#000000` como cor de contraste com base na
   * luminância relativa (WCAG). Garante legibilidade do texto na toolbar.
   */
  private contrastColor(rgb: { r: number; g: number; b: number }): string {
    // Luminância relativa (WCAG 2.1)
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
    return L > 0.179 ? '#000000' : '#ffffff';
  }
}
