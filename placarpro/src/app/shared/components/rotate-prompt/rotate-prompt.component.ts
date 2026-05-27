import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';

/**
 * Overlay fullscreen "Gire o telefone pra horizontal".
 *
 * Aparece SÓ em:
 *  - Dispositivo mobile (largura ≤ 768px no primeiro detect)
 *  - Orientação portrait (matchMedia(orientation: portrait))
 *
 * Some automaticamente quando o usuário rotaciona pra landscape.
 *
 * UX:
 *  - Fundo preto opaco (z-index altíssimo) — bloqueia interação com
 *    a página abaixo até o user girar OU clicar voltar.
 *  - Ícone phone-portrait + seta + phone-landscape pra deixar visual.
 *  - Botão "Voltar" emite `voltar` pra o pai navegar pra tela anterior.
 *
 * Por que componente separado: a página de transmissão e a página
 * pública do jogo ambas precisam disso, mesmo comportamento.
 */
@Component({
  selector: 'app-rotate-prompt',
  templateUrl: './rotate-prompt.component.html',
  styleUrls: ['./rotate-prompt.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RotatePromptComponent implements OnInit, OnDestroy {
  /**
   * Habilita o overlay (default true). Quando false, nunca aparece —
   * permite à página desabilitar dinamicamente (ex: durante loading,
   * ou em estado de erro onde rotacionar não resolve).
   */
  @Input() ativo = true;

  /** Disparado quando user clica em "Voltar" pro pai navegar. */
  @Output() voltar = new EventEmitter<void>();

  /** True quando deve mostrar (mobile + portrait + ativo). */
  mostrar = false;

  private readonly cdr = inject(ChangeDetectorRef);
  private mql?: MediaQueryList;
  private listener?: (ev: MediaQueryListEvent | MediaQueryList) => void;

  ngOnInit(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // Só faz sentido em telas pequenas. Em desktop, o pano de fundo
    // costuma ser amplo e a "tela vertical" não compromete UX.
    const ehMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!ehMobile) return;

    this.mql = window.matchMedia('(orientation: portrait)');
    this.listener = (ev: MediaQueryListEvent | MediaQueryList) => {
      this.mostrar = this.ativo && !!ev.matches;
      this.cdr.markForCheck();
    };

    // Estado inicial
    this.mostrar = this.ativo && this.mql.matches;
    this.cdr.markForCheck();

    if (typeof this.mql.addEventListener === 'function') {
      this.mql.addEventListener('change', this.listener);
    } else if (typeof this.mql.addListener === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      this.mql.addListener(this.listener);
    }
  }

  ngOnDestroy(): void {
    if (this.mql && this.listener) {
      if (typeof this.mql.removeEventListener === 'function') {
        this.mql.removeEventListener('change', this.listener);
      } else if (typeof this.mql.removeListener === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        this.mql.removeListener(this.listener);
      }
    }
  }

  onVoltar(): void {
    this.voltar.emit();
  }
}
