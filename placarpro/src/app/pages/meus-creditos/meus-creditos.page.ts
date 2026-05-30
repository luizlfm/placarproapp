import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UsersService } from '../../users/users.service';
import { CREDITO_PATROCINIO, PREMIUM_PATROCINIO } from '../../campeonatos/models/patrocinio-jogo.model';
import { PlanosService, PlanoId } from '../../users/planos.service';
import { CobrancasService } from '../../users/cobrancas.service';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-meus-creditos',
  templateUrl: './meus-creditos.page.html',
  styleUrls: ['./meus-creditos.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class MeusCreditosPage {
  private readonly usersSrv = inject(UsersService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly planosSrv = inject(PlanosService);
  private readonly cobrancasSrv = inject(CobrancasService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Saldo de créditos NORMAL do organizador, reativo. */
  readonly saldo$: Observable<number> = this.usersSrv.profile$().pipe(
    map(p => p?.creditosPatrocinio ?? 0),
  );

  /** Saldo de créditos PREMIUM. */
  readonly saldoPremium$: Observable<number> = this.usersSrv.profile$().pipe(
    map(p => p?.creditosPatrocinioPremium ?? 0),
  );

  /** Saldo de créditos de TRANSMISSÃO (avulsos), reativo. */
  readonly transmissoes$: Observable<number> = this.usersSrv.profile$().pipe(
    map(p => p?.transmissoesExtras ?? 0),
  );

  /** Constantes dos dois modelos pra exibição no template (formato/duração). */
  readonly NORMAL = CREDITO_PATROCINIO;
  readonly PREMIUM = PREMIUM_PATROCINIO;

  /** Preços unitários (R$) — editáveis pelo admin via config comercial. */
  get precoNormal(): number { return this.planosSrv.precoCreditoNormal; }
  get precoPremium(): number { return this.planosSrv.precoCreditoPremium; }

  /** Parâmetros editáveis (tempo / patrocinadores) — config comercial. */
  get patrocinadoresNormal(): number { return this.planosSrv.patrocinadoresCreditoNormal; }
  get duracaoNormalHoras(): number { return this.planosSrv.duracaoCreditoNormalMin / 60; }
  get premiumJanelaSeg(): number { return this.planosSrv.premiumJanelaSeg; }
  get premiumIntervaloMin(): number { return this.planosSrv.premiumIntervaloMin; }
  get premiumMaxPorJogo(): number { return this.planosSrv.premiumMaxPorJogo; }
  get transmissaoValidadeMeses(): number { return this.planosSrv.transmissaoValidadeMeses; }
  get transmissaoDuracaoMin(): number { return this.planosSrv.transmissaoDuracaoMin; }
  /** Rótulo amigável do tempo do crédito de transmissão (ex.: "1 hora", "90 min"). */
  get transmissaoDuracaoLabel(): string {
    const m = this.transmissaoDuracaoMin;
    if (m % 60 === 0) {
      const h = m / 60;
      return `${h} hora${h > 1 ? 's' : ''}`;
    }
    return `${m} min`;
  }

  /** Quantidade de transmissões avulsas a solicitar (stepper). */
  qtdAvulso = 1;
  get VALOR_AVULSO(): number { return this.planosSrv.VALOR_TRANSMISSAO_AVULSA; }
  get totalAvulso(): number { return this.qtdAvulso * this.VALOR_AVULSO; }
  ajustarQtdAvulso(delta: number): void {
    this.qtdAvulso = this.clampQtd(this.qtdAvulso + delta);
  }

  /** Quantidade de créditos de patrocínio NORMAL a comprar (stepper). */
  qtdNormal = 1;
  get totalNormal(): number { return this.qtdNormal * this.precoNormal; }
  ajustarQtdNormal(delta: number): void {
    this.qtdNormal = this.clampQtd(this.qtdNormal + delta);
  }

  /** Quantidade de créditos de patrocínio PREMIUM a comprar (stepper). */
  qtdPremium = 1;
  get totalPremium(): number { return this.qtdPremium * this.precoPremium; }
  ajustarQtdPremium(delta: number): void {
    this.qtdPremium = this.clampQtd(this.qtdPremium + delta);
  }

  /** Mantém a quantidade entre 1 e 50. */
  private clampQtd(v: number): number {
    return Math.max(1, Math.min(50, v));
  }

  /**
   * Solicita compra de créditos de patrocínio (Normal ou Premium).
   * v1: instruções de Pix via alerta — o admin libera os créditos no
   * painel após confirmar o pagamento.
   */
  async comprarCreditoPatrocinio(tipoLabel: string, creditos: number, precoReais: number): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: `${creditos} crédito${creditos > 1 ? 's' : ''} · ${tipoLabel}`,
      message:
        `Valor: <strong>R$ ${precoReais.toFixed(2).replace('.', ',')}</strong><br><br>` +
        `Pagamento por Pix (v1):<br>` +
        `1. Faça o Pix pra <strong>CHAVE-PIX-AQUI</strong><br>` +
        `2. Envie comprovante pro WhatsApp (XX) XXXXX-XXXX<br>` +
        `3. Créditos liberados em até 1h útil.`,
      buttons: [
        { text: 'Fechar', role: 'cancel' },
        {
          text: 'Copiar chave Pix',
          handler: async () => {
            try {
              await navigator.clipboard.writeText('CHAVE-PIX-AQUI');
              const t = await this.toastCtrl.create({
                message: 'Chave Pix copiada!',
                duration: 1800,
                color: 'success',
                position: 'top',
              });
              await t.present();
            } catch { /* ignore */ }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Cria cobrança de transmissão avulsa (R$30 cada).
   * Segue o mesmo padrão das assinaturas: status 'aguardando' →
   * admin confirma pagamento → adiciona créditos ao usuário.
   */
  async solicitarAvulso(): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) { await this.toast('Faça login pra continuar.', 'danger'); return; }

    const qtd = this.qtdAvulso;
    const valorCentavos = qtd * this.VALOR_AVULSO * 100;

    try {
      const profile = await this.firstProfile();
      const vencimento = this.calcularVencimento(7);
      const payload = this.limparUndefined({
        tipo: 'transmissao-avulsa' as const,
        usuarioId: uid,
        usuarioEmail: profile?.email,
        usuarioNome: profile?.nome,
        planoId: 'gratis' as PlanoId,          // planoId obrigatório — irrelevante neste tipo
        periodicidade: 'mensal' as const,      // periodicidade obrigatória — irrelevante aqui
        quantidadeTransmissoes: qtd,
        valorCentavos,
        vencimento,
        status: 'aguardando' as const,
        observacao: `Solicitação de ${qtd} transmissão(ões) avulsa(s) — R$ ${(valorCentavos / 100).toFixed(2)}.`,
        criadoPor: uid,
      });
      const cobrancaId = await this.cobrancasSrv.criar(
        payload as Parameters<typeof this.cobrancasSrv.criar>[0],
      );
      await this.router.navigate(['/pagamento', cobrancaId]);
    } catch (err) {
      console.error('[MeusCreditos] avulso falhou', err);
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
   * fallback.
   */
  private async firstProfile(): Promise<{ nome?: string; email?: string }> {
    const u = this.auth.currentUser;
    const result: { nome?: string; email?: string } = {};
    if (u?.email) result.email = u.email;
    if (u?.displayName) {
      result.nome = u.displayName;
      return result;
    }
    try {
      const profile = await new Promise<{ nome?: string } | undefined>((resolve) => {
        const sub = this.usersSrv.profile$().subscribe(p => {
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

  private async toast(message: string, color: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color });
    await t.present();
  }
}
