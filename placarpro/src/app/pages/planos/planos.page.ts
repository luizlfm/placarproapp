import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { UsersService } from '../../users/users.service';
import { PlanosService, PlanoId } from '../../users/planos.service';
import { CobrancasService } from '../../users/cobrancas.service';
import { AuthService } from '../../auth/auth.service';
import {
  EscolherPeriodicidadeModalComponent,
  EscolherPeriodicidadeResult,
} from './escolher-periodicidade-modal/escolher-periodicidade-modal.component';

interface Feature {
  icon: string;
  titulo: string;
  desc: string;
}

interface Plano {
  id: 'pequeno' | 'medio' | 'grande' | 'profissional';
  label: string;
  preco: string;
  detalhe: string;
  cor: string;
  destaque?: boolean;
  features: Feature[];
}

@Component({
  selector: 'app-planos',
  templateUrl: './planos.page.html',
  styleUrls: ['./planos.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PlanosPage {
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);
  private readonly users = inject(UsersService);
  private readonly planosSrv = inject(PlanosService);
  private readonly cobrancasSrv = inject(CobrancasService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Plano atual do usuário, lido do perfil em Firestore. */
  readonly planoAtual$: Observable<Plano['id']> = this.users.profile$().pipe(
    map(p => (p?.plano as Plano['id']) ?? 'pequeno'),
  );

  /**
   * Preço mensal exibido no card — lê do `PlanosService` (que já aplica os
   * overrides editados pelo admin em `config/comercial`). Profissional fica
   * "Sob consulta".
   */
  precoMensalExibicao(id: Plano['id']): string {
    if (id === 'profissional') return 'Sob consulta';
    const def = this.planosSrv.getPlanoDef(id);
    return `R$ ${def.precos.mensal}`;
  }

  readonly planos: Plano[] = [
    {
      id: 'pequeno',
      label: 'Pequenos Campeonatos',
      preco: 'R$ 19',
      detalhe: '/mês',
      cor: 'linear-gradient(135deg, #000000 0%, #324350 100%)',
      features: [
        { icon: 'trophy-outline', titulo: '3 campeonatos', desc: 'Crie e gerencie até 3 campeonatos simultaneamente.' },
        { icon: 'people-outline', titulo: 'Maior limite de jogadores', desc: 'Adicione até 300 jogadores por campeonato.' },
        { icon: 'megaphone-outline', titulo: 'Adicionar Patrocinadores', desc: 'Adicione patrocinadores por campeonato.' },
        { icon: 'radio-outline', titulo: 'transmissões ao vivo', desc: 'Transmita seus jogos ao vivo pelo site, layout personalizado.' },
        { icon: 'globe-outline', titulo: 'Definir link do site', desc: 'placarpro.app/seu-campeonato' },
        { icon: 'image-outline', titulo: 'Melhor resolução de imagens', desc: 'Imagens em qualidade superior.' },
        { icon: 'videocam-outline', titulo: 'Enviar vídeos', desc: 'Vídeos de até 2 minutos.' },
        { icon: 'attach-outline', titulo: 'Adicionar anexo', desc: 'Disponibilize documentos no campeonato.' },
        { icon: 'document-text-outline', titulo: 'Imprimir Relatórios', desc: 'Equipes, jogadores, carteirinhas e mais.' },
      ],
    },
    {
      id: 'medio',
      label: 'Campeonatos Médios',
      preco: 'R$ 39',
      detalhe: '/mês',
      destaque: true,
      cor: 'linear-gradient(135deg, #E89132 0%, #F4A93E 100%)',
      features: [
        { icon: 'trophy-outline', titulo: '10 campeonatos', desc: 'Crie e gerencie até 10 campeonatos simultaneamente.' },
        { icon: 'people-outline', titulo: 'Maior limite de jogadores', desc: 'Adicione até 600 jogadores por campeonato.' },
        { icon: 'megaphone-outline', titulo: 'Adicionar Patrocinadores', desc: 'Adicione patrocinadores por campeonato.' },
        { icon: 'radio-outline', titulo: 'transmissões ao vivo', desc: 'Transmita seus jogos ao vivo pelo site, layout personalizado.' },
        { icon: 'color-palette-outline', titulo: 'White-label (sua marca)', desc: 'Personalize o app com sua identidade visual.' },
        { icon: 'globe-outline', titulo: 'Definir link do site', desc: 'Link personalizado.' },
        { icon: 'image-outline', titulo: 'Melhor resolução de imagens', desc: 'Qualidade superior.' },
        { icon: 'videocam-outline', titulo: 'Enviar vídeos', desc: 'Até 5 minutos.' },
        { icon: 'attach-outline', titulo: 'Adicionar anexo', desc: 'Documentos no campeonato.' },
        { icon: 'document-text-outline', titulo: 'Imprimir Relatórios', desc: 'Equipes, jogadores, carteirinhas.' },
      ],
    },
    {
      id: 'grande',
      label: 'Campeonatos Grandes',
      preco: 'R$ 79',
      detalhe: '/mês',
      cor: 'linear-gradient(135deg, #6B47C9 0%, #8B6FE0 100%)',
      features: [
        { icon: 'trophy-outline', titulo: '30 campeonatos', desc: 'Crie e gerencie até 30 campeonatos simultaneamente.' },
        { icon: 'people-outline', titulo: 'Maior limite de jogadores', desc: 'Adicione até 900 jogadores por campeonato.' },
        { icon: 'megaphone-outline', titulo: 'Adicionar Patrocinadores', desc: 'Adicione patrocinadores por campeonato.' },
        { icon: 'radio-outline', titulo: 'transmissões ao vivo', desc: 'Transmita seus jogos ao vivo pelo site, layout personalizado.' },
        { icon: 'color-palette-outline', titulo: 'White-label (sua marca)', desc: 'Personalize o app com sua identidade visual.' },
        { icon: 'globe-outline', titulo: 'Definir link do site', desc: 'Link personalizado.' },
        { icon: 'image-outline', titulo: 'Melhor resolução de imagens', desc: 'Qualidade superior.' },
        { icon: 'videocam-outline', titulo: 'Enviar vídeos', desc: 'Até 10 minutos.' },
        { icon: 'attach-outline', titulo: 'Adicionar anexo', desc: 'Documentos no campeonato.' },
        { icon: 'document-text-outline', titulo: 'Imprimir Relatórios', desc: 'Todos os relatórios.' },
      ],
    },
    {
      id: 'profissional',
      label: 'Organizador Profissional',
      preco: 'Sob consulta',
      detalhe: 'fale com a gente',
      cor: 'linear-gradient(135deg, #1A1A1A 0%, #2D2D2D 100%)',
      features: [
        { icon: 'infinite-outline', titulo: 'Campeonatos ilimitados', desc: 'Sem limite de campeonatos simultâneos.' },
        { icon: 'people-outline', titulo: 'Maior limite de jogadores', desc: 'Sem limite de jogadores.' },
        { icon: 'megaphone-outline', titulo: 'Adicionar Patrocinadores', desc: 'Adicione patrocinadores por campeonato.' },
        { icon: 'radio-outline', titulo: 'transmissões ao vivo', desc: 'Transmita seus jogos ao vivo pelo site, layout personalizado.' },
        { icon: 'color-palette-outline', titulo: 'White-label (sua marca)', desc: 'Personalize o app com sua identidade visual.' },
        { icon: 'globe-outline', titulo: 'Definir link do site', desc: 'Link personalizado.' },
        { icon: 'image-outline', titulo: 'Melhor resolução de imagens', desc: 'Qualidade superior.' },
        { icon: 'videocam-outline', titulo: 'Enviar vídeos', desc: 'Sem limite de duração.' },
        { icon: 'attach-outline', titulo: 'Adicionar anexo', desc: 'Documentos no campeonato.' },
        { icon: 'document-text-outline', titulo: 'Imprimir Relatórios', desc: 'Todos os relatórios.' },
      ],
    },
  ];

  /**
   * Fluxo de assinatura — NÃO altera o plano direto. Cria uma cobrança
   * com status 'aguardando' e exibe instruções. O plano só muda DEPOIS
   * que o admin master marca a cobrança como paga (em /app/admin →
   * Cobranças → "Marcar pago").
   */
  async escolher(p: Plano, atual: Plano['id']): Promise<void> {
    if (p.id === atual) {
      await this.toast(`Você já está no plano "${p.label}".`, 'medium');
      return;
    }
    if (p.id === 'profissional') {
      await this.toast('Entraremos em contato pra ativar o plano Profissional.', 'primary');
      return;
    }

    // Resolve a def completa do plano (com preços por período)
    const planoDef = this.planosSrv.getPlanoDef(p.id);

    // 1) Modal pra escolher periodicidade
    const modal = await this.modalCtrl.create({
      component: EscolherPeriodicidadeModalComponent,
      componentProps: { plano: planoDef },
      cssClass: 'modal-escolher-periodicidade',
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<EscolherPeriodicidadeResult | null>();
    if (!data) return; // usuário cancelou

    // 2) Cria a cobrança em status 'aguardando'
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      await this.toast('Faça login pra continuar.', 'danger');
      return;
    }

    try {
      const profile = await this.firstProfile();
      const vencimento = this.calcularVencimento(7); // 7 dias úteis
      // Monta payload e remove campos undefined — Firestore rejeita undefined
      // (precisa ser ausente ou null, nunca undefined).
      const payload = this.limparUndefined({
        usuarioId: uid,
        usuarioEmail: profile?.email,
        usuarioNome: profile?.nome,
        planoId: p.id as PlanoId,
        periodicidade: data.periodicidade,
        valorCentavos: data.valorCentavos,
        vencimento,
        status: 'aguardando' as const,
        observacao: `Assinatura iniciada via /app/planos (período ${data.periodicidade}).`,
        criadoPor: uid,
      });
      const cobrancaId = await this.cobrancasSrv.criar(
        payload as Parameters<typeof this.cobrancasSrv.criar>[0],
      );
      // Redireciona pra tela de pagamento — usuário escolhe PIX/Boleto/Cartão.
      // (substitui o alert anterior, que era confuso e parava o fluxo)
      await this.router.navigate(['/pagamento', cobrancaId]);
    } catch (err) {
      console.error('[Planos] criar cobrança falhou', err);
      await this.toast('Falha ao gerar cobrança. Tente novamente.', 'danger');
    }
  }

  /**
   * Remove chaves cujo valor é `undefined`. Útil pra payloads de Firestore
   * já que `addDoc`/`setDoc` rejeitam undefined (mas aceitam null e ausência).
   */
  private limparUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v !== undefined) out[k] = v;
    }
    return out as Partial<T>;
  }

  /**
   * Lê o perfil do usuário pra denormalizar nome/email na cobrança.
   * Tenta primeiro o Firebase Auth (que pode ter displayName null em
   * signups por email/senha) e cai pro doc `users/{uid}.nome` como
   * fallback. Trata null/undefined corretamente — nunca retorna undefined
   * em campo dentro do objeto.
   */
  private async firstProfile(): Promise<{ nome?: string; email?: string }> {
    const u = this.auth.currentUser;
    const result: { nome?: string; email?: string } = {};
    if (u?.email) result.email = u.email;
    if (u?.displayName) {
      result.nome = u.displayName;
      return result;
    }
    // Fallback: lê do Firestore (users/{uid}.nome)
    try {
      const profile = await new Promise<{ nome?: string } | undefined>((resolve) => {
        const sub = this.users.profile$().subscribe(p => {
          resolve(p ? { nome: p.nome } : undefined);
          setTimeout(() => sub.unsubscribe(), 0);
        });
      });
      if (profile?.nome) result.nome = profile.nome;
    } catch {
      /* silencioso — cobrança aceita sem nome */
    }
    return result;
  }

  /** Calcula data de vencimento somando N dias úteis a partir de hoje. */
  private calcularVencimento(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    return d.toISOString().split('T')[0];
  }

  /** Alert amigável após criar cobrança — explica que precisa aguardar admin. */
  private async mostrarSucessoCobranca(planoLabel: string): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Cobrança gerada!',
      message:
        `Sua assinatura do plano <strong>${planoLabel}</strong> foi registrada. ` +
        `Em breve você receberá as instruções de pagamento. ` +
        `<br><br>O plano será ativado automaticamente após confirmação do pagamento.`,
      buttons: ['OK'],
    });
    await alert.present();
  }

  private async toast(message: string, color: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color });
    await t.present();
  }
}
