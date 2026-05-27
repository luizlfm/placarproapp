/**
 * Wrapper das chamadas ao Mercado Pago. Isolado pra facilitar testes
 * e troca de gateway no futuro.
 *
 * Docs:
 *  - https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post
 *  - https://www.mercadopago.com.br/developers/pt/docs/checkout-api/payment-methods/pix
 *  - https://www.mercadopago.com.br/developers/pt/docs/checkout-api/integration-configuration/card/integration-via-cardform
 */

import { MercadoPagoConfig, Payment } from 'mercadopago';

interface CriarPagamentoArgs {
  accessToken: string;
  cobrancaId: string;
  metodo: 'pix' | 'boleto' | 'cartao_credito' | 'cartao_debito';
  valorCentavos: number;
  descricao: string;
  usuarioEmail: string;
  usuarioNome: string;
  /** Card token gerado no frontend via SDK do MP (apenas cartão). */
  cardToken?: string;
  /** Número de parcelas (apenas cartão de crédito; débito sempre 1). */
  installments?: number;
  /** CPF do titular (obrigatório pra cartão e boleto). */
  cpf?: string;
  /** payment_method_id retornado pelo SDK MP (visa, master, amex, elo, etc). */
  paymentMethodId?: string;
  /** issuer_id retornado pelo SDK MP (banco emissor — opcional). */
  issuerId?: string;
  /** Endereço do pagador — obrigatório pra boleto Bradesco. */
  endereco?: {
    cep?: string;          // 00000-000 ou 00000000
    rua?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;           // SP, RJ, MG...
  };
}

interface CriarPagamentoResult {
  mpId: string;
  /** Status retornado pela MP: approved, pending, rejected, etc. */
  status?: string;
  statusDetail?: string;
  linkPagamento?: string;
  linkBoleto?: string;
  pixCopiaCola?: string;
  pixQrCodeBase64?: string;
}

/**
 * Cria uma cobrança no Mercado Pago via API.
 *
 * - PIX/Boleto: gera o documento e retorna QR Code / link
 * - Cartão (crédito/débito): processa o token recebido do frontend e
 *   retorna status imediato (approved/rejected/in_process)
 */
export async function criarPagamentoMercadoPago(
  args: CriarPagamentoArgs,
): Promise<CriarPagamentoResult> {
  // .trim() defensivo: se o secret foi salvo com \n no final por engano,
  // o node-fetch quebra com "is not a legal HTTP header value".
  const client = new MercadoPagoConfig({ accessToken: args.accessToken.trim() });
  const paymentApi = new Payment(client);

  const valor = args.valorCentavos / 100;

  // Split de nome em first/last (MP exige)
  const partes = (args.usuarioNome ?? '').trim().split(' ');
  const firstName = partes[0] || 'Cliente';
  const lastName = partes.slice(1).join(' ') || 'PlacarPro';

  if (args.metodo === 'pix') {
    // PIX — gera QR Code + copia-cola
    const result = await paymentApi.create({
      body: {
        transaction_amount: valor,
        description: args.descricao,
        payment_method_id: 'pix',
        external_reference: args.cobrancaId,
        payer: {
          email: args.usuarioEmail,
          first_name: firstName,
          last_name: lastName,
        },
      },
    });

    return {
      mpId: String(result.id),
      status: result.status,
      statusDetail: result.status_detail,
      pixCopiaCola: result.point_of_interaction?.transaction_data?.qr_code,
      pixQrCodeBase64: result.point_of_interaction?.transaction_data?.qr_code_base64,
    };
  }

  if (args.metodo === 'boleto') {
    // Bradesco exige endereço completo do pagador. Em sandbox aceita
    // placeholder; em produção, capturar via formulário ou ViaCEP.
    const end = args.endereco ?? {};
    const cpfBoleto = (args.cpf || '19119119100').replace(/\D/g, '');
    const cepLimpo = (end.cep || '01310100').replace(/\D/g, '');

    const result = await paymentApi.create({
      body: {
        transaction_amount: valor,
        description: args.descricao,
        payment_method_id: 'bolbradesco', // boleto padrão MP
        external_reference: args.cobrancaId,
        payer: {
          email: args.usuarioEmail,
          first_name: firstName,
          last_name: lastName,
          identification: {
            type: 'CPF',
            number: cpfBoleto,
          },
          address: {
            zip_code: cepLimpo,
            street_name: end.rua || 'Av Paulista',
            street_number: end.numero || '1000',
            neighborhood: end.bairro || 'Bela Vista',
            city: end.cidade || 'São Paulo',
            federal_unit: end.uf || 'SP',
          },
        },
      },
    });

    return {
      mpId: String(result.id),
      status: result.status,
      statusDetail: result.status_detail,
      linkBoleto: result.transaction_details?.external_resource_url,
    };
  }

  if (args.metodo === 'cartao_credito' || args.metodo === 'cartao_debito') {
    // Cartão — exige token gerado no frontend (MP SDK JS).
    // O número do cartão NUNCA passa pelo nosso servidor (PCI compliance).
    if (!args.cardToken) {
      throw new Error('cardToken é obrigatório para pagamento por cartão.');
    }
    if (!args.cpf) {
      throw new Error('CPF do titular é obrigatório para cartão.');
    }
    if (!args.paymentMethodId) {
      throw new Error('paymentMethodId é obrigatório para cartão.');
    }

    // Débito sempre 1x; crédito aceita o que o frontend mandar (clamp 1..12).
    const installments = args.metodo === 'cartao_debito'
      ? 1
      : Math.max(1, Math.min(12, args.installments ?? 1));

    const result = await paymentApi.create({
      body: {
        transaction_amount: valor,
        token: args.cardToken,
        description: args.descricao,
        installments,
        payment_method_id: args.paymentMethodId,
        issuer_id: args.issuerId ? Number(args.issuerId) : undefined,
        external_reference: args.cobrancaId,
        payer: {
          email: args.usuarioEmail,
          first_name: firstName,
          last_name: lastName,
          identification: {
            type: 'CPF',
            number: args.cpf.replace(/\D/g, ''),
          },
        },
      },
    });

    return {
      mpId: String(result.id),
      status: result.status,           // approved | pending | rejected | in_process
      statusDetail: result.status_detail,
    };
  }

  throw new Error(`Método de pagamento desconhecido: '${args.metodo}'.`);
}

/** Busca um pagamento no MP por ID. Usado pelo webhook pra confirmar status. */
export async function buscarPagamentoMP(args: {
  accessToken: string;
  mpId: string;
}): Promise<{ status: string; status_detail?: string }> {
  const client = new MercadoPagoConfig({ accessToken: args.accessToken.trim() });
  const paymentApi = new Payment(client);
  const result = await paymentApi.get({ id: args.mpId });
  return {
    status: result.status ?? 'pending',
    status_detail: result.status_detail,
  };
}
