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
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Equipe } from './models/equipe.model';
import { EventoJogo, Jogo, NovoJogoInput } from './models/jogo.model';

@Injectable({ providedIn: 'root' })
export class JogosService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string, categoriaId: string): CollectionReference<Jogo> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos',
    ) as CollectionReference<Jogo>;
  }

  private docRef(campeonatoId: string, categoriaId: string, jogoId: string): DocumentReference<Jogo> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos', jogoId,
    ) as DocumentReference<Jogo>;
  }

  private eventosCol(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
  ): CollectionReference<EventoJogo> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos', jogoId,
      'eventos',
    ) as CollectionReference<EventoJogo>;
  }

  private escalacaoDocRef(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    equipeId: string,
  ): DocumentReference<{ jogadorIds: string[] }> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos', jogoId,
      'escalacao', equipeId,
    ) as DocumentReference<{ jogadorIds: string[] }>;
  }

  escalacao$(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    equipeId: string,
  ): Observable<string[]> {
    return runInInjectionContext(this.injector, () =>
      (docData(this.escalacaoDocRef(campeonatoId, categoriaId, jogoId, equipeId)) as Observable<
        { jogadorIds?: string[] } | undefined
      >).pipe(map(d => d?.jogadorIds ?? [])),
    );
  }

  async salvarEscalacao(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    equipeId: string,
    jogadorIds: string[],
  ): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      const ref = this.escalacaoDocRef(campeonatoId, categoriaId, jogoId, equipeId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, { jogadorIds });
      } else {
        await setDoc(ref, { jogadorIds });
      }
    });
  }

  list$(campeonatoId: string, categoriaId: string): Observable<Jogo[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId, categoriaId), orderBy('criadoEm', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<Jogo[]>;
    });
  }

  get$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<Jogo | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, categoriaId, jogoId), { idField: 'id' }) as Observable<Jogo | undefined>,
    );
  }

  listEventos$(campeonatoId: string, categoriaId: string, jogoId: string): Observable<EventoJogo[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.eventosCol(campeonatoId, categoriaId, jogoId), orderBy('criadoEm', 'asc'));
      return collectionData(q, { idField: 'id' }) as Observable<EventoJogo[]>;
    });
  }

  async criar(campeonatoId: string, categoriaId: string, input: NovoJogoInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const payload: Jogo = {
        ...input,
        campeonatoId,
        categoriaId,
        status: 'agendado',
        golsMandante: null,
        golsVisitante: null,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col(campeonatoId, categoriaId), payload);
      return ref.id;
    });
  }

  async atualizar(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    patch: Partial<Jogo>,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, jogoId), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  async remover(campeonatoId: string, categoriaId: string, jogoId: string): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      deleteDoc(this.docRef(campeonatoId, categoriaId, jogoId)),
    );
  }

  /**
   * DEV/TEST: dispara visualização do banner PREMIUM em todas as telas
   * conectadas (admin + transmissão pública + público-jogo).
   *
   * Grava 3 campos `_testePremium*` no doc do jogo:
   *  - `_testePremiumAt` (Timestamp do servidor) — usado como "trigger"
   *    pra outros componentes detectarem que houve uma nova requisição
   *  - `_testePremiumLogoUrl` / `_testePremiumNome` — conteúdo a renderizar
   *
   * Outros componentes que escutam o jogo veem o `_testePremiumAt` mudar
   * e disparam a janela de 6s local. Funciona em tempo real via Firestore
   * snapshot.
   *
   * REMOVER esta função e os 3 campos quando a feature estiver validada.
   */
  async disparTestePremium(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    logoUrl: string,
    nome: string,
  ): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, categoriaId, jogoId), {
        _testePremiumAt: serverTimestamp(),
        _testePremiumLogoUrl: logoUrl,
        _testePremiumNome: nome,
      } as Partial<Jogo>),
    );
  }

  async adicionarEvento(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    evento: Omit<EventoJogo, 'id' | 'criadoEm'>,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const ref = await addDoc(this.eventosCol(campeonatoId, categoriaId, jogoId), {
        ...evento,
        criadoEm: serverTimestamp() as unknown as Timestamp,
      });
      await this.recalcularPlacar(campeonatoId, categoriaId, jogoId);
      return ref.id;
    });
  }

  async atualizarEvento(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    eventoId: string,
    patch: Partial<EventoJogo>,
  ): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      const ref = doc(this.eventosCol(campeonatoId, categoriaId, jogoId), eventoId);
      await updateDoc(ref, patch as { [key: string]: unknown });
      await this.recalcularPlacar(campeonatoId, categoriaId, jogoId);
    });
  }

  async removerEvento(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    eventoId: string,
  ): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      // Delete primeiro — se falhar aqui, propaga (caller mostra erro).
      await deleteDoc(doc(this.eventosCol(campeonatoId, categoriaId, jogoId), eventoId));
      // Recalc é melhoria, não crítico. Se Firestore Rules bloquearem
      // o update do jogo (ex.: moderador com permissão só pros eventos),
      // o lance já foi removido — não deve travar o fluxo. Loga e segue.
      try {
        await this.recalcularPlacar(campeonatoId, categoriaId, jogoId);
      } catch (err) {
        console.warn('[JogosService] recalcularPlacar falhou após remover evento:', err);
      }
    });
  }

  /**
   * Remove TODOS os eventos do jogo (cartões, gols, faltas, etc.).
   * Útil ao zerar a partida (ex.: ao trocar equipes mandante/visitante).
   * NÃO recalcula placar — chamador deve setar golsMandante/golsVisitante separadamente.
   */
  async limparEventos(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
  ): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDocs(this.eventosCol(campeonatoId, categoriaId, jogoId));
      if (snap.empty) return 0;
      const batch = writeBatch(this.fs);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      return snap.size;
    });
  }

  /**
   * Recalcula golsMandante / golsVisitante a partir dos eventos do tipo "gol" / "gol-contra".
   * - "gol" da equipe X soma para X
   * - "gol-contra" da equipe X soma para o adversário
   */
  private async recalcularPlacar(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
  ): Promise<void> {
    const jogoSnap = await getDoc(this.docRef(campeonatoId, categoriaId, jogoId));
    const jogo = jogoSnap.data() as Jogo | undefined;
    if (!jogo) return;
    const evSnap = await getDocs(this.eventosCol(campeonatoId, categoriaId, jogoId));
    let mandante = 0;
    let visitante = 0;
    evSnap.forEach(d => {
      const e = d.data() as EventoJogo;
      const qtd = e.quantidade && e.quantidade > 0 ? e.quantidade : 1;
      if (e.tipo === 'gol') {
        if (e.equipeId === jogo.mandanteId) mandante += qtd;
        else if (e.equipeId === jogo.visitanteId) visitante += qtd;
      } else if (e.tipo === 'gol-contra') {
        if (e.equipeId === jogo.mandanteId) visitante += qtd;
        else if (e.equipeId === jogo.visitanteId) mandante += qtd;
      }
    });
    await updateDoc(this.docRef(campeonatoId, categoriaId, jogoId), {
      golsMandante: mandante,
      golsVisitante: visitante,
      atualizadoEm: serverTimestamp() as unknown as Timestamp,
    });
  }

  /**
   * Apaga todas as partidas de uma fase (ou todas, se faseNome vazio).
   * Útil antes de "Gerar partidas" novamente.
   */
  async limparFase(campeonatoId: string, categoriaId: string, faseNome?: string): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      const snap = faseNome
        ? await getDocs(query(this.col(campeonatoId, categoriaId), where('fase', '==', faseNome)))
        : await getDocs(this.col(campeonatoId, categoriaId));
      if (snap.empty) return 0;
      const tamanho = 400;
      let removidos = 0;
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += tamanho) {
        const lote = docs.slice(i, i + tamanho);
        const batch = writeBatch(this.fs);
        lote.forEach(d => batch.delete(d.ref));
        await batch.commit();
        removidos += lote.length;
      }
      return removidos;
    });
  }

  /**
   * Gera partidas round-robin para um conjunto de equipes.
   * @param turnos 1 = só ida; 2 = ida e volta.
   * @param faseNome opcional, grava no campo `fase` de cada jogo.
   */
  async gerarRoundRobin(
    campeonatoId: string,
    categoriaId: string,
    equipes: Equipe[],
    turnos: 1 | 2,
    faseNome?: string,
    grupoId?: string,
  ): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      if (equipes.length < 2) return 0;
      const partidas = this.calcularRoundRobin(equipes, turnos);
      const tamanho = 400;
      let total = 0;
      for (let i = 0; i < partidas.length; i += tamanho) {
        const lote = partidas.slice(i, i + tamanho);
        const batch = writeBatch(this.fs);
        lote.forEach(p => {
          const newRef = doc(this.col(campeonatoId, categoriaId));
          const payload: Jogo = {
            campeonatoId,
            categoriaId,
            mandanteId: p.mandanteId,
            visitanteId: p.visitanteId,
            rodada: p.rodada,
            fase: faseNome,
            grupoId,
            status: 'agendado',
            golsMandante: null,
            golsVisitante: null,
            criadoEm: serverTimestamp() as unknown as Timestamp,
            atualizadoEm: serverTimestamp() as unknown as Timestamp,
          };
          batch.set(newRef, payload);
        });
        await batch.commit();
        total += lote.length;
      }
      return total;
    });
  }

  /**
   * Algoritmo round-robin clássico ("círculo"). Para N ímpar, adiciona um "bye".
   * Retorna lista achatada de partidas com rodada associada.
   */
  private calcularRoundRobin(
    equipes: Equipe[],
    turnos: 1 | 2,
  ): { mandanteId: string; visitanteId: string; rodada: number }[] {
    const ids = equipes.map(e => e.id!).filter(Boolean);
    if (ids.length < 2) return [];
    const lista = [...ids];
    if (lista.length % 2 !== 0) lista.push('__BYE__');
    const n = lista.length;
    const rodadasIda: { mandanteId: string; visitanteId: string; rodada: number }[] = [];
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) {
        const a = lista[i];
        const b = lista[n - 1 - i];
        if (a === '__BYE__' || b === '__BYE__') continue;
        // Alterna mando para distribuir melhor
        const mandante = r % 2 === 0 ? a : b;
        const visitante = r % 2 === 0 ? b : a;
        rodadasIda.push({ mandanteId: mandante, visitanteId: visitante, rodada: r + 1 });
      }
      // Rotação: mantém primeiro, gira o resto
      lista.splice(1, 0, lista.pop()!);
    }
    if (turnos === 1) return rodadasIda;
    const offset = n - 1;
    const volta = rodadasIda.map(p => ({
      mandanteId: p.visitanteId,
      visitanteId: p.mandanteId,
      rodada: p.rodada + offset,
    }));
    return [...rodadasIda, ...volta];
  }
}
