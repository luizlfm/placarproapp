import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  DocumentReference,
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  docData,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable } from 'rxjs';
import { Cobranca, CobrancaStatus, MetodoPagamento } from './models/cobranca.model';

/** Resposta da Cloud Function `criarPagamentoMP`. */
export interface CriarPagamentoMPResult {
  ok: boolean;
  mpId?: string;
  /** Status retornado pelo MP: approved | pending | rejected | in_process. */
  status?: string;
  statusDetail?: string;
  linkPagamento?: string;
  linkBoleto?: string;
  pixCopiaCola?: string;
  pixQrCodeBase64?: string;
}

/** Dados específicos de cartão (passados quando metodo é cartao_*). */
export interface CartaoMPArgs {
  cardToken: string;
  paymentMethodId: string;
  issuerId?: string;
  installments?: number;
  cpf: string;
}

/**
 * Service do CRUD de cobranças (`cobrancas/{id}` no Firestore).
 *
 * Por enquanto, cobranças são criadas/atualizadas manualmente via painel
 * admin. A intenção é integrar com Asaas no futuro:
 *  1) Admin cria uma cobrança → service chama Asaas pra gerar fatura
 *  2) Asaas devolve linkPagamento + asaasId → service salva no doc
 *  3) Webhook do Asaas avisa quando paga → Cloud Function atualiza status
 *
 * As leituras são restritas pelo `adminGuard` (rules vão exigir isMaster).
 */
@Injectable({ providedIn: 'root' })
export class CobrancasService {
  private readonly fs = inject(Firestore);
  private readonly functions = inject(Functions);
  private readonly injector = inject(Injector);

  /**
   * Chama a Cloud Function `criarPagamentoMP` que gera a cobrança no
   * Mercado Pago e devolve QR Code PIX / link de boleto / link de
   * pagamento conforme o método. Atualiza o doc da cobrança no Firestore
   * com os dados retornados.
   */
  async criarPagamentoMP(
    cobrancaId: string,
    metodo: MetodoPagamento,
    cartao?: CartaoMPArgs,
  ): Promise<CriarPagamentoMPResult> {
    // httpsCallable PRECISA ser invocado dentro do injection context
    // (Angular 17+/AngularFire 18+) — senão dá "Firebase API called outside
    // injection context". Envolvemos a chamada inteira.
    return runInInjectionContext(this.injector, async () => {
      const fn = httpsCallable<
        {
          cobrancaId: string;
          metodo: MetodoPagamento;
          cardToken?: string;
          paymentMethodId?: string;
          issuerId?: string;
          installments?: number;
          cpf?: string;
        },
        CriarPagamentoMPResult
      >(this.functions, 'criarPagamentoMP');
      const result = await fn({
        cobrancaId,
        metodo,
        cardToken: cartao?.cardToken,
        paymentMethodId: cartao?.paymentMethodId,
        issuerId: cartao?.issuerId,
        installments: cartao?.installments,
        cpf: cartao?.cpf,
      });
      return result.data;
    });
  }

  private col(): CollectionReference<Cobranca> {
    return collection(this.fs, 'cobrancas') as CollectionReference<Cobranca>;
  }
  private docRef(id: string): DocumentReference<Cobranca> {
    return doc(this.fs, 'cobrancas', id) as DocumentReference<Cobranca>;
  }

  /** Stream de uma cobrança específica por ID. */
  get$(id: string): Observable<Cobranca | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(id), { idField: 'id' }) as Observable<Cobranca | undefined>,
    );
  }

  /** Lista TODAS as cobranças do sistema (pra painel admin). */
  listAll$(): Observable<Cobranca[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(), orderBy('criadoEm', 'desc'));
      return collectionData(q, { idField: 'id' }) as Observable<Cobranca[]>;
    });
  }

  /** Cobranças de um usuário específico (pra eventual aba "Minhas faturas"). */
  listPorUsuario$(usuarioId: string): Observable<Cobranca[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(
        this.col(),
        where('usuarioId', '==', usuarioId),
        orderBy('criadoEm', 'desc'),
      );
      return collectionData(q, { idField: 'id' }) as Observable<Cobranca[]>;
    });
  }

  /** Cria uma nova cobrança. Admin master only (rules garantem). */
  async criar(c: Omit<Cobranca, 'id' | 'criadoEm' | 'atualizadoEm'>): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const ref = await addDoc(this.col(), {
        ...c,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      } as Cobranca);
      return ref.id;
    });
  }

  /** Atualiza status (e campos relacionados como pagoEm). */
  async atualizarStatus(id: string, status: CobrancaStatus): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const patch: Partial<Cobranca> = {
        status,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      if (status === 'pago') {
        patch.pagoEm = serverTimestamp() as unknown as Timestamp;
      }
      await updateDoc(this.docRef(id), patch);
    });
  }

  /** Atualiza qualquer campo da cobrança. */
  async atualizar(id: string, patch: Partial<Cobranca>): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(this.docRef(id), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      });
    });
  }

  /** Remove cobrança (use com cuidado — perde histórico). */
  async remover(id: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await deleteDoc(this.docRef(id));
    });
  }

  // ====================== Helpers ======================

  /** Formata valorCentavos como string R$. */
  formatarValor(centavos: number): string {
    return `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;
  }

  /** Marca como atrasada toda cobrança aguardando cujo vencimento já passou. */
  isAtrasada(c: Cobranca): boolean {
    if (c.status !== 'aguardando') return false;
    const hoje = new Date().toISOString().split('T')[0];
    return c.vencimento < hoje;
  }
}
