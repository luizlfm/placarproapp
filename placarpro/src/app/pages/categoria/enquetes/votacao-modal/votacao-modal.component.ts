import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Enquete } from '../../../../campeonatos/models/enquete.model';
import { EnquetesService } from '../../../../campeonatos/enquetes.service';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { AuthService } from '../../../../auth/auth.service';

interface ViewState {
  enquete: Enquete;
  meusVotos: string[];
  slugPublico: string;
}

/**
 * Modal "Ver votação" — preview interativo.
 *
 * Diferente da versão antiga (read-only), este modal:
 *  - Lê a enquete em tempo real (Observable) — votos novos atualizam o gráfico
 *  - Permite ao usuário logado VOTAR direto daqui (útil pra admin testar)
 *  - Mostra link pra abrir a página pública (mesma URL que visitantes veem)
 *
 * Comportamento por tipo de usuário:
 *  - Admin logado: vê o estado atual + pode votar (registrado pelo uid dele)
 *  - Anônimo (caso raríssimo aqui): só vê resultados, com CTA pra logar
 */
@Component({
  selector: 'app-votacao-modal',
  templateUrl: './votacao-modal.component.html',
  styleUrls: ['./votacao-modal.component.scss'],
  standalone: false,
})
export class VotacaoModalComponent implements OnInit {
  @Input() enquete!: Enquete;
  /** Necessário pra abrir o link público + chamar `votar()`. */
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly enquetesSrv = inject(EnquetesService);
  private readonly campSrv = inject(CampeonatosService);
  private readonly authSrv = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  /** Stream reativo: enquete + meus votos + slug pra link público. */
  view$!: Observable<ViewState>;
  /** Estado "votando" pra desabilitar botões enquanto persiste. */
  votando = false;

  ngOnInit(): void {
    const campId = this.campeonatoId || this.enquete?.campeonatoId || '';
    const catId = this.categoriaId || this.enquete?.categoriaId || '';
    const enqId = this.enquete?.id;

    if (!campId || !catId || !enqId) {
      // Fallback: usa só o snapshot do @Input.
      this.view$ = of({ enquete: this.enquete, meusVotos: [], slugPublico: '' });
      return;
    }

    // Stream da enquete em tempo real (atualiza gráfico quando voto chega).
    const enquete$ = this.enquetesSrv.get$(campId, catId, enqId).pipe(
      map(e => e ?? this.enquete),
      catchError(() => of(this.enquete)),
      startWith(this.enquete),
    );

    // Voto do usuário atual (vazio se anônimo).
    const meusVotos$ = this.enquetesSrv.meuVoto$(campId, catId, enqId).pipe(
      map(v => v?.alternativaIds ?? []),
      catchError(() => of([] as string[])),
      startWith([] as string[]),
    );

    // Slug pra montar URL pública (`/{slug}/categoria/{catId}`).
    const slug$ = this.campSrv.get$(campId).pipe(
      map(c => c?.slug || c?.shortCode || campId),
      catchError(() => of(campId)),
      startWith(campId),
    );

    this.view$ = combineLatest([enquete$, meusVotos$, slug$]).pipe(
      map(([enquete, meusVotos, slugPublico]) => ({ enquete, meusVotos, slugPublico })),
    );
  }

  /** True se o usuário está logado (precisa pra votar). */
  get estaLogado(): boolean {
    return !!this.authSrv.currentUser;
  }

  /** Aplica/troca o voto do usuário atual numa alternativa. */
  async votar(enquete: Enquete, alternativaId: string, meusVotos: string[]): Promise<void> {
    if (!this.estaLogado) {
      await this.toast('Faça login para votar.', 'danger');
      return;
    }
    if (!enquete.votacaoAberta) {
      await this.toast('Votação encerrada.', 'danger');
      return;
    }
    const campId = this.campeonatoId || enquete.campeonatoId || '';
    const catId = this.categoriaId || enquete.categoriaId || '';
    if (!campId || !catId || !enquete.id) return;

    // Toggle: se múltipla escolha, adiciona/remove; se única, substitui.
    let novos: string[];
    if (enquete.multiplaEscolha) {
      novos = meusVotos.includes(alternativaId)
        ? meusVotos.filter(id => id !== alternativaId)
        : [...meusVotos, alternativaId];
    } else {
      novos = meusVotos.includes(alternativaId) ? meusVotos : [alternativaId];
    }
    if (novos.length === 0) {
      // Em múltipla escolha, evita ficar sem nenhum voto (não dá pra "desvotar tudo").
      // Se quiser, troca isso por permitir remover o voto. Por ora, mantemos.
      await this.toast('Selecione pelo menos uma alternativa.', 'danger');
      return;
    }
    this.votando = true;
    try {
      await this.enquetesSrv.votar(campId, catId, enquete.id, novos);
      await this.toast('Voto registrado!', 'success');
    } catch (err) {
      console.error('[VotacaoModal] votar erro', err);
      const msg = (err as Error)?.message || 'Não foi possível registrar o voto.';
      await this.toast(msg, 'danger');
    } finally {
      this.votando = false;
    }
  }

  /** Abre a página pública da categoria em nova aba. */
  abrirPaginaPublica(slugPublico: string): void {
    if (!slugPublico || !this.categoriaId) return;
    const url = `${window.location.origin}/${slugPublico}/categoria/${this.categoriaId}`;
    window.open(url, '_blank', 'noopener');
  }

  /** Copia o link público (mesma URL que abre a página). */
  async copiarLinkPublico(slugPublico: string): Promise<void> {
    if (!slugPublico || !this.categoriaId) return;
    const url = `${window.location.origin}/${slugPublico}/categoria/${this.categoriaId}`;
    try {
      await navigator.clipboard.writeText(url);
      await this.toast('Link copiado!', 'success');
    } catch {
      await this.toast(url, 'medium');
    }
  }

  percent(enquete: Enquete, votos: number): number {
    const total = enquete?.totalVotos ?? 0;
    if (total <= 0) return 0;
    return Math.round((votos / total) * 100);
  }

  jaVotou(meusVotos: string[]): boolean {
    return meusVotos.length > 0;
  }

  votouNessa(meusVotos: string[], alternativaId: string): boolean {
    return meusVotos.includes(alternativaId);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackById(_i: number, a: { id: string }): string {
    return a.id;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
