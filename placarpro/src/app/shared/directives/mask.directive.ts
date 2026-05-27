import { Directive, ElementRef, HostListener, Input, OnInit, Optional } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Tipos de máscara suportados.
 */
export type MaskType =
  | 'cpf' // 000.000.000-00
  | 'cnpj' // 00.000.000/0000-00
  | 'cpf-cnpj' // alterna conforme a qtd de dígitos (até 11 = CPF, > 11 = CNPJ)
  | 'telefone' // (00) 0000-0000 ou (00) 00000-0000
  | 'cep' // 00000-000
  | 'data' // dd/mm/aaaa
  | 'hora' // hh:mm
  | 'datahora' // dd/mm/aaaa hh:mm
  | 'numero' // só dígitos
  | 'email' // sanitiza: lowercase + sem espaços
  | 'moeda'; // R$ 1.234,56 (pt-BR, sempre 2 casas decimais)

/**
 * Diretiva genérica de máscara para inputs (texto/ion-input).
 *
 * Uso:
 *   <ion-input mask="cpf" formControlName="documento"></ion-input>
 *   <ion-input mask="telefone" [(ngModel)]="telefone"></ion-input>
 *   <input type="text" mask="data" formControlName="nascimento" />
 *
 * O valor armazenado no FormControl/ngModel é o valor JÁ FORMATADO
 * (ex.: "(11) 99999-9999"). Para enviar/comparar com sistemas externos,
 * use `extrairDigitos()`.
 */
@Directive({
  selector: '[mask]',
  standalone: false,
})
export class MaskDirective implements OnInit {
  @Input('mask') tipo: MaskType = 'numero';

  constructor(
    private readonly host: ElementRef<HTMLElement>,
    @Optional() private readonly ngControl: NgControl,
  ) {}

  ngOnInit(): void {
    // Se o controle já tem um valor (ex.: edição), formata na inicialização.
    setTimeout(() => {
      const el = this.getInputEl();
      if (!el) return;
      const valor = el.value ?? '';
      if (valor) {
        const formatado = this.aplicar(valor);
        if (formatado !== valor) {
          this.atualizarValor(el, formatado);
        }
      }
    });
  }

