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
import { AvisoTela, EventoJogo, Jogo, NovoJogoInput } from './models/jogo.model';

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
  ): DocumentReference<{ jogadorIds: string[]; titularIds?: string[] }> {
    return doc(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos', jogoId,
      'escalacao', equipeId,
    ) as DocumentReference<{ jogadorIds: string[]; titularIds?: string[] }>;
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
    titularIds?: string[],
  ): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      const ref = this.escalacaoDocRef(campeonatoId, categoriaId, jogoId, equipeId);
      // Sanitiza: titularIds tem que ser subconjunto de jogadorIds.
      const tituSaneados = titularIds !== undefined
        ? titularIds.filter(id => jogadorIds.includes(id))
        : undefined;
      const payload: { jogadorIds: string[]; titularIds?: string[] } = { jogadorIds };
      if (tituSaneados !== undefined) payload.titularIds = tituSaneados;
      // setDoc com merge cria o doc se não existir e atualiza só os campos passados.
      await setDoc(ref, payload, { merge: true });
    });
  }

  /** Lê convocados + titulares juntos (uma só assinatura do doc). */
  escalacaoCompleta$(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    equipeId: string,
  ): Observable<{ jogadorIds: string[]; titularIds: string[] }> {
    return runInInjectionContext(this.injector, () =>
      (docData(this.escalacaoDocRef(campeonatoId, categoriaId, jogoId, equipeId)) as Observable<
        { jogadorIds?: string[]; titularIds?: string[] } | undefined
      >).pipe(
        map(d => ({
          jogadorIds: d?.jogadorIds ?? [],
          titularIds: d?.titularIds ?? [],
        })),
      ),
    );
  }

  /** IDs dos jogadores marcados como TITULARES (subconjunto da escalação que
   *  aparece no campo). Vazio = nenhum marcado (UI mostra todos como fallback). */
  titulares$(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    equipeId: string,
  ): Observable<string[]> {
    return runInInjectionContext(this.injector, () =>
      (docData(this.escalacaoDocRef(campeonatoId, categoriaId, jogoId, equipeId)) as Observable<
        { titularIds?: string[] } | undefined
      >).pipe(map(d => d?.titularIds ?? [])),
    );
  }

  /** Salva os titulares (merge — não mexe em jogadorIds). */
  async salvarTitulares(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    equipeId: string,
    titularIds: string[],
  ): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      await setDoc(
        this.escalacaoDocRef(campeonatoId, categoriaId, jogoId, equipeId),
        { titularIds },
        { merge: true },
      );
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
    await runInInjectionContext(this.injector, async () => {
      // Deletar o doc do jogo NÃO apaga a subcoleção `eventos` no Firestore
      // — sem isto, gols/cartões ficavam órfãos (e contavam em rankings via
      // collectionGroup). Apaga eventos + jogo num batch atômico.
      const evSnap = await getDocs(this.eventosCol(campeonatoId, categoriaId, jogoId));
      const batch = writeBatch(this.fs);
      evSnap.docs.forEach(d => batch.delete(d.ref));
      batch.delete(this.docRef(campeonatoId, categoriaId, jogoId));
      await batch.commit();
    });
  }

  /**
   * Exibe (ou atualiza) o "aviso na tela" (lower-third) do jogo. Grava no
   * doc do jogo com `ativo: true` — todas as telas que escutam o jogo
   * (detalhe, transmissão, público) renderizam em tempo real.
   *
   * Campos opcionais ausentes são OMITIDOS do objeto (Firestore rejeita
   * `undefined`). Use `removerAvisoTela` pra tirar da tela.
   */
  async salvarAvisoTela(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    aviso: { texto: string; subtexto?: string; imagemUrl?: string; imagemPath?: string },
  ): Promise<void> {
    const payload: AvisoTela = {
      ativo: true,
      texto: aviso.texto,
      atualizadoEm: serverTimestamp() as unknown as Timestamp,
    };
    if (aviso.subtexto) payload.subtexto = aviso.subtexto;
    if (aviso.imagemUrl) payload.imagemUrl = aviso.imagemUrl;
    if (aviso.imagemPath) payload.imagemPath = aviso.imagemPath;
    await this.atualizar(campeonatoId, categoriaId, jogoId, { avisoTela: payload });
  }

  /** Tira o aviso da tela (seta `ativo: false`, preservando texto/imagem
   *  pra reexibir depois sem redigitar). */
  async removerAvisoTela(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    avisoAtual?: AvisoTela | null,
  ): Promise<void> {
    const payload: AvisoTela = avisoAtual
      ? { ...avisoAtual, ativo: false, atualizadoEm: serverTimestamp() as unknown as Timestamp }
      : { ativo: false, texto: '', atualizadoEm: serverTimestamp() as unknown as Timestamp };
    await this.atualizar(campeonatoId, categoriaId, jogoId, { avisoTela: payload });
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
      // SÓ gols recalculam o placar. Cartões/faltas/etc. NÃO mexem no placar
      // — antes, adicionar um cartão disparava o recálculo e zerava um placar
      // que tinha sido digitado na mão (golsMandante/Visitante manuais).
      if (this.afetaPlacar(evento.tipo)) {
        await this.recalcularPlacar(campeonatoId, categoriaId, jogoId);
      }
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
      // Lê o tipo ANTES pra decidir o recálculo: recalcula se o evento era OU
      // passou a ser um gol (cobre editar quantidade de gol e converter
      // gol↔cartão). Edições que não envolvem gol não tocam no placar.
      const antes = (await getDoc(ref)).data() as EventoJogo | undefined;
      await updateDoc(ref, patch as { [key: string]: unknown });
      const tipoDepois = (patch.tipo ?? antes?.tipo) as EventoJogo['tipo'] | undefined;
      if (this.afetaPlacar(antes?.tipo) || this.afetaPlacar(tipoDepois)) {
        await this.recalcularPlacar(campeonatoId, categoriaId, jogoId);
      }
    });
  }

  async removerEvento(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    eventoId: string,
  ): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      const ref = doc(this.eventosCol(campeonatoId, categoriaId, jogoId), eventoId);
      // Lê o tipo ANTES de apagar — só recalcula se era um gol.
      const antes = (await getDoc(ref)).data() as EventoJogo | undefined;
      // Delete primeiro — se falhar aqui, propaga (caller mostra erro).
      await deleteDoc(ref);
      // Recalc é melhoria, não crítico. Se Firestore Rules bloquearem
      // o update do jogo (ex.: moderador com permissão só pros eventos),
      // o lance já foi removido — não deve travar o fluxo. Loga e segue.
      if (this.afetaPlacar(antes?.tipo)) {
        try {
          await this.recalcularPlacar(campeonatoId, categoriaId, jogoId);
        } catch (err) {
          console.warn('[JogosService] recalcularPlacar falhou após remover evento:', err);
        }
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

  /** True se o tipo de evento afeta o placar (apenas gols). Cartões, faltas
   *  e demais lances não alteram golsMandante/Visitante. */
  private afetaPlacar(tipo: EventoJogo['tipo'] | undefined): boolean {
    return tipo === 'gol' || tipo === 'gol-contra';
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
