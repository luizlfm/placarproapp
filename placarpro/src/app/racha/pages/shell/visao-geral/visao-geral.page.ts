import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { Racha, RachaJogador } from '../../../models/racha.model';

type TabId = 'solicitacoes' | 'usuarios' | 'eventos';

/**
 * Página VISÃO GERAL — métricas do racha + tabs com Solicitações,
 * Usuários (jogadores cadastrados) e Eventos.
 *
 * Espelha o print do FutBora:
 *  - Card "VISÃO GERAL" com nome do racha + convite copiável + publicar
 *  - Métricas Usuários / Solicitações
 *  - Tabs com lista + busca
 */
@Component({
  selector: 'app-racha-visao-geral',
  templateUrl: './visao-geral.page.html',
  styleUrls: ['./visao-geral.page.scss'],
  standalone: false,
})
export class RachaVisaoGeralPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  rachaId = '';
  loading = true;
  racha?: Racha;
  jogadores: RachaJogador[] = [];

  tabAtiva: TabId = 'usuarios';
  busca = '';

  private sub?: Subscription;
  private subJog?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }

    this.sub = this.rachaSrv.get$(this.rachaId).pipe(
      startWith(undefined),
      catchError(err => { console.error('[VisaoGeral] get', err); return of(undefined); }),
    ).subscribe(r => {
      this.racha = r ?? undefined;
      this.loading = false;
    });

    this.subJog = this.rachaSrv.listJogadores$(this.rachaId).pipe(
      startWith([] as RachaJogador[]),
      catchError(() => of([] as RachaJogador[])),
    ).subscribe(arr => {
      this.jogadores = arr;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.subJog?.unsubscribe();
  }

  // ============== Métricas ==============

  get totalUsuarios(): number {
    return this.jogadores.filter(j => j.ativo !== false).length;
  }
  get totalSolicitacoes(): number {
    // Em iteração futura: doc `rachas/{id}/solicitacoes` (pedidos pra entrar)
    return 0;
  }

  // ============== Convite ==============

  get codigoConvite(): string {
    return this.racha?.codigoConvite || this.racha?.conviteToken || '—';
  }

  copiarConvite(): void {
    const codigo = this.codigoConvite;
    if (!codigo || codigo === '—') {
      this.toast('Convite ainda não gerado. Configure em Meu Racha.', 'medium');
      return;
    }
    const url = `${location.origin}/racha/c/${codigo}`;
    navigator.clipboard?.writeText(url).then(
      () => this.toast('Link copiado!', 'success'),
      () => this.toast('Falha ao copiar.', 'danger'),
    );
  }

  async publicarRacha(): Promise<void> {
    if (!this.racha) return;
    try {
      const novo = this.racha.visibilidade === 'publico' ? 'privado' : 'publico';
      await this.rachaSrv.atualizar(this.rachaId, { visibilidade: novo });
      this.toast(
        novo === 'publico'
          ? 'Racha publicado! Aparece na busca pública.'
          : 'Racha agora é privado.',
        'success',
      );
    } catch (err) {
      console.error('[VisaoGeral] publicar', err);
      this.toast('Falha ao alterar visibilidade.', 'danger');
    }
  }

  // ============== Tabs ==============

  selecionarTab(t: TabId): void {
    this.tabAtiva = t;
  }

  get usuariosFiltrados(): RachaJogador[] {
    const q = this.busca.trim().toLowerCase();
    const arr = this.jogadores.filter(j => j.ativo !== false);
    if (!q) return arr;
    return arr.filter(j =>
      (j.nome ?? '').toLowerCase().includes(q) ||
      (j.apelido ?? '').toLowerCase().includes(q),
    );
  }

  inicial(j: RachaJogador): string {
    const fonte = j.apelido?.trim() || j.nome?.trim() || '?';
    return fonte.charAt(0).toUpperCase();
  }

  irParaJogadores(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }

  trackByJogador(_i: number, j: RachaJogador): string {
    return j.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
  /** Volta pra tela anterior usando histórico do browser; fallback pra
   *  home do racha quando entrou direto via URL. */
  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}