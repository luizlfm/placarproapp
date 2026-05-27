import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ToastController } from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CobrancasService } from '../../users/cobrancas.service';
import {
  Cobranca,
  MetodoPagamento,
  METODO_PAGAMENTO_LABEL,
} from '../../users/models/cobranca.model';
import { NavBackService } from '../../shared/nav-back.service';
import { MercadoPagoService } from '../../users/mercado-pago.service';

/**
 * Tela de pagamento exibida após o usuário gerar uma cobrança em
 * `/app/planos`. Mostra os dados da cobrança e as opções de pagamento
 * (PIX, Boleto, Cartão de Crédito, Cartão de Débito) — todas integradas
 * com Mercado Pago via Cloud Function `criarPagamentoMP`.
 *
 * Fluxo de cartão:
 *  1) Usuário preenche dados → frontend chama MP SDK pra gerar `cardToken`
 *  2) cardToken (string segura, sem PCI) é enviado pra Cloud Function
 *  3) Cloud Function processa no MP → retorna status (approved/rejected/...)
 *  4) Se approved: cobrança vira `pago` IMEDIATAMENTE + plano é ativado
 *
 * Fluxo de PIX/Boleto:
 *  1) Função MP gera QR/link e salva no doc da cobrança
 *  2) Cliente paga externamente → webhook MP notifica → cobrança vira `pago`
 *
 * Rota: `/pagamento/:cobrancaId`
 */
