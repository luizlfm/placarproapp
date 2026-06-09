import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

/**
 * Registra visitas ao site pra alimentar o dashboard do painel admin.
 *
 * Estratégia: 1 visita por SESSÃO do navegador (não por page-view), pra
 * aproximar "visitantes" sem inflar com navegação interna. Guardado em
 * sessionStorage — zera quando a aba/janela fecha.
 *
 * Fire-and-forget: nunca quebra o boot do app se a função falhar.
 */
@Injectable({ providedIn: 'root' })
export class VisitasService {
  private readonly functions = inject(Functions);

  private static readonly CHAVE = 'pp_visita_registrada';

  registrarVisitaSessao(): void {
    // Já contou nesta sessão? Sai.
    try {
      if (sessionStorage.getItem(VisitasService.CHAVE)) return;
      sessionStorage.setItem(VisitasService.CHAVE, '1');
    } catch {
      // sessionStorage indisponível (modo privado/bloqueado) — segue e conta.
    }

    try {
      const fn = httpsCallable<void, { ok: boolean }>(this.functions, 'registrarVisita');
      void fn().catch(() => { /* silencioso — métrica não pode atrapalhar o app */ });
    } catch {
      /* ignore */
    }
  }
}