  @HostListener('input', ['$event'])
  onInput(ev: Event): void {
    const el = this.getInputEl();
    if (!el) return;
    const cursor = (ev.target as HTMLInputElement).selectionStart ?? null;
    const original = el.value ?? '';
    const formatado = this.aplicar(original);
    if (formatado === original) return;
    this.atualizarValor(el, formatado);
    // Tenta manter o cursor no fim quando o usuário está digitando.
    if (cursor !== null && cursor >= original.length - 1) {
      try {
        el.setSelectionRange(formatado.length, formatado.length);
      } catch {
        /* alguns navegadores/ion-input não suportam */
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  /** Encontra o <input> nativo dentro do host (ion-input ou input puro). */
  private getInputEl(): HTMLInputElement | null {
    const host = this.host.nativeElement;
    if (host instanceof HTMLInputElement) return host;
    return host.querySelector('input');
  }

  /** Atualiza o input nativo + propaga para FormControl/ngModel. */
  private atualizarValor(el: HTMLInputElement, valor: string): void {
    el.value = valor;
    if (this.ngControl?.control) {
      this.ngControl.control.setValue(valor, { emitEvent: false });
    } else {
      // Dispara input manualmente para ion-input/ngModel pegar.
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /** Aplica a máscara conforme o tipo. */
  private aplicar(valor: string): string {
    const v = valor ?? '';
    switch (this.tipo) {
      case 'cpf':
        return mascaraCpf(v);
      case 'cnpj':
        return mascaraCnpj(v);
      case 'cpf-cnpj':
        return mascaraCpfOuCnpj(v);
      case 'telefone':
        return mascaraTelefone(v);
      case 'cep':
        return mascaraCep(v);
      case 'data':
        return mascaraData(v);
      case 'hora':
        return mascaraHora(v);
      case 'datahora':
        return mascaraDataHora(v);
      case 'numero':
        return soDigitos(v);
      case 'email':
        return mascaraEmail(v);
      case 'moeda':
        return mascaraMoeda(v);
      default:
        return v;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers — também exportados para uso fora da diretiva (services etc.)
// ──────────────────────────────────────────────────────────────────────────

export function soDigitos(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Extrai só dígitos — útil pra salvar/enviar sem máscara. */
export function extrairDigitos(v: string | null | undefined): string {
  return soDigitos(v ?? '');
}

export function mascaraCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export function mascaraCnpj(v: string): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function mascaraCpfOuCnpj(v: string): string {
  const d = soDigitos(v);
  return d.length <= 11 ? mascaraCpf(v) : mascaraCnpj(v);
}

export function mascaraTelefone(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) {
    // Fixo (8 dígitos no número): (00) 0000-0000
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  // Celular (9 dígitos): (00) 00000-0000
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

export function mascaraCep(v: string): string {
  const d = soDigitos(v).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function mascaraData(v: string): string {
  // Aceita dd/mm/aaaa e também dd-mm-aaaa colado do clipboard
  const d = soDigitos(v).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`;
}

export function mascaraHora(v: string): string {
  const d = soDigitos(v).slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
}

export function mascaraDataHora(v: string): string {
  // dd/mm/aaaa hh:mm — 12 dígitos
  const d = soDigitos(v).slice(0, 12);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length <= 10) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)} ${d.slice(8)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}`;
}

/**
 * Sanitiza um e-mail enquanto o usuário digita:
 *  - converte tudo pra minúsculo
 *  - remove espaços (inclui colados acidentalmente)
 * Não bloqueia caracteres inválidos — a validação fica por conta do FormControl.
 */
export function mascaraEmail(v: string): string {
  return (v ?? '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Formata valor monetário pt-BR: usuário digita dígitos → "R$ 1.234,56".
 * Sempre 2 casas decimais. Limite ~9 dígitos (até R$ 9.999.999,99) pra evitar overflow visual.
 *
 * Para gravar como número, use `parseMoeda("R$ 1.234,56")` → 1234.56.
 */
export function mascaraMoeda(v: string | number): string {
  const str = typeof v === 'number' ? String(Math.round(v * 100)) : String(v ?? '');
  const digitos = str.replace(/\D/g, '').slice(0, 9);
  if (digitos.length === 0) return '';
  const centavos = parseInt(digitos, 10);
  const reais = centavos / 100;
  const formatado = reais.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `R$ ${formatado}`;
}

/** Converte "R$ 1.234,56" → 1234.56. Retorna null se vazio/inválido. */
export function parseMoeda(v: string | null | undefined): number | null {
  if (!v) return null;
  const limpo = String(v)
    .replace(/[^\d,.-]/g, '') // mantém só dígitos, vírgula, ponto e sinal
    .replace(/\./g, '') // remove separador de milhar
    .replace(',', '.'); // vírgula decimal → ponto
  const num = Number(limpo);
  return Number.isFinite(num) ? num : null;
}

// ──────────────────────────────────────────────────────────────────────────
// Conversores data — útil pra interop entre dd/mm/yyyy (UI) e yyyy-mm-dd (Firestore)
// ──────────────────────────────────────────────────────────────────────────

/** Converte "31/12/2024" → "2024-12-31". Retorna '' se inválido. */
export function dataBrParaIso(v: string | null | undefined): string {
  if (!v) return '';
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** Converte "2024-12-31" → "31/12/2024". Retorna '' se inválido. */
export function dataIsoParaBr(v: string | null | undefined): string {
  if (!v) return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy}`;
}

/** Converte "31/12/2024 15:30" → "2024-12-31T15:30". Retorna '' se inválido. */
export function dataHoraBrParaIso(v: string | null | undefined): string {
  if (!v) return '';
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return '';
  const [, dd, mm, yyyy, hh, mi] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/** Converte "2024-12-31T15:30" ou "2024-12-31 15:30" → "31/12/2024 15:30". Retorna '' se inválido. */
export function dataHoraIsoParaBr(v: string | null | undefined): string {
  if (!v) return '';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (!m) return '';
  const [, yyyy, mm, dd, hh, mi] = m;
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}
