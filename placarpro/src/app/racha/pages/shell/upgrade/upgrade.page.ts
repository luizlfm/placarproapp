import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { RachaPlanosService } from '../../../racha-planos.service';
import { PlanoRacha, Racha } from '../../../models/racha.model';
import { AuthService } from '../../../../auth/auth.service';
import { UsersService } from '../../../../users/users.service';
import { CobrancasService } from '../../../../users/cobrancas.service';
import { PlanoRachaId } from '../../../../users/models/cobranca.model';
import {
  EscolherPeriodicidadeModalComponent,
  EscolherPeriodicidadeResult,
} from '../../../../pages/planos/escolher-periodicidade-modal/escolher-periodicidade-modal.component';

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
  private readonly rachaPlanosSrv = inject(RachaPlanosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly auth = inject(AuthService);
  private readonly users = inject(UsersService);
  private readonly cobrancasSrv = inject(CobrancasService);
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

  /**
   * Click no botão de plano. Mesmo fluxo da tela de Planos dos campeonatos:
   *  - Plano atual → nada a fazer.
   *  - Downgrade pro Gratuito → confirma e atualiza o doc direto (sem cobrança).
   *  - Plano pago → abre o modal de periodicidade, cria uma cobrança
   *    (`tipo: 'racha-assinatura'`, status `aguardando`) e redireciona pra
   *    tela de pagamento (`/pagamento/:id`). O plano só é ativado depois que
   *    o pagamento é confirmado (admin marca pago / webhook MP).
   */
  async escolherPlano(p: PlanoCard): Promise<void> {
    if (p.id === this.planoAtual) {
      this.toast('Esse já é o seu plano atual.', 'medium');
      return;
    }

    // Downgrade pro Gratuito — sem cobrança.
    if (p.id === 'gratis' || p.precoMes <= 0) {
      await this.voltarParaGratuito();
      return;
    }

    await this.iniciarAssinatura(p);
  }

  /** Confirma e volta o racha pro plano Gratuito (sem cobrança). */
  private async voltarParaGratuito(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Voltar ao plano Gratuito?',
      message: 'Os recursos premium do racha serão desativados ao fim do período pago.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Confirmar',
          role: 'confirm',
          handler: async () => {
            const loader = await this.loadingCtrl.create({ message: 'Atualizando plano...' });
            await loader.present();
            try {
              await this.rachaSrv.atualizar(this.rachaId, { plano: 'gratis' });
              this.toast('Plano alterado para Gratuito.', 'success');
            } catch (err) {
              console.error('[Upgrade] downgrade gratis', err);
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

  /** Abre o modal de periodicidade → cria cobrança → vai pro pagamento. */
  private async iniciarAssinatura(p: PlanoCard): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      this.toast('Faça login pra continuar.', 'danger');
      return;
    }

    // 1) Modal de periodicidade (reusa o dos campeonatos com a def do racha).
    const planoDef = this.rachaPlanosSrv.getPlanoDefCompat(p.id as PlanoRachaId);
    const modal = await this.modalCtrl.create({
      component: EscolherPeriodicidadeModalComponent,
      componentProps: { plano: planoDef },
      cssClass: 'modal-escolher-periodicidade',
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<EscolherPeriodicidadeResult | null>();
    if (!data) return; // cancelou

    // 2) Cria a cobrança em status 'aguardando'.
    const loader = await this.loadingCtrl.create({ message: 'Gerando cobrança...' });
    await loader.present();
    try {
      const perfil = await this.dadosUsuario();
      const payload = this.limparUndefined({
        tipo: 'racha-assinatura' as const,
        usuarioId: uid,
        usuarioEmail: perfil.email,
        usuarioNome: perfil.nome,
        rachaId: this.rachaId,
        rachaNome: this.racha?.nome,
        planoRacha: p.id as PlanoRachaId,
        periodicidade: data.periodicidade,
        valorCentavos: data.valorCentavos,
        vencimento: this.calcularVencimento(7),
        status: 'aguardando' as const,
        observacao: `Assinatura do racha "${this.racha?.nome ?? this.rachaId}" (${p.nome}, período ${data.periodicidade}).`,
        criadoPor: uid,
      });
      const cobrancaId = await this.cobrancasSrv.criar(
        payload as Parameters<typeof this.cobrancasSrv.criar>[0],
      );
      await loader.dismiss();
      await this.router.navigate(['/pagamento', cobrancaId]);
    } catch (err) {
      console.error('[Upgrade] criar cobrança racha', err);
      await loader.dismiss();
      this.toast('Falha ao gerar cobrança. Tente novamente.', 'danger');
    }
  }

  /** Nome/email do usuário pra denormalizar na cobrança. */
  private async dadosUsuario(): Promise<{ nome?: string; email?: string }> {
    const u = this.auth.currentUser;
    const out: { nome?: string; email?: string } = {};
    if (u?.email) out.email = u.email;
    if (u?.displayName) out.nome = u.displayName;
    if (!out.nome) {
      try {
        const perfil = await new Promise<{ nome?: string } | undefined>(resolve => {
          const sub = this.users.profile$().subscribe(prof => {
            resolve(prof ? { nome: prof.nome } : undefined);
            setTimeout(() => sub.unsubscribe(), 0);
          });
        });
        if (perfil?.nome) out.nome = perfil.nome;
      } catch { /* cobrança aceita sem nome */ }
    }
    return out;
  }

  /** Remove chaves undefined (Firestore rejeita undefined). */
  private limparUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      if (obj[k] !== undefined) out[k] = obj[k];
    }
    return out as Partial<T>;
  }

  /** Data de vencimento somando N dias a partir de hoje (YYYY-MM-DD). */
  private calcularVencimento(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().split('T')[0];
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