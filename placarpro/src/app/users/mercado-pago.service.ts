import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Tipos do SDK do Mercado Pago — declarados localmente porque o SDK é
 * carregado via <script> dinâmico (não tem types do npm).
 *
 * Docs: https://www.mercadopago.com.br/developers/pt/docs/sdks-library/client-side/mp-js-v2
 */
declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
  }
}

interface MercadoPagoInstance {
  createCardToken(params: {
    cardNumber: string;
    cardholderName: string;
    cardExpirationMonth: string;
    cardExpirationYear: string;
    securityCode: string;
    identificationType: string; // ex: "CPF"
    identificationNumber: string;
  }): Promise<{ id: string; status?: string }>;
  getPaymentMethods(params: { bin: string }): Promise<{
    results: Array<{
      id: string;
      name: string;
      payment_type_id: string;
      issuer?: { id?: number };
    }>;
  }>;
  getInstallments(params: {
    amount: string;
    bin: string;
    paymentTypeId?: string;
  }): Promise<Array<{
    payer_costs: Array<{
      installments: number;
      installment_amount: number;
      total_amount: number;
      labels?: string[];
    }>;
  }>>;
}

export interface DadosCartao {
  numero: string;        // só dígitos
  titular: string;       // como impresso
  validade: string;      // MM/AA
  cvv: string;
  cpf: string;           // só dígitos
}

export interface CardTokenInfo {
  cardToken: string;
  paymentMethodId: string; // visa, master, amex, elo, hipercard, etc
  paymentTypeId?: string;  // credit_card | debit_card
  issuerId?: string;
}

/**
 * Wrapper do SDK JS do Mercado Pago. Lazy-load do script + tokenização
 * do cartão acontecem 100% no browser — o número do cartão NUNCA passa
 * pelo nosso backend (PCI compliance).
 */
@Injectable({ providedIn: 'root' })
export class MercadoPagoService {
  private mp?: MercadoPagoInstance;
  private loadingPromise?: Promise<void>;

