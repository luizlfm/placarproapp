import { Injectable } from '@angular/core';
import { TamanhoCarteirinha, EspacoCampo } from './carteirinhas-pdf.service';

export interface CarteirinhaPreviewState {
  tamanho: TamanhoCarteirinha;
  nomeCampeonato: string;
  subtitulo: string;
  cor: string;
  logoUrl?: string;
  incluirEscudo: boolean;
  incluirVerso: boolean;
  espacos: [EspacoCampo, EspacoCampo, EspacoCampo];
  organizacao?: string;
  endereco?: string;
  cidade?: string;
  telefone?: string;
  /** IDs das equipes cujos jogadores devem ser impressos. */
  equipeIds: string[];
}

/**
 * Bridge in-memory entre o fluxo de configuração (3 modais em /relatorios)
 * e a tela de preview (/carteirinhas-preview). A tela consome o estado e
 * o limpa — refresh ou acesso direto à URL exibe estado vazio.
 */
@Injectable({ providedIn: 'root' })
export class CarteirinhasState {
  private pending: CarteirinhaPreviewState | null = null;

  set(state: CarteirinhaPreviewState): void {
    this.pending = state;
  }

  /** Lê e zera. Retorna `null` se ninguém configurou antes. */
  consume(): CarteirinhaPreviewState | null {
    const out = this.pending;
    this.pending = null;
    return out;
  }
}
