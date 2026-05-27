import { Component, Input, OnDestroy, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IonPopover } from '@ionic/angular';

/**
 * Campo de data/data-hora que abre um picker visual (ion-datetime) ao tocar,
 * funcionando igual em iPhone, Android e desktop. Substitui o `input type="date"`
 * nativo do HTML, que no iOS pede só digitação em alguns contextos.
 *
 * Aceita `formControlName`, `[formControl]` e `[(ngModel)]` via ControlValueAccessor.
 *
 * Valores trafegam como string ISO:
 *   - mode='date'      → "YYYY-MM-DD"
 *   - mode='date-time' → "YYYY-MM-DDTHH:mm"
 *   - mode='time'      → "HH:mm"
 *
 * Em telas pequenas (<768px) abre como modal (sheet); em desktop, como popover
 * ancorado no input.
 */
@Component({
  selector: 'app-date-input',
  templateUrl: './date-input.component.html',
  styleUrls: ['./date-input.component.scss'],
  standalone: false,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DateInputComponent),
      multi: true,
    },
  ],
})
export class DateInputComponent implements ControlValueAccessor, OnDestroy {
  @Input() label = '';
  @Input() placeholder = '';
  @Input() mode: 'date' | 'date-time' | 'time' = 'date';
  @Input() required = false;
  /** Locale do `ion-datetime`. */
  @Input() locale = 'pt-BR';
  /** Limites opcionais (ISO YYYY-MM-DD). */
  @Input() min?: string;
  @Input() max?: string;

  /** Id único pra ligar trigger ao popover. */
  readonly uid = 'dt-' + Math.random().toString(36).slice(2, 9);

  @ViewChild(IonPopover) popover?: IonPopover;

  value: string = '';
  disabled = false;

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnDestroy(): void {
    this.popover?.dismiss().catch(() => {});
  }

  // ─── ControlValueAccessor ───
  writeValue(v: unknown): void {
    this.value = (v as string) ?? '';
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(d: boolean): void {
    this.disabled = d;
  }

  // ─── Helpers ───
  get presentation(): 'date' | 'date-time' | 'time' {
    return this.mode;
  }

  /** Texto exibido no input "fake". */
  get displayValue(): string {
    if (!this.value) return '';
    try {
      if (this.mode === 'time') {
        return this.value.slice(0, 5);
      }
      const [datePart, timePart] = this.value.split('T');
      const [y, m, d] = datePart.split('-');
      if (!y || !m || !d) return this.value;
      const dataBR = `${d}/${m}/${y}`;
      if (this.mode === 'date-time' && timePart) {
        return `${dataBR} ${timePart.slice(0, 5)}`;
      }
      return dataBR;
    } catch {
      return this.value;
    }
  }

  /** ion-datetime emite ISO completo; cortamos pro formato esperado. */
  onIonChange(ev: Event): void {
    const raw = (ev as CustomEvent<{ value: string | string[] }>).detail?.value;
    const valor = Array.isArray(raw) ? raw[0] : raw;
    if (!valor) {
      this.value = '';
    } else if (this.mode === 'date') {
      this.value = valor.slice(0, 10); // YYYY-MM-DD
    } else if (this.mode === 'time') {
      // ion-datetime time-only emite "HH:mm:ss" ou ISO; pega só HH:mm
      const m = valor.match(/T?(\d{2}:\d{2})/);
      this.value = m ? m[1] : valor.slice(0, 5);
    } else {
      this.value = valor.slice(0, 16); // YYYY-MM-DDTHH:mm
    }
    this.onChange(this.value);
    this.onTouched();
  }

  limpar(ev?: Event): void {
    ev?.stopPropagation();
    this.value = '';
    this.onChange('');
    this.onTouched();
  }

  fechar(): void {
    this.popover?.dismiss().catch(() => {});
  }
}
