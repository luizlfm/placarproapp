import { Directive, ElementRef, HostListener, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Máscara de moeda Real (R$) para `<input>` com `[(ngModel)]`.
 *
 * Diferente da `mask="moeda"` (que guarda a STRING formatada no model),
 * esta diretiva é um ControlValueAccessor: o model permanece um **número**
 * em reais (ex.: 50 ou 49.9) enquanto o input exibe "R$ 50,00".
 *
 * O usuário digita da direita pra esquerda (centavos): teclar "5000"
 * vira "R$ 50,00".
 *
 * Uso:
 *   <input brlMask [(ngModel)]="preco" />
 */
@Directive({
  selector: 'input[brlMask]',
  standalone: false,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyBrlDirective),
      multi: true,
    },
  ],
})
export class CurrencyBrlDirective implements ControlValueAccessor {
  private onChange: (v: number) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private readonly el: ElementRef<HTMLInputElement>) {}

  @HostListener('input')
  handleInput(): void {
    const input = this.el.nativeElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 11);
    const cents = digits ? parseInt(digits, 10) : 0;
    const reais = cents / 100;
    input.value = this.format(reais);
    this.onChange(reais);
  }

  @HostListener('blur')
  handleBlur(): void {
    this.onTouched();
  }

  writeValue(v: number | null | undefined): void {
    const reais = typeof v === 'number' && isFinite(v) ? v : 0;
    this.el.nativeElement.value = this.format(reais);
  }

  registerOnChange(fn: (v: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.el.nativeElement.disabled = disabled;
  }

  private format(reais: number): string {
    return reais.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
