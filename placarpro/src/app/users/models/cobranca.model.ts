import { Timestamp } from '@angular/fire/firestore';
import { PlanoId, Periodicidade } from '../planos.service';

/** Status de uma cobrança. */
export type CobrancaStatus =
  | 'aguardando'     // gerada, ainda não paga
  | 'pago'           // pagamento confirmado
  | 'atrasado'       // vencimento passou sem pagamento
  | 'cancelado'      // cancelada antes do pagamento
  | 'estornado';     // pagamento foi estornado

/** Método de pagamento. */
export type MetodoPagamento =
  | 'pix'
  | 'boleto'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'transferencia'
  | 'dinheiro'
  | 'outro';

/**
 * Cobrança/Fatura emitida pra um organizador pagar a assinatura.
 * Documento em `cobrancas/{id}` no Firestore.
 *
 * Estrutura preparada pra integração com Asaas no futuro — campos
 * `asaasId`, `linkPagamento`, `linkBoleto`, `pixCopiaCola` já estão
 * mapeados. Por enquanto a geração é manual via painel admin.
 */
/**
 * Tipo da cobrança:
 *  - `assinatura`: mensalidade/período de um plano de CAMPEONATO (organizador).
 *  - `transmissao-avulsa`: créditos de transmissão ao vivo (R$30 cada).
 *  - `racha-assinatura`: mensalidade/período de um plano de RACHA (pelada).
 *    Nesse caso `rachaId`/`planoRacha` identificam qual racha será promovido,
 *    e `planoId` fica vazio (planos de racha usam IDs próprios).
 */
export type CobrancaTipo = 'assinatura' | 'transmissao-avulsa' | 'racha-assinatura';

/** ID de plano de racha (independente dos planos de campeonato). */
export type PlanoRachaId = 'gratis' | 'premium' | 'pro';

export interface Cobranca {
  id?: string;
  /**
   * Tipo da cobrança. Undefined = assinatura (legado).
   * Quando `transmissao-avulsa`, o campo `quantidadeTransmissoes`
   * indica quantos créditos foram solicitados.
   */
  tipo?: CobrancaTipo;
  /** UID do usuário/organizador cobrado. */
  usuarioId: string;
  /** Email (denormalizado pra busca rápida na lista do admin). */
  usuarioEmail?: string;
  /** Nome (denormalizado). */
  usuarioNome?: string;
  /**
   * Plano de CAMPEONATO referente à cobrança. Pode ser ausente em
   * `transmissao-avulsa` e em `racha-assinatura` (que usa `planoRacha`).
   */
  planoId?: PlanoId;
  /**
   * ID do racha cobrado — preenchido apenas quando `tipo === 'racha-assinatura'`.
   * Ao confirmar o pagamento, o admin promove `rachas/{rachaId}.plano`.
   */
  rachaId?: string;
  /** Nome do racha (denormalizado pra exibição no painel admin). */
  rachaNome?: string;
  /** Plano de racha referente à cobrança (quando `tipo === 'racha-assinatura'`). */
  planoRacha?: PlanoRachaId;
  /** Periodicidade da cobrança (define duração da assinatura paga). */
  periodicidade: Periodicidade;
  /**
   * Quantidade de transmissões avulsas solicitadas.
   * Apenas relevante quando `tipo === 'transmissao-avulsa'`.
   * Admin adiciona esse valor em `UserProfile.transmissoesExtras` ao confirmar.
   */
  quantidadeTransmissoes?: number;
  /** Valor cobrado em centavos (evita problemas de float). */
  valorCentavos: number;
  /** Data de vencimento (formato YYYY-MM-DD). */
  vencimento: string;
  /** Status atual da cobrança. */
  status: CobrancaStatus;
  /** Método de pagamento selecionado/usado. Pode estar vazio se aguardando escolha. */
  metodoPagamento?: MetodoPagamento;
  /** Link público pra pagamento (Asaas, MP, etc.). */
  linkPagamento?: string;
  /** Link do boleto PDF. */
  linkBoleto?: string;
  /** Código pix copia-e-cola. */
  pixCopiaCola?: string;
  /** QR Code PIX em base64 (PNG) — retornado pelo Mercado Pago. */
  pixQrCodeBase64?: string;
  /** ID da cobrança no Mercado Pago (após integração). */
  mpId?: string;
  /** ID da cobrança no Asaas (legacy — caso troque de gateway). */
  asaasId?: string;
  /** Quando foi paga (preenchido só se status='pago'). */
  pagoEm?: Timestamp | null;
  /** Observação livre (admin pode anotar). */
  observacao?: string;
  /** Auditoria. */
  criadoEm?: Timestamp;
  /** UID do admin que criou (pra cobranças manuais). */
  criadoPor?: string;
  atualizadoEm?: Timestamp;
}

/** Label legível por status. */
export const COBRANCA_STATUS_LABEL: Record<CobrancaStatus, string> = {
  aguardando: 'Aguardando',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
  estornado: 'Estornado',
};

/** Cor associada a cada status (variável CSS / hex). */
export const COBRANCA_STATUS_COR: Record<CobrancaStatus, string> = {
  aguardando: '#F39C12',
  pago: '#7CC61D',
  atrasado: '#E11D48',
  cancelado: '#94A3B8',
  estornado: '#9333EA',
};

/** Label legível por método de pagamento. */
export const METODO_PAGAMENTO_LABEL: Record<MetodoPagamento, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  outro: 'Outro',
};