@Component({
  selector: 'app-pagamento',
  templateUrl: './pagamento.page.html',
  styleUrls: ['./pagamento.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PagamentoPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cobrancasSrv = inject(CobrancasService);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly navBack = inject(NavBackService);
  private readonly mpSrv = inject(MercadoPagoService);

  /** Loading interno enquanto chama a Cloud Function do MP. */
  gerandoPagamento = false;

  readonly METODO_LABEL = METODO_PAGAMENTO_LABEL;

  readonly cobrancaId = this.route.snapshot.paramMap.get('cobrancaId') ?? '';
  cobranca$: Observable<Cobranca | undefined> = of(undefined);

  /** Método selecionado pelo usuário (default: PIX — mais usado no Brasil). */
  metodo: MetodoPagamento = 'pix';

  /** Form do cartão. */
  cartao = {
    numero: '',
    nome: '',
    validade: '',
    cvv: '',
    cpf: '',
    parcelas: 1,
  };

  /** Mensagem amigável de status pós-pagamento de cartão (ou erro). */
  cartaoStatus: { tipo: 'sucesso' | 'erro' | 'pendente'; mensagem: string } | null = null;

  ngOnInit(): void {
    if (!this.cobrancaId) {
      void this.router.navigate(['/app/planos']);
      return;
    }
    this.cobranca$ = this.cobrancasSrv.get$(this.cobrancaId).pipe(
      catchError(err => {
        console.error('[Pagamento] erro ao carregar cobrança', err);
        return of(undefined);
      }),
    );
    // Pré-carrega o SDK do MP em background (não bloqueia a UI)
    void this.mpSrv.ensureLoaded().catch(err =>
      console.warn('[Pagamento] SDK MP falhou no preload', err),
    );
  }

  voltar(): void {
    this.navBack.back(['/app/planos']);
  }

  /**
   * Quando o usuário seleciona um método, chama a Cloud Function pra gerar
   * o pagamento real no Mercado Pago.
   *  - PIX: retorna QR Code (base64) + copia-cola
   *  - Boleto: retorna link do PDF do boleto
   *  - Cartão: NÃO chama aqui — espera o submit do formulário
   */
  async selecionarMetodo(m: MetodoPagamento): Promise<void> {
    this.metodo = m;
    this.cartaoStatus = null;
    if (m === 'cartao_credito' || m === 'cartao_debito') {
      // Cartão é via submitCartao() — apenas troca a aba
      return;
    }
    if (this.gerandoPagamento) return;
    await this.gerarPagamentoMP(m);
  }

  /** Dispara a Cloud Function `criarPagamentoMP` (PIX/Boleto). */
  private async gerarPagamentoMP(metodo: MetodoPagamento): Promise<void> {
    this.gerandoPagamento = true;
    const loader = await this.loadingCtrl.create({
      message: 'Gerando pagamento no Mercado Pago...',
    });
    await loader.present();
    try {
      const result = await this.cobrancasSrv.criarPagamentoMP(this.cobrancaId, metodo);
      if (!result.ok) throw new Error('Cloud Function retornou ok=false');
      await this.toast('Pagamento gerado!', 'success');
    } catch (err) {
      console.error('[Pagamento] criarPagamentoMP falhou', err);
      await this.toast(
        'Falha ao gerar pagamento. Tente novamente ou contate o suporte.',
        'danger',
      );
    } finally {
      this.gerandoPagamento = false;
      try { await loader.dismiss(); } catch { /* ignore */ }
    }
  }

  /**
   * Submete o pagamento por cartão:
   *  1) Valida campos
   *  2) Tokeniza no MP SDK (frontend — número do cartão não vai pro backend)
   *  3) Envia cardToken pra Cloud Function processar
   *  4) Exibe status (approved/rejected/in_process) e redireciona se ok
   */
  async submitCartao(): Promise<void> {
    if (this.gerandoPagamento) return;
    this.cartaoStatus = null;

    const tipo: 'credit_card' | 'debit_card' =
      this.metodo === 'cartao_credito' ? 'credit_card' : 'debit_card';

    this.gerandoPagamento = true;
    const loader = await this.loadingCtrl.create({
      message: 'Processando pagamento...',
    });
    await loader.present();

    try {
      // 1) Tokenizar no frontend
      const tokenInfo = await this.mpSrv.tokenizarCartao(
        {
          numero: this.cartao.numero,
          titular: this.cartao.nome,
          validade: this.cartao.validade,
          cvv: this.cartao.cvv,
          cpf: this.cartao.cpf,
        },
        tipo,
      );

      // 2) Chamar Cloud Function com o token
      const result = await this.cobrancasSrv.criarPagamentoMP(
        this.cobrancaId,
        this.metodo,
        {
          cardToken: tokenInfo.cardToken,
          paymentMethodId: tokenInfo.paymentMethodId,
          issuerId: tokenInfo.issuerId,
          installments: this.metodo === 'cartao_credito' ? this.cartao.parcelas : 1,
          cpf: this.cartao.cpf,
        },
      );
      if (!result.ok) throw new Error('Cloud Function retornou ok=false');

      // 3) Interpretar status retornado
      const status = result.status ?? 'pending';
      if (status === 'approved') {
        this.cartaoStatus = {
          tipo: 'sucesso',
          mensagem: 'Pagamento aprovado! Seu plano já está ativo.',
        };
        await this.toast('Pagamento aprovado!', 'success');
        // Redireciona pra planos depois de 2s
        setTimeout(() => this.router.navigate(['/app/planos']), 2500);
      } else if (status === 'in_process' || status === 'pending') {
        this.cartaoStatus = {
          tipo: 'pendente',
          mensagem: 'Pagamento em análise pelo Mercado Pago. Você receberá um e-mail quando for aprovado.',
        };
        await this.toast('Pagamento em análise.', 'medium');
      } else {
        // rejected / cancelled / etc
        this.cartaoStatus = {
          tipo: 'erro',
          mensagem: this.traduzirRecusa(result.statusDetail ?? status),
        };
        await this.toast('Pagamento recusado.', 'danger');
      }
    } catch (err) {
      console.error('[Pagamento] submitCartao falhou', err);
      const msg = err instanceof Error ? err.message : 'Falha ao processar pagamento.';
      this.cartaoStatus = { tipo: 'erro', mensagem: msg };
      await this.toast(msg, 'danger');
    } finally {
      this.gerandoPagamento = false;
      try { await loader.dismiss(); } catch { /* ignore */ }
    }
  }

  /** Copia texto pra clipboard com feedback toast. */
  async copiar(texto: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      await this.toast(`${label} copiado!`, 'success');
    } catch {
      await this.toast('Falha ao copiar. Selecione manualmente.', 'danger');
    }
  }

  /** Formata centavos como string R$. */
  formatarValor(centavos: number): string {
    return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
  }

  /** Periodicidade legível. */
  labelPeriodicidade(p: string): string {
    switch (p) {
      case 'mensal':     return 'Mensal';
      case 'trimestral': return 'Trimestral';
      case 'semestral':  return 'Semestral';
      case 'anual':      return 'Anual';
      default:           return p;
    }
  }

  /**
   * Traduz códigos de recusa do Mercado Pago em mensagens amigáveis.
   * Aceita tanto `statusDetail` (códigos cc_rejected_*) quanto mensagens
   * em inglês vindas da API (ex: "Invalid user identification number").
   *
   * Lista oficial: https://www.mercadopago.com.br/developers/pt/docs/checkout-api/response-handling/collection-results
   */
  private traduzirRecusa(statusDetail: string): string {
    const traducoes: Record<string, string> = {
      cc_rejected_bad_filled_card_number: 'Número do cartão inválido. Verifique os dígitos.',
      cc_rejected_bad_filled_date: 'Data de validade inválida.',
      cc_rejected_bad_filled_security_code: 'CVV inválido.',
      cc_rejected_bad_filled_other: 'Dados do cartão inválidos. Revise os campos.',
      cc_rejected_insufficient_amount: 'Saldo insuficiente no cartão.',
      cc_rejected_high_risk: 'Pagamento recusado por suspeita de fraude. Use outro cartão.',
      cc_rejected_call_for_authorize: 'Você precisa autorizar com seu banco antes de tentar novamente.',
      cc_rejected_card_disabled: 'Cartão desabilitado. Ligue para o emissor.',
      cc_rejected_duplicated_payment: 'Pagamento duplicado. Aguarde alguns minutos antes de tentar.',
      cc_rejected_card_error: 'Erro com o cartão. Tente novamente ou use outro.',
      cc_rejected_max_attempts: 'Muitas tentativas. Tente outro cartão ou aguarde.',
      cc_rejected_other_reason: 'Pagamento recusado pelo banco emissor. Use outro cartão.',
      // Mensagens em inglês da API do MP (vindas direto do err.cause[0].description)
      'Invalid user identification number': 'CPF inválido. Verifique os dígitos.',
      'Invalid users involved': 'Não é possível pagar pra si mesmo (use uma conta diferente).',
      'Invalid security_code_length': 'CVV com tamanho inválido. Amex usa 4 dígitos, demais 3.',
      'Invalid card_number_length': 'Número do cartão com tamanho inválido.',
      'Invalid expiration_year': 'Ano de validade inválido.',
      'Invalid expiration_month': 'Mês de validade inválido.',
      'Invalid card_number': 'Número do cartão inválido.',
      'Card token not found': 'Erro ao tokenizar cartão. Tente recarregar a página.',
      'No result found for the given parameters':
        'Método de pagamento não disponível pra essa bandeira/conta. ' +
        'Tente outro cartão ou outra forma (PIX/Crédito).',
    };
    return traducoes[statusDetail]
      ?? statusDetail
      ?? 'Pagamento recusado pelo Mercado Pago. Verifique os dados ou use outro cartão.';
  }

  /** Aplica máscara enquanto digita o número do cartão (4444 4444 4444 4444). */
  onNumeroInput(ev: Event): void {
    const inp = ev.target as HTMLInputElement;
    const digitos = inp.value.replace(/\D/g, '').slice(0, 19);
    this.cartao.numero = digitos.replace(/(.{4})/g, '$1 ').trim();
  }

  /** Máscara MM/AA. */
  onValidadeInput(ev: Event): void {
    const inp = ev.target as HTMLInputElement;
    const digitos = inp.value.replace(/\D/g, '').slice(0, 4);
    if (digitos.length <= 2) {
      this.cartao.validade = digitos;
    } else {
      this.cartao.validade = digitos.slice(0, 2) + '/' + digitos.slice(2);
    }
  }

  /** Máscara CPF 000.000.000-00. */
  onCpfInput(ev: Event): void {
    const inp = ev.target as HTMLInputElement;
    const d = inp.value.replace(/\D/g, '').slice(0, 11);
    let out = d;
    if (d.length > 3) out = d.slice(0, 3) + '.' + d.slice(3);
    if (d.length > 6) out = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
    if (d.length > 9) out = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    this.cartao.cpf = out;
  }

  /**
   * Opções de parcelamento — CACHEADAS por valor pra evitar NG0103
   * (infinite change detection). Se chamássemos `parcelasOpcoes(c.valorCentavos)`
   * direto num `*ngFor` no template, cada CD criaria array novo → Angular
   * detecta mudança → CD de novo → loop infinito.
   */
  private _parcelasCache: { centavos: number; opts: Array<{ n: number; label: string }> } | null = null;

  parcelasOpcoes(centavos: number): Array<{ n: number; label: string }> {
    if (this._parcelasCache?.centavos === centavos) return this._parcelasCache.opts;
    const opts: Array<{ n: number; label: string }> = [];
    for (let n = 1; n <= 12; n++) {
      const v = centavos / n;
      const label = `${n}× de R$ ${(v / 100).toFixed(2).replace('.', ',')}${n === 1 ? '' : ' sem juros'}`;
      opts.push({ n, label });
    }
    this._parcelasCache = { centavos, opts };
    return opts;
  }

  /** trackBy pro *ngFor de parcelas — estabiliza identidade. */
  trackParcela(_i: number, p: { n: number }): number {
    return p.n;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }
}
