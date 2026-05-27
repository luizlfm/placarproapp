import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'placarpro_admin_navegando';

/**
 * Rastreia se o usuário (admin master) está em uma navegação "saindo do
 * painel admin" — ex.: clicou em "Abrir como dono" num campeonato e foi
 * pro shell normal. Enquanto esse estado estiver ativo, mostramos uma
 * faixa flutuante no topo das páginas `/app/*` com botão "Voltar pro
 * Painel Admin" — assim ele nunca fica "perdido" dentro do campeonato
 * de outro usuário.
 *
 * Persistido em sessionStorage pra sobreviver F5 e navegação direta via
 * URL, mas LIMPO ao logout/fechar aba.
 */
@Injectable({ providedIn: 'root' })
export class AdminNavigationService {
  /** Signal reativo — true enquanto o admin "veio do painel". */
  readonly navegando = signal<boolean>(this.lerStorage());

  /** Liga o estado: chamado quando admin clica em "Abrir como dono" etc. */
  iniciar(): void {
    this.gravarStorage(true);
    this.navegando.set(true);
  }

  /** Desliga o estado: chamado quando o admin volta pro painel ou logout. */
  encerrar(): void {
    this.gravarStorage(false);
    this.navegando.set(false);
  }

  private lerStorage(): boolean {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private gravarStorage(v: boolean): void {
    try {
      if (v) sessionStorage.setItem(STORAGE_KEY, '1');
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* sem sessionStorage — apenas signal */ }
  }
}
