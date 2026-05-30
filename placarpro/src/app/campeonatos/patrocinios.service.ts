import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  CollectionReference,
  DocumentReference,
  Timestamp,
  increment,
  runTransaction,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { PatrocinioJogo, PREMIUM_PATROCINIO } from './models/patrocinio-jogo.model';
import { map } from 'rxjs/operators';
import { PlanosService } from '../users/planos.service';

/**
 * Serviço de patrocínios de partida (ads na transmissão).
 *
 * Modelo simples (v1):
 *  - 1 crédito = até 2 patrocinadores na esteira por 60 min
 *
 * Operações:
 *  - ativarPatrocinio()   → debita 1 crédito + cria PatrocinioJogo
 *  - cancelarPatrocinio() → marca cancelado + ESTORNA crédito (só se status='agendado')
 *  - iniciarPatrociniosDoJogo() → marca patrocínios do jogo como 'ativo' + seta expiraEm
 *  - listarAtivos$() → Observable de patrocínios visíveis no momento
 *  - listarTodos$()  → todos do jogo (admin)
 */
@Injectable({ providedIn: 'root' })
export class PatrociniosService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly planosSrv = inject(PlanosService);

  private col(campeonatoId: string, categoriaId: string, jogoId: string): CollectionReference<PatrocinioJogo> {
    return collection(
      this.fs,
      `campeonatos/${campeonatoId}/categorias/${categoriaId}/jogos/${jogoId}/patrocinios`,
    ) as CollectionReference<PatrocinioJogo>;
  }

  private docRef(
    campeonatoId: string, categoriaId: string, jogoId: string, patrocinioId: string,
  ): DocumentReference<PatrocinioJogo> {
    return doc(this.col(campeonatoId, categoriaId, jogoId), patrocinioId) as DocumentReference<PatrocinioJogo>;
  }

  /** Todos os patrocínios cadastrados pra um jogo (admin vê histórico). */
  listarTodos$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<PatrocinioJogo[]> {
    return runInInjectionContext(this.injector, () => {
      const ref = this.col(campeonatoId, categoriaId, jogoId);
      return collectionData(ref, { idField: 'id' }) as Observable<PatrocinioJogo[]>;
    });
  }

  /** Apenas patrocínios atualmente VISÍVEIS — usado na transmissão pública.
   *  Filtra por `status === 'ativo'`. Cliente ainda checa `expiraEm > now`
   *  caso a Function ainda não tenha rodado o cleanup.
   *
   *  Retorna SÓ tipo='normal' (banner pequeno rotativo). Pra premium,
   *  use `listarPremiumAtivos$`. Inclui docs sem campo `tipo` (legacy)
   *  pra compatibilidade com patrocínios criados antes da feature premium. */
  listarAtivos$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<PatrocinioJogo[]> {
    return runInInjectionContext(this.injector, () => {
      const ref = this.col(campeonatoId, categoriaId, jogoId);
      const q = query(ref, where('status', '==', 'ativo'));
      return (collectionData(q, { idField: 'id' }) as Observable<PatrocinioJogo[]>).pipe(
        map(arr => arr.filter(p => (p.tipo ?? 'normal') === 'normal')),
      );
    });
  }

  /** Apenas patrocínios PREMIUM ativos. Usado pelo PremiumOverlayComponent
   *  pra fazer a rotação round-robin nas janelas de 6s a cada 7min. */
  listarPremiumAtivos$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<PatrocinioJogo[]> {
    return runInInjectionContext(this.injector, () => {
      const ref = this.col(campeonatoId, categoriaId, jogoId);
      const q = query(ref, where('status', '==', 'ativo'), where('tipo', '==', 'premium'));
      return collectionData(q, { idField: 'id' }) as Observable<PatrocinioJogo[]>;
    });
  }

  /**
   * Ativa um patrocínio (normal OU premium):
   *  1. Valida créditos solicitados (>=1) e lista de patrocinadores
   *  2. Verifica saldo de créditos do user
   *  3. Pra premium: valida que não excede `maxPorJogo` ativos+agendados
   *  4. Em transação: debita `creditos` + cria doc com status='agendado'
   *
   * Regras NORMAL:
   *  - Cada crédito permite até `CREDITO_PATROCINIO.logosPorCredito` (2) logos
   *  - Custa `precoBase` (R$ 50) por crédito
   *  - Duração 60min
   *
   * Regras PREMIUM:
   *  - Sempre 1 patrocinador por crédito, sempre 1 crédito por ativação
   *  - Custa `PREMIUM_PATROCINIO.precoBase` (R$ 70)
   *  - Aparece em janelas de 6s a cada 7min, durante o jogo todo
   *  - Máx 3 ativos+agendados por jogo (rotação round-robin)
   *
   * Throws se saldo insuficiente ou lista/creditos inválidos ou
   * limite premium excedido.
   */
  async ativarPatrocinio(args: {
    campeonatoId: string;
    categoriaId: string;
    jogoId: string;
    ownerId: string;          // = uid do organizador
    patrocinadores: Array<{ nome: string; logoUrl: string; linkUrl?: string }>;
    /** Quantos créditos debitar (só NORMAL, ignorado em premium=1). Default 1. */
    creditos?: number;
    /** Tipo do patrocínio. Default 'normal'. */
    tipo?: 'normal' | 'premium';
  }): Promise<string> {
    const lista = args.patrocinadores ?? [];
    const tipo: 'normal' | 'premium' = args.tipo ?? 'normal';

    if (lista.length === 0) throw new Error('Selecione pelo menos 1 patrocinador.');
    if (lista.some(p => !p.logoUrl)) {
      throw new Error('Todos os patrocinadores selecionados precisam ter logo cadastrado.');
    }

    let custo: number;
    let duracaoMin: number;

    if (tipo === 'premium') {
      // Premium: 1 crédito, 1 patrocinador, duração teto.
      if (lista.length > PREMIUM_PATROCINIO.logosPorCredito) {
        throw new Error(`Premium aceita só ${PREMIUM_PATROCINIO.logosPorCredito} patrocinador por ativação.`);
      }
      custo = 1;
      duracaoMin = PREMIUM_PATROCINIO.duracaoMin;
    } else {
      // Normal: lógica atual (1-N créditos, N logos por crédito — config).
      custo = Math.max(1, Math.floor(args.creditos ?? 1));
      const maxLogos = custo * this.planosSrv.patrocinadoresCreditoNormal;
      if (lista.length > maxLogos) {
        throw new Error(`Com ${custo} crédito(s) o máximo é ${maxLogos} patrocinadores.`);
      }
      duracaoMin = this.planosSrv.duracaoCreditoNormalMin;
    }

    // Validação extra premium: não pode exceder `maxPorJogo` ativos/agendados.
    if (tipo === 'premium') {
      const ativos = await this.contarPremiumAtivosOuAgendados(
        args.campeonatoId, args.categoriaId, args.jogoId,
      );
      const maxPremium = this.planosSrv.premiumMaxPorJogo;
      if (ativos >= maxPremium) {
        throw new Error(
          `Limite de ${maxPremium} patrocínios PREMIUM por jogo atingido.`,
        );
      }
    }

    const tipoSalvar = tipo;
    const duracaoSalvar = duracaoMin;
    // Campo do saldo no users/{uid} muda por tipo:
    //  - normal  → creditosPatrocinio
    //  - premium → creditosPatrocinioPremium
    const saldoField = tipo === 'premium' ? 'creditosPatrocinioPremium' : 'creditosPatrocinio';
    return runInInjectionContext(this.injector, async () => {
      const userRef = doc(this.fs, `users/${args.ownerId}`);
      const novoPatroRef = doc(this.col(args.campeonatoId, args.categoriaId, args.jogoId));

      await runTransaction(this.fs, async tx => {
        const userSnap = await tx.get(userRef);
        const saldo = (userSnap.data()?.[saldoField] as number | undefined) ?? 0;
        if (saldo < custo) {
          const tipoLabel = tipo === 'premium' ? 'PREMIUM' : '';
          throw new Error(`Saldo ${tipoLabel} insuficiente. Você tem ${saldo} crédito(s), precisa de ${custo}.`);
        }
        tx.update(userRef, { [saldoField]: increment(-custo) });
        tx.set(novoPatroRef, {
          ownerId: args.ownerId,
          tipo: tipoSalvar,
          patrocinadores: lista,
          creditosUsados: custo,
          duracaoMin: duracaoSalvar,
          inicioReal: null,
          expiraEm: null,
          status: 'agendado',
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        } as Partial<PatrocinioJogo>);
      });

      return novoPatroRef.id;
    });
  }

  /**
   * Conta quantos patrocínios PREMIUM já estão `'agendado'` ou `'ativo'`
   * num jogo. Usado pra limitar a `maxPorJogo` (3) antes de aceitar nova
   * ativação. Snapshot único (não observable) — só pra decisão pontual.
   */
  private async contarPremiumAtivosOuAgendados(
    campeonatoId: string, categoriaId: string, jogoId: string,
  ): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.col(campeonatoId, categoriaId, jogoId);
      const q = query(ref, where('tipo', '==', 'premium'));
      const docs = await new Promise<PatrocinioJogo[]>(resolve => {
        const sub = (collectionData(q, { idField: 'id' }) as Observable<PatrocinioJogo[]>)
          .subscribe(d => { sub.unsubscribe(); resolve(d); });
      });
      return docs.filter(d => d.status === 'agendado' || d.status === 'ativo').length;
    });
  }

  /**
   * Edita os patrocinadores de um patrocínio AGENDADO (transmissão ainda
   * não começou). Permite ao organizador trocar logo/nome/quantidade antes
   * de a partida começar — após o status virar 'ativo', a edição é
   * bloqueada pra preservar a integridade do que foi exibido aos
   * espectadores.
   *
   * Não toca em saldo de créditos (não é estorno, é edição). Para mudar
   * a QUANTIDADE de créditos, o organizador precisa cancelar (estorno
   * integral) e ativar novamente.
   */
  async editarPatrocinio(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    patrocinioId: string,
    patrocinadores: Array<{ nome: string; logoUrl: string; linkUrl?: string }>,
  ): Promise<void> {
    if (!patrocinadores || patrocinadores.length === 0) {
      throw new Error('Inclua pelo menos 1 patrocinador.');
    }
    if (patrocinadores.some(p => !p.logoUrl || !p.nome?.trim())) {
      throw new Error('Todo patrocinador precisa de nome e logo.');
    }
    return runInInjectionContext(this.injector, async () => {
      const patroRef = this.docRef(campeonatoId, categoriaId, jogoId, patrocinioId);

      await runTransaction(this.fs, async tx => {
        const snap = await tx.get(patroRef);
        const p = snap.data();
        if (!p) throw new Error('Patrocínio não encontrado.');
        if (p.status !== 'agendado') {
          throw new Error('Só patrocínios agendados podem ser editados.');
        }
        // Valida que não excede o crédito original
        const maxLogos = (p.creditosUsados ?? 1) * this.planosSrv.patrocinadoresCreditoNormal;
        if (patrocinadores.length > maxLogos) {
          throw new Error(`Com ${p.creditosUsados} crédito(s) o máximo é ${maxLogos} patrocinadores.`);
        }
        tx.update(patroRef, {
          patrocinadores,
          atualizadoEm: serverTimestamp(),
        });
      });
    });
  }

  /**
   * REATIVA um patrocínio (reabre o MESMO doc) já ATIVANDO imediatamente.
   *
   * Diferenças do `ativarPatrocinio` original:
   *  - Não cria doc novo — reusa o existente (sem duplicatas no histórico)
   *  - Já marca como `'ativo'` direto (não passa por 'agendado')
   *  - `inicioReal = agora` / `expiraEm = agora + (creditos × duracaoBase)`
   *  - Permite escolher N créditos pra aumentar a duração total
   *
   * Cálculo de tempo:
   *  - NORMAL: cada crédito = 60min de exibição. 3 créditos = 180min (3h).
   *  - PREMIUM: cada crédito = 60min de janelas (6s a cada 7min). 3 créditos = 180min.
   *
   * Tudo em transação atômica (debita saldo + atualiza doc).
   */
  async reativarPatrocinio(
    campeonatoId: string, categoriaId: string, jogoId: string,
    origem: PatrocinioJogo,
    creditos = 1,
  ): Promise<void> {
    if (!origem?.id || !origem.patrocinadores?.length) {
      throw new Error('Patrocínio inválido.');
    }
    const tempoExpirou =
      origem.status === 'ativo' &&
      origem.expiraEm != null &&
      (origem.expiraEm as Timestamp).toMillis() <= Date.now();
    const podeReativar =
      origem.status === 'expirado' || origem.status === 'cancelado' || tempoExpirou;
    if (!podeReativar) {
      throw new Error('Patrocínio em andamento ou agendado não pode ser reativado.');
    }

    const tipo: 'normal' | 'premium' = origem.tipo ?? 'normal';
    const custo = Math.max(1, Math.floor(creditos));
    // Duração base por crédito (min) — editável pelo admin. Mesmo valor pra
    // normal e premium na reativação.
    const duracaoBaseMin = this.planosSrv.duracaoCreditoNormalMin;
    const duracaoTotalMin = custo * duracaoBaseMin;
    const saldoField = tipo === 'premium' ? 'creditosPatrocinioPremium' : 'creditosPatrocinio';

    // Pra premium, valida limite por jogo.
    if (tipo === 'premium') {
      const ativos = await this.contarPremiumAtivosOuAgendados(
        campeonatoId, categoriaId, jogoId,
      );
      const efetivo = (origem.status === 'agendado' || origem.status === 'ativo') ? ativos - 1 : ativos;
      const maxPremium = this.planosSrv.premiumMaxPorJogo;
      if (efetivo >= maxPremium) {
        throw new Error(
          `Limite de ${maxPremium} patrocínios PREMIUM por jogo atingido.`,
        );
      }
    }

    return runInInjectionContext(this.injector, async () => {
      const userRef = doc(this.fs, `users/${origem.ownerId}`);
      const patroRef = this.docRef(campeonatoId, categoriaId, jogoId, origem.id!);

      await runTransaction(this.fs, async tx => {
        const userSnap = await tx.get(userRef);
        const saldo = (userSnap.data()?.[saldoField] as number | undefined) ?? 0;
        if (saldo < custo) {
          const lbl = tipo === 'premium' ? 'PREMIUM' : '';
          throw new Error(`Saldo ${lbl} insuficiente. Você tem ${saldo} crédito(s), precisa de ${custo}.`);
        }
        const agora = Timestamp.now();
        const expira = Timestamp.fromMillis(agora.toMillis() + duracaoTotalMin * 60_000);

        tx.update(userRef, { [saldoField]: increment(-custo) });
        tx.update(patroRef, {
          status: 'ativo',
          creditosUsados: custo,
          duracaoMin: duracaoTotalMin,
          inicioReal: agora,
          expiraEm: expira,
          atualizadoEm: serverTimestamp(),
        });
      });
    });
  }

  /**
   * Cancela um patrocínio AGENDADO (transmissão ainda não começou).
   * Estorna os créditos para o user.
   * Se status != 'agendado', lança erro (não pode cancelar ativo/expirado).
   */
  async cancelarPatrocinio(
    campeonatoId: string, categoriaId: string, jogoId: string, patrocinioId: string,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const patroRef = this.docRef(campeonatoId, categoriaId, jogoId, patrocinioId);

      await runTransaction(this.fs, async tx => {
        const snap = await tx.get(patroRef);
        const p = snap.data();
        if (!p) throw new Error('Patrocínio não encontrado');
        if (p.status !== 'agendado') {
          throw new Error('Só patrocínios agendados podem ser cancelados.');
        }
        const userRef = doc(this.fs, `users/${p.ownerId}`);
        // Estorna no saldo correto (normal ou premium) com base no tipo
        // salvo no doc. Docs antigos sem `tipo` são tratados como normal.
        const saldoFieldEstorno = p.tipo === 'premium'
          ? 'creditosPatrocinioPremium'
          : 'creditosPatrocinio';
        tx.update(userRef, { [saldoFieldEstorno]: increment(p.creditosUsados) });
        tx.update(patroRef, {
          status: 'cancelado',
          atualizadoEm: serverTimestamp(),
        });
      });
    });
  }

  /**
   * Ativa UM patrocínio agendado IMEDIATAMENTE (usado pelo botão
   * "Ativar agora" quando a transmissão já está rodando e o organizador
   * decide ativar um agendado avulso). Idempotente: se já está 'ativo',
   * não muda.
   */
  async ativarPatrocinioAgora(
    campeonatoId: string, categoriaId: string, jogoId: string, patrocinioId: string,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const patroRef = this.docRef(campeonatoId, categoriaId, jogoId, patrocinioId);
      await runTransaction(this.fs, async tx => {
        const snap = await tx.get(patroRef);
        const p = snap.data();
        if (!p) throw new Error('Patrocínio não encontrado.');
        if (p.status === 'ativo') return; // idempotente
        if (p.status !== 'agendado') {
          throw new Error('Só patrocínios agendados podem ser ativados.');
        }
        const duracaoMin = p.duracaoMin || this.planosSrv.duracaoCreditoNormalMin;
        const agora = Timestamp.now();
        const expira = Timestamp.fromMillis(agora.toMillis() + duracaoMin * 60_000);
        tx.update(patroRef, {
          status: 'ativo',
          inicioReal: agora,
          expiraEm: expira,
          atualizadoEm: serverTimestamp(),
        });
      });
    });
  }

  /**
   * Chamado quando a transmissão de um jogo COMEÇA. Marca todos os
   * patrocínios agendados como 'ativo' e calcula `expiraEm`.
   *
   * Idealmente chamado por uma Cloud Function que escuta o documento da
   * transmissão. Por ora, o cliente pode chamar direto quando inicia a tx.
   */
  async iniciarPatrociniosDoJogo(
    campeonatoId: string, categoriaId: string, jogoId: string,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = this.col(campeonatoId, categoriaId, jogoId);
      // Busca todos agendados (poderia ter um batch limit em production)
      const snap = await new Promise<{ id: string; data: PatrocinioJogo }[]>(resolve => {
        const sub = (collectionData(query(ref, where('status', '==', 'agendado')), { idField: 'id' }) as Observable<PatrocinioJogo[]>)
          .subscribe(docs => {
            sub.unsubscribe();
            resolve(docs.map(d => ({ id: d.id!, data: d })));
          });
      });
      const agora = Timestamp.now();
      await Promise.all(snap.map(p => {
        const expira = Timestamp.fromMillis(agora.toMillis() + p.data.duracaoMin * 60_000);
        return setDoc(this.docRef(campeonatoId, categoriaId, jogoId, p.id), {
          status: 'ativo',
          inicioReal: agora,
          expiraEm: expira,
          atualizadoEm: serverTimestamp(),
        } as Partial<PatrocinioJogo>, { merge: true });
      }));
    });
  }

  /** Marca como expirado (cleanup chamado manual ou por scheduler). */
  async marcarExpirado(
    campeonatoId: string, categoriaId: string, jogoId: string, patrocinioId: string,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      await updateDoc(this.docRef(campeonatoId, categoriaId, jogoId, patrocinioId), {
        status: 'expirado',
        atualizadoEm: serverTimestamp(),
      });
    });
  }
}
