import { Directive, ElementRef, HostListener, Input, OnInit, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Tipos de máscara suportados.
 * - `telefone`: aceita 10 ou 11 dígitos brasileiros → `(00) 00000-0000` ou `(00) 0000-0000`
 * - `dinheiro`: número decimal pt-BR → `1.234,56` (atualiza valor do form como Number)
 * - `codigo`:   5 chars alfanuméricos A-Z + 0-9, sempre uppercase (código de convite)
 * - `hora`:     HH:mm — usado quando o input type="text" precisa formatar relógio
 *
 * Uso:
 * ```html
 * <input formControlName="telefone" appMascara="telefone" />
 * ```
 *
 * Diferença pra usar uma lib externa (ngx-mask, imask, etc):
 *  - Zero dependências adicionais
 *  - Simples o suficiente pros 4 formatos comuns do PlacarPro
 *  - Trabalha com ReactiveForms (via NgControl) ou template-driven
 */
@Directive({
  selector: '[appMascara]',
  standalone: false,
})
export class MascaraInputDirective implements OnInit {
  @Input('appMascara') tipo: 'telefone' | 'dinheiro' | 'codigo' | 'hora' = 'telefone';

  private readonly el = inject(ElementRef<HTMLInputElement>);
  /** Pode ser null se o input não está num form reactive — usamos value direto nesse caso. */
  private readonly ngControl = inject(NgControl, { optional: true });

  ngOnInit(): void {
    // Aplica máscara no valor inicial (caso o form já venha com dado pré-preenchido).
    const inputEl = this.el.nativeElement as HTMLInputElement;
    const valorAtual = inputEl.value;
    if (valorAtual) {
      const formatado = this.aplicar(valorAtual);
      inputEl.value = formatado;
    }
  }

  /**
   * Listener principal — sempre que o usuário digita, reaplica a máscara.
   * Usa `setValue` no form control pra sincronizar o valor processado.
   */
  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cursor = input.selectionStart ?? input.value.length;
    const tamanhoAntes = input.value.length;

    const formatado = this.aplicar(input.value);
    input.value = formatado;

    // Sincroniza com FormControl (se houver). Pra `dinheiro` salvamos número.
    if (this.ngControl?.control) {
      const valorParaForm = this.tipo === 'dinheiro'
        ? this.parseDinheiro(formatado)
        : formatado;
      this.ngControl.control.setValue(valorParaForm, { emitEvent: false });
    }

    // Reposiciona o cursor compensando os caracteres adicionados pela máscara.
    const tamanhoDepois = formatado.length;
    const novoCursor = Math.max(0, cursor + (tamanhoDepois - tamanhoAntes));
    requestAnimationFrame(() => input.setSelectionRange(novoCursor, novoCursor));
  }

  // ============== Aplicação da máscara ==============

  /** Dispatcher por tipo. */
  private aplicar(valor: string): string {
    if (valor == null) return '';
    switch (this.tipo) {
      case 'telefone': return this.mascararTelefone(valor);
      case 'dinheiro': return this.mascararDinheiro(valor);
      case 'codigo':   return this.mascararCodigo(valor);
      case 'hora':     return this.mascararHora(valor);
    }
  }

  /** `(00) 00000-0000` ou `(00) 0000-0000` (celular ou fixo). */
  private mascararTelefone(valor: string): string {
    const digitos = valor.replace(/\D/g, '').slice(0, 11);
    if (digitos.length === 0) return '';
    if (digitos.length <= 2) return `(${digitos}`;
    if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
    if (digitos.length <= 10) {
      // Fixo (10 dígitos): (00) 0000-0000
      return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
    }
    // Celular (11 dígitos): (00) 00000-0000
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  }

  /**
   * Formata valor monetário pt-BR: usuário digita "1234" → exibe "12,34";
   * "123456" → "1.234,56". Sempre 2 casas decimais.
   */
  private mascararDinheiro(valor: string): string {
    // Aceita string ou number
    const str = String(valor);
    const digitos = str.replace(/\D/g, '');
    if (digitos.length === 0) return '';
    // Converte os dígitos pra centavos
    const centavos = parseInt(digitos, 10);
    const reais = centavos / 100;
    return reais.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  /** Converte "1.234,56" → 1234.56 pra gravar no FormControl como Number. */
  private parseDinheiro(formatado: string): number | null {
    if (!formatado) return null;
    // Remove tudo que não é dígito, vírgula ou ponto, então normaliza
    const limpo = formatado
      .replace(/\./g, '')       // remove separador de milhar
      .replace(',', '.');        // vírgula decimal → ponto
    const num = Number(limpo);
    return Number.isFinite(num) ? num : null;
  }

  /** Apenas A-Z e 0-9, max 5 chars, uppercase. */
  private mascararCodigo(valor: string): string {
    return valor
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 5);
  }

  /** `HH:mm` — formato 24h. */
  private mascararHora(valor: string): string {
    const digitos = valor.replace(/\D/g, '').slice(0, 4);
    if (digitos.length === 0) return '';
    if (digitos.length <= 2) return digitos;
    return `${digitos.slice(0, 2)}:${digitos.slice(2)}`;
  }
}