  /** Carrega o script da CDN do MP só uma vez. Idempotente. */
  async ensureLoaded(): Promise<void> {
    if (this.mp) return;
    if (!this.loadingPromise) {
      this.loadingPromise = new Promise<void>((resolve, reject) => {
        // Já carregado em algum lugar (outro componente)?
        if (window.MercadoPago) {
          this.mp = new window.MercadoPago(environment.mercadoPagoPublicKey, { locale: 'pt-BR' });
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://sdk.mercadopago.com/js/v2';
        script.async = true;
        script.onload = () => {
          if (!window.MercadoPago) {
            reject(new Error('SDK do Mercado Pago carregou mas window.MercadoPago não foi exposto.'));
            return;
          }
          this.mp = new window.MercadoPago(environment.mercadoPagoPublicKey, { locale: 'pt-BR' });
          resolve();
        };
        script.onerror = () => reject(new Error('Falha ao carregar SDK do Mercado Pago.'));
        document.head.appendChild(script);
      });
    }
    return this.loadingPromise;
  }

  /**
   * Valida CPF pelo algoritmo dos dígitos verificadores (módulo 11).
   * Mercado Pago rejeita CPFs com sequências (111.111.111-11) ou que
   * não passam no algoritmo. Validar aqui evita chamada inútil ao backend.
   */
  private validarCpf(cpf: string): boolean {
    const s = cpf.replace(/\D/g, '');
    if (s.length !== 11) return false;
    // Rejeita sequências (111.111.111-11, 222..., etc)
    if (/^(\d)\1{10}$/.test(s)) return false;

    // Primeiro dígito verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
    let resto = (sum * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(s[9], 10)) return false;

    // Segundo dígito verificador
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(s[i], 10) * (11 - i);
    resto = (sum * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== parseInt(s[10], 10)) return false;

    return true;
  }

  /**
   * Mapeamento crédito → débito do Mercado Pago BR.
   * Usado quando `getPaymentMethods()` não retorna a versão débito
   * de uma bandeira (acontece em sandbox MP às vezes).
   */
  private readonly DEBIT_MAP: Record<string, string> = {
    visa: 'debvisa',
    master: 'debmaster',
    mastercard: 'debmaster',
    elo: 'debelo',
    hipercard: 'debhipercard', // pode não existir — confirma na sua conta MP
  };

  /**
   * Detecta a bandeira do cartão pelo BIN (primeiros 6 dígitos) e retorna
   * o paymentMethodId que a MP usa internamente (`visa`, `master`, `debelo`, etc).
   *
   * Em sandbox, `getPaymentMethods` às vezes não devolve a versão débito —
   * por isso temos fallback hardcoded em DEBIT_MAP.
   */
  async detectarBandeira(numero: string, tipoCartao: 'credit_card' | 'debit_card'): Promise<{
    paymentMethodId: string;
    paymentTypeId: string;
    issuerId?: string;
  } | null> {
    await this.ensureLoaded();
    const bin = numero.replace(/\D/g, '').slice(0, 6);
    if (bin.length < 6) return null;
    try {
      const res = await this.mp!.getPaymentMethods({ bin });
      console.log('[MercadoPago] getPaymentMethods bin=' + bin + ' →', res.results);

      // 1) Procura match exato do tipo (credit_card OU debit_card)
      const exact = res.results.find(m => m.payment_type_id === tipoCartao);
      if (exact) {
        return {
          paymentMethodId: exact.id,
          paymentTypeId: exact.payment_type_id,
          issuerId: exact.issuer?.id?.toString(),
        };
      }

      // 2) Se quer débito mas só veio crédito, mapeia via DEBIT_MAP
      if (tipoCartao === 'debit_card') {
        const credito = res.results.find(m => m.payment_type_id === 'credit_card');
        if (credito && this.DEBIT_MAP[credito.id]) {
          return {
            paymentMethodId: this.DEBIT_MAP[credito.id],
            paymentTypeId: 'debit_card',
            issuerId: credito.issuer?.id?.toString(),
          };
        }
      }

      // 3) Último fallback — usa o primeiro resultado mesmo
      const first = res.results[0];
      if (!first) return null;
      return {
        paymentMethodId: first.id,
        paymentTypeId: first.payment_type_id,
        issuerId: first.issuer?.id?.toString(),
      };
    } catch (err) {
      console.warn('[MercadoPago] getPaymentMethods falhou', err);
      return null;
    }
  }

  /**
   * Tokeniza o cartão. Retorna o cardToken + paymentMethodId que devem
   * ser enviados pra Cloud Function `criarPagamentoMP`.
   */
  async tokenizarCartao(
    dados: DadosCartao,
    tipoCartao: 'credit_card' | 'debit_card',
  ): Promise<CardTokenInfo> {
    await this.ensureLoaded();

    const numeroLimpo = dados.numero.replace(/\D/g, '');
    const cpfLimpo = dados.cpf.replace(/\D/g, '');
    const [mm, aa] = (dados.validade ?? '').split('/').map(s => s.trim());

    if (!numeroLimpo || numeroLimpo.length < 13) {
      throw new Error('Número do cartão inválido.');
    }
    if (!dados.titular?.trim()) {
      throw new Error('Nome do titular obrigatório.');
    }
    if (!mm || !aa || mm.length !== 2 || aa.length !== 2) {
      throw new Error('Validade inválida (use MM/AA).');
    }
    // CVV: Amex = 4 dígitos; resto (Visa, Master, Elo, Hiper) = 3 dígitos.
    // Detectamos Amex pelo BIN (34 ou 37).
    const isAmex = /^3[47]/.test(numeroLimpo);
    const cvvEsperado = isAmex ? 4 : 3;
    if (!dados.cvv || dados.cvv.length !== cvvEsperado) {
      throw new Error(
        `CVV inválido. ${isAmex ? 'Amex usa 4 dígitos' : 'Use 3 dígitos'} (você digitou ${dados.cvv?.length ?? 0}).`,
      );
    }
    if (cpfLimpo.length !== 11) {
      throw new Error('CPF inválido.');
    }
    if (!this.validarCpf(cpfLimpo)) {
      throw new Error('CPF inválido — verifique os dígitos.');
    }

    // Ano vai como AA — MP espera 2 dígitos (ex: "29" para 2029)
    const tokenResult = await this.mp!.createCardToken({
      cardNumber: numeroLimpo,
      cardholderName: dados.titular.trim(),
      cardExpirationMonth: mm,
      cardExpirationYear: aa,
      securityCode: dados.cvv,
      identificationType: 'CPF',
      identificationNumber: cpfLimpo,
    });

    const bandeira = await this.detectarBandeira(numeroLimpo, tipoCartao);
    if (!bandeira) {
      throw new Error('Não foi possível identificar a bandeira do cartão.');
    }

    return {
      cardToken: tokenResult.id,
      paymentMethodId: bandeira.paymentMethodId,
      paymentTypeId: bandeira.paymentTypeId,
      issuerId: bandeira.issuerId,
    };
  }
}
