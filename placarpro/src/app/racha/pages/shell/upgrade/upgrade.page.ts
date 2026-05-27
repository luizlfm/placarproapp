import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { PlanoRacha, Racha } from '../../../models/racha.model';

interface UsoMes {
  label: string;
  icon: string;
  usado: number;
  limite: number;
  unidade: string;
}

interface PlanoCard {
  id: PlanoRacha;
  nome: string;
  precoMes: number;
  badge?: { label: string; icon: string; cor: string };
  features: { label: string; ativo: boolean; pro?: boolean }[];
  ctaLabel: string;
  ctaCor: 'lime' | 'amarelo';
}

/**
 * Página UPGRADE PREMIUM — visualização dos planos do racha + uso atual.
 * Mostra 3 cards: GRATUITO (atual padrão), PREMIUM (R$19,90), PRO (R$24,90).
 */
@Component({
  selector: 'app-racha-upgrade',
  templateUrl: './upgrade.page.html',
  styleUrls: ['./upgrade.page.scss'],
  standalone: false,
})
export class RachaUpgradePage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  rachaId = '';
  loading = true;
  racha?: Racha;

  /** Uso do racha no mês — placeholder até termos contadores reais. */
  readonly uso: UsoMes[] = [
    { label: 'Estatísticas por voz', icon: 'mic-outline',         usado: 0, limite: 50,   unidade: 'usados' },
    { label: 'Lista de presença',    icon: 'people-outline',      usado: 0, limite: 2,    unidade: 'usadas' },
    { label: 'Financeiro',           icon: 'wallet-outline',      usado: 0, limite: 1000, unidade: 'R$' },
    { label: 'Notificações WhatsApp', icon: 'logo-whatsapp',      usado: 0, limite: 60,   unidade: 'usadas' },
  ];

  readonly planos: PlanoCard[] = [
    {
      id: 'gratis',
      nome: 'GRATUITO',
      precoMes: 0,
      features: [
        { label: 'Estatísticas por voz — 50/mês', ativo: true },
        { label: 'Lista de presença — 2/mês', ativo: true },
        { label: 'Financeiro — R$ 1.000', ativo: true },
        { label: 'WhatsApp do Racha', ativo: false },
        { label: 'Conquistas & Níveis', ativo: false },
      ],
      ctaLabel: 'PLANO ATUAL',
      ctaCor: 'lime',
    },
    {
      id: 'premium',
      nome: 'RACHA PREMIUM',
      precoMes: 19.90,
      badge: { label: 'MAIS POPULAR', icon: 'flame', cor: '#14b8a6' },
      features: [
        { label: 'Estatísticas por voz ilimitadas', ativo: true },
        { label: 'Lista de presença ilimitada', ativo: true },
        { label: 'Financeiro ilimitado', ativo: true },
        { label: 'WhatsApp do Racha', ativo: false },
        { label: 'Conquistas & Níveis', ativo: false },
      ],
      ctaLabel: 'ATIVAR RACHA PREMIUM',
      ctaCor: 'lime',
    },
    {
      id: 'pro',
      nome: 'RACHA PREMIUM PRO',
      precoMes: 24.90,
      badge: { label: 'MELHOR CUSTO-BENEFÍCIO', icon: 'sparkles', cor: '#16a34a' },
      features: [
        { label: 'Estatísticas por voz ilimitadas', ativo: true },
        { label: 'Lista de presença ilimitada', ativo: true },
        { label: 'Financeiro ilimitado', ativo: true },
        { label: 'WhatsApp do Racha — incluído', ativo: true, pro: true },
        { label: 'Menu Ao Vivo — liberado para todos', ativo: true, pro: true },
        { label: 'Avaliação de Jogadores — Mercado de Notas', ativo: true, pro: true },
        { label: 'Conquistas & Níveis — progressão completa', ativo: true, pro: true },
      ],
      ctaLabel: 'ATIVAR RACHA PREMIUM PRO',
      ctaCor: 'amarelo',
    },
  ];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.sub = this.rachaSrv.get$(this.rachaId).pipe(
      startWith(undefined),
      catchError(err => { console.error('[Upgrade] get', err); return of(undefined); }),
    ).subscribe(r => {
      this.racha = r ?? undefined;
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get planoAtual(): PlanoRacha {
    return this.racha?.plano ?? 'gratis';
  }

  pctUso(u: UsoMes): number {
    if (u.limite <= 0) return 0;
    return Math.min(100, Math.round((u.usado / u.limite) * 100));
  }

  formatUso(u: UsoMes): string {
    if (u.unidade === 'R$') {
      return `R$ ${u.usado} de R$ ${u.limite}`;
    }
    return `${u.usado} de ${u.limite} ${u.unidade}`;
  }

  /** Click no botão de plano — confirma e atualiza o doc.
   *  Pagamento real ainda não tá ligado (integração Stripe/PIX em outra task). */
  async escolherPlano(p: PlanoCard): Promise<void> {
    if (p.id === this.planoAtual) {
      this.toast('Esse já é o seu plano atual.', 'medium');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: `Ativar ${p.nome}?`,
      message: p.precoMes > 0
        ? `Você será redirecionado para o pagamento de <b>R$ ${p.precoMes.toFixed(2)}/mês</b>. Cancele quando quiser, sem fidelidade.`
        : `Voltar ao plano <b>Gratuito</b>?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Confirmar',
          role: 'confirm',
          handler: async () => {
            const loader = await this.loadingCtrl.create({ message: 'Atualizando plano...' });
            await loader.present();
            try {
              await this.rachaSrv.atualizar(this.rachaId, { plano: p.id });
              this.toast(`Plano alterado para ${p.nome}!`, 'success');
            } catch (err) {
              console.error('[Upgrade] alterar plano', err);
              this.toast('Falha ao alterar plano.', 'danger');
            } finally {
              await loader.dismiss();
            }
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  scrollParaPlanos(): void {
    const el = document.getElementById('rp-planos');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  formatPreco(n: number): string {
    if (n === 0) return '0';
    return n.toFixed(2).replace('.', ',');
  }

  trackByPlano(_i: number, p: PlanoCard): string {
    return p.id;
  }
  trackByUso(_i: number, u: UsoMes): string {
    return u.label;
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