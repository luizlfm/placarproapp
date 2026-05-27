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
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, map } from 'rxjs';
import { Categoria, NovaCategoriaInput } from './categoria.model';
import { Equipe } from './models/equipe.model';
import { Jogador } from './models/jogador.model';
import { Jogo } from './models/jogo.model';

/** Opções de cópia ao duplicar uma categoria. */
export interface OpcoesDuplicacao {
  copiarEquipes: boolean;
  copiarJogadores: boolean;
  copiarPartidas: boolean;
}

@Injectable({ providedIn: 'root' })
export class CategoriasService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  private col(campeonatoId: string): CollectionReference<Categoria> {
    return collection(this.fs, 'campeonatos', campeonatoId, 'categorias') as CollectionReference<Categoria>;
  }

  private docRef(campeonatoId: string, catId: string): DocumentReference<Categoria> {
    return doc(this.fs, 'campeonatos', campeonatoId, 'categorias', catId) as DocumentReference<Categoria>;
  }

  private equipesCol(campeonatoId: string, categoriaId: string): CollectionReference<Equipe> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'equipes',
    ) as CollectionReference<Equipe>;
  }

  private jogadoresCol(campeonatoId: string, categoriaId: string): CollectionReference<Jogador> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogadores',
    ) as CollectionReference<Jogador>;
  }

  private jogosCol(campeonatoId: string, categoriaId: string): CollectionReference<Jogo> {
    return collection(
      this.fs,
      'campeonatos', campeonatoId,
      'categorias', categoriaId,
      'jogos',
    ) as CollectionReference<Jogo>;
  }

  /**
   * Lista as categorias do campeonato.
   * Ordena por `ordem` (asc) quando definido, e usa `criadoEm` como desempate
   * pra categorias que ainda não receberam reordenação manual.
   */
  list$(campeonatoId: string): Observable<Categoria[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(campeonatoId), orderBy('criadoEm', 'asc'));
      return (collectionData(q, { idField: 'id' }) as Observable<Categoria[]>).pipe(
        map(arr => [...arr].sort((a, b) => {
          const oa = a.ordem ?? Number.POSITIVE_INFINITY;
          const ob = b.ordem ?? Number.POSITIVE_INFINITY;
          if (oa !== ob) return oa - ob;
          // Fallback: usa criadoEm.toMillis quando ambos sem ordem
          const ta = (a.criadoEm as Timestamp | undefined)?.toMillis?.() ?? 0;
          const tb = (b.criadoEm as Timestamp | undefined)?.toMillis?.() ?? 0;
          return ta - tb;
        })),
      );
    });
  }

  get$(campeonatoId: string, catId: string): Observable<Categoria | undefined> {
    return runInInjectionContext(this.injector, () =>
      docData(this.docRef(campeonatoId, catId), { idField: 'id' }) as Observable<Categoria | undefined>,
    );
  }

  async criar(campeonatoId: string, input: NovaCategoriaInput): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      // Calcula a próxima `ordem` (maior atual + 1) para que a nova categoria
      // fique no final da lista por padrão.
      const proximaOrdem = await this.proximaOrdem(campeonatoId);
      const payload: Categoria = {
        ...input,
        campeonatoId,
        totalEquipes: 0,
        totalJogadores: 0,
        ordem: proximaOrdem,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      const ref = await addDoc(this.col(campeonatoId), payload);
      return ref.id;
    });
  }

  async atualizar(campeonatoId: string, catId: string, patch: Partial<Categoria>): Promise<void> {
    await runInInjectionContext(this.injector, () =>
      updateDoc(this.docRef(campeonatoId, catId), {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      }),
    );
  }

  async remover(campeonatoId: string, catId: string): Promise<void> {
    await runInInjectionContext(this.injector, () => deleteDoc(this.docRef(campeonatoId, catId)));
  }

  /** Calcula a próxima posição (maior `ordem` + 1) na lista. */
  private async proximaOrdem(campeonatoId: string): Promise<number> {
    return runInInjectionContext(this.injector, async () => {
      const snap = await getDocs(this.col(campeonatoId));
      let max = -1;
      snap.forEach(d => {
        const o = (d.data() as Categoria).ordem;
        if (typeof o === 'number' && o > max) max = o;
      });
      return max + 1;
    });
  }

  /**
   * Move a categoria uma posição para cima (troca de `ordem` com a anterior).
   * Quando alguma das duas ainda não tem `ordem`, normaliza a lista toda antes.
   */
  async moverParaCima(campeonatoId: string, catId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ordenadas = await this.carregarOrdenadas(campeonatoId);
      const idx = ordenadas.findIndex(c => c.id === catId);
      if (idx <= 0) return; // Já está no topo (ou não encontrado).
      await this.normalizarOrdem(campeonatoId, ordenadas);
      const atual = ordenadas[idx];
      const anterior = ordenadas[idx - 1];
      const batch = writeBatch(this.fs);
      batch.update(this.docRef(campeonatoId, atual.id!), { ordem: idx - 1 });
      batch.update(this.docRef(campeonatoId, anterior.id!), { ordem: idx });
      await batch.commit();
    });
  }

  /** Move a categoria uma posição para baixo. */
  async moverParaBaixo(campeonatoId: string, catId: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ordenadas = await this.carregarOrdenadas(campeonatoId);
      const idx = ordenadas.findIndex(c => c.id === catId);
      if (idx === -1 || idx >= ordenadas.length - 1) return;
      await this.normalizarOrdem(campeonatoId, ordenadas);
      const atual = ordenadas[idx];
      const proxima = ordenadas[idx + 1];
      const batch = writeBatch(this.fs);
      batch.update(this.docRef(campeonatoId, atual.id!), { ordem: idx + 1 });
      batch.update(this.docRef(campeonatoId, proxima.id!), { ordem: idx });
      await batch.commit();
    });
  }

  private async carregarOrdenadas(campeonatoId: string): Promise<Categoria[]> {
    const snap = await getDocs(query(this.col(campeonatoId), orderBy('criadoEm', 'asc')));
    const lista: Categoria[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Categoria) }));
    lista.sort((a, b) => {
      const oa = a.ordem ?? Number.POSITIVE_INFINITY;
      const ob = b.ordem ?? Number.POSITIVE_INFINITY;
      if (oa !== ob) return oa - ob;
      const ta = (a.criadoEm as Timestamp | undefined)?.toMillis?.() ?? 0;
      const tb = (b.criadoEm as Timestamp | undefined)?.toMillis?.() ?? 0;
      return ta - tb;
    });
    return lista;
  }

  /**
   * Reescreve a coluna `ordem` para 0..n seguindo a ordem atual da lista
   * (quando alguma categoria ainda não tinha valor de `ordem`).
   * Idempotente: se já estiver normalizado, não escreve nada.
   */
  private async normalizarOrdem(campeonatoId: string, ordenadas: Categoria[]): Promise<void> {
    const precisaNormalizar = ordenadas.some((c, i) => c.ordem !== i);
    if (!precisaNormalizar) return;
    const batch = writeBatch(this.fs);
    ordenadas.forEach((c, i) => {
      if (c.ordem !== i) {
        batch.update(this.docRef(campeonatoId, c.id!), { ordem: i });
      }
    });
    await batch.commit();
    // Atualiza in-memory pra próximas swaps usarem os valores corretos.
    ordenadas.forEach((c, i) => (c.ordem = i));
  }

  /**
   * Duplica uma categoria criando um novo doc. Copia opcionalmente:
   *  - equipes (preserva nome/cidade/logo/tecnico/cor)
   *  - jogadores (depende de copiar equipes — remapeia equipeId)
   *  - partidas (depende de copiar equipes — remapeia mandanteId/visitanteId,
   *              limpa placar e volta status para `agendado`)
   * Retorna o id da nova categoria.
   */
  async duplicar(
    campeonatoId: string,
    sourceId: string,
    novoTitulo: string,
    opcoes: OpcoesDuplicacao,
  ): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      // 1) Carrega categoria de origem
      const sourceSnap = await getDocs(
        query(this.col(campeonatoId), orderBy('criadoEm', 'asc')),
      );
      const source = sourceSnap.docs.find(d => d.id === sourceId)?.data() as Categoria | undefined;
      if (!source) throw new Error('Categoria de origem não encontrada.');

      // 2) Cria a nova categoria, copiando os campos de config (sem IDs/contadores).
      const proximaOrdem = await this.proximaOrdem(campeonatoId);
      const novoPayload: Categoria = {
        ...stripUndefined({
          campeonatoId,
          titulo: novoTitulo,
          subtitulo: source.subtitulo,
          modalidade: source.modalidade,
          tipoFase: source.tipoFase,
          descricao: source.descricao,
          regras: source.regras,
          premiacoes: source.premiacoes,
          cor: source.cor,
          dataInicio: source.dataInicio,
          dataFim: source.dataFim,
          contatos: source.contatos,
          linkExterno: source.linkExterno,
          localizacaoTipo: source.localizacaoTipo,
          localizacao: source.localizacao,
          publico: source.publico,
          permiteMidiasUsuarios: source.permiteMidiasUsuarios,
          permiteComentarios: source.permiteComentarios,
          exibirNomes: source.exibirNomes,
          exibirDatas: source.exibirDatas,
          configEsporte: source.configEsporte,
          inscricoes: source.inscricoes,
          // Logo/banner/capa referenciam o mesmo arquivo do Storage; ok compartilhar a URL.
          logoUrl: source.logoUrl,
          bannerUrl: source.bannerUrl,
          capaUrl: source.capaUrl,
        }) as Partial<Categoria>,
        totalEquipes: 0,
        totalJogadores: 0,
        ordem: proximaOrdem,
        criadoEm: serverTimestamp() as unknown as Timestamp,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      } as Categoria;
      const novaRef = await addDoc(this.col(campeonatoId), novoPayload);
      const novaCategoriaId = novaRef.id;

      // 3) Copiar equipes (e construir mapa antigoEquipeId → novoEquipeId)
      const mapaEquipes = new Map<string, string>();
      if (opcoes.copiarEquipes) {
        const equipesSnap = await getDocs(this.equipesCol(campeonatoId, sourceId));
        // Firestore batch suporta até 500 ops. Para listas grandes paginamos.
        const equipesDocs = equipesSnap.docs;
        let totalEquipes = 0;
        for (let i = 0; i < equipesDocs.length; i += 400) {
          const lote = equipesDocs.slice(i, i + 400);
          const batch = writeBatch(this.fs);
          for (const d of lote) {
            const data = d.data() as Equipe;
            const novaEqRef = doc(this.equipesCol(campeonatoId, novaCategoriaId));
            const payload: Equipe = stripUndefined({
              campeonatoId,
              categoriaId: novaCategoriaId,
              nome: data.nome,
              cidade: data.cidade,
              logoUrl: data.logoUrl,
              tecnico: data.tecnico,
              cor: data.cor,
              // grupoId não é copiado (grupos pertencem a outra categoria).
              totalJogadores: 0,
              criadoEm: serverTimestamp() as unknown as Timestamp,
              atualizadoEm: serverTimestamp() as unknown as Timestamp,
            }) as Equipe;
            batch.set(novaEqRef, payload);
            mapaEquipes.set(d.id, novaEqRef.id);
            totalEquipes++;
          }
          await batch.commit();
        }
        // Atualiza o contador denormalizado na categoria nova.
        await updateDoc(this.docRef(campeonatoId, novaCategoriaId), { totalEquipes });
      }

      // 4) Copiar jogadores (só faz sentido se equipes foram copiadas)
      if (opcoes.copiarJogadores && opcoes.copiarEquipes && mapaEquipes.size > 0) {
        const jogadoresSnap = await getDocs(this.jogadoresCol(campeonatoId, sourceId));
        const jogadoresDocs = jogadoresSnap.docs;
        // Mapa de contadores de jogadores por equipe nova, pra atualizar no fim.
        const contadorPorEquipe = new Map<string, number>();
        let totalJogadores = 0;
        for (let i = 0; i < jogadoresDocs.length; i += 400) {
          const lote = jogadoresDocs.slice(i, i + 400);
          const batch = writeBatch(this.fs);
          for (const d of lote) {
            const data = d.data() as Jogador;
            const novaEquipeId = mapaEquipes.get(data.equipeId);
            if (!novaEquipeId) continue; // equipe não foi copiada (não deve acontecer)
            const novoRef = doc(this.jogadoresCol(campeonatoId, novaCategoriaId));
            const payload: Jogador = stripUndefined({
              campeonatoId,
              categoriaId: novaCategoriaId,
              equipeId: novaEquipeId,
              nome: data.nome,
              apelido: data.apelido,
              posicao: data.posicao,
              numeroCamisa: data.numeroCamisa,
              documento: data.documento,
              dataNascimento: data.dataNascimento,
              telefone: data.telefone,
              fotoUrl: data.fotoUrl,
              cadastradoEm: serverTimestamp() as unknown as Timestamp,
              atualizadoEm: serverTimestamp() as unknown as Timestamp,
            }) as Jogador;
            batch.set(novoRef, payload);
            contadorPorEquipe.set(novaEquipeId, (contadorPorEquipe.get(novaEquipeId) ?? 0) + 1);
            totalJogadores++;
          }
          await batch.commit();
        }
        // Atualiza os contadores em cada equipe nova.
        if (contadorPorEquipe.size > 0) {
          const batch = writeBatch(this.fs);
          contadorPorEquipe.forEach((qtd, equipeId) => {
            batch.update(
              doc(this.equipesCol(campeonatoId, novaCategoriaId), equipeId),
              { totalJogadores: qtd, atualizadoEm: serverTimestamp() },
            );
          });
          batch.update(this.docRef(campeonatoId, novaCategoriaId), { totalJogadores });
          await batch.commit();
        }
      }

      // 5) Copiar partidas (só se equipes copiadas; mandante/visitante remapeados;
      //    placar zerado e status volta pra "agendado")
      if (opcoes.copiarPartidas && opcoes.copiarEquipes && mapaEquipes.size > 0) {
        const jogosSnap = await getDocs(this.jogosCol(campeonatoId, sourceId));
        const jogosDocs = jogosSnap.docs;
        for (let i = 0; i < jogosDocs.length; i += 400) {
          const lote = jogosDocs.slice(i, i + 400);
          const batch = writeBatch(this.fs);
          for (const d of lote) {
            const data = d.data() as Jogo;
            const novoMandante = mapaEquipes.get(data.mandanteId);
            const novoVisitante = mapaEquipes.get(data.visitanteId);
            if (!novoMandante || !novoVisitante) continue;
            const novoRef = doc(this.jogosCol(campeonatoId, novaCategoriaId));
            const payload: Jogo = stripUndefined({
              campeonatoId,
              categoriaId: novaCategoriaId,
              fase: data.fase,
              rodada: data.rodada,
              // grupoId não é copiado (grupos pertencem a outra categoria).
              mandanteId: novoMandante,
              visitanteId: novoVisitante,
              dataHora: data.dataHora,
              local: data.local,
              titulo: data.titulo,
              status: 'agendado',
              golsMandante: null,
              golsVisitante: null,
              criadoEm: serverTimestamp() as unknown as Timestamp,
              atualizadoEm: serverTimestamp() as unknown as Timestamp,
            }) as Jogo;
            batch.set(novoRef, payload);
          }
          await batch.commit();
        }
      }

      return novaCategoriaId;
    });
  }
}

/**
 * Remove chaves cujo valor é `undefined` — Firestore rejeita undefined em
 * set/update e dispara `Unsupported field value: undefined`.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
