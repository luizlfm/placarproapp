import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  collection,
  collectionData,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import { collectionGroup } from '@angular/fire/firestore';
import { EquipesService } from './equipes.service';
import { JogadoresService } from './jogadores.service';
import { JogosService } from './jogos.service';
import { Equipe } from './models/equipe.model';
import { Jogador } from './models/jogador.model';
import { Jogo, EventoJogo, EventoTipo } from './models/jogo.model';

export interface LinhaRanking {
  jogador: Jogador;
  equipe?: Equipe;
  total: number;
  /** Posição final na lista (1 = melhor). */
  pos: number;
}

export type TipoRanking = 'artilharia' | 'assistencia' | 'amarelos' | 'vermelhos';

@Injectable({ providedIn: 'root' })
export class RankingsService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);

  /**
   * Stream agregado de TODOS os eventos da categoria, juntando os eventos
   * de cada jogo via `combineLatest`. Em categorias muito grandes (>100 jogos)
   * pode ficar pesado; aceitável para o uso atual.
   */
  eventosDaCategoria$(
    campeonatoId: string,
    categoriaId: string,
  ): Observable<EventoJogo[]> {
    return this.jogosSrv.list$(campeonatoId, categoriaId).pipe(
      switchMap((jogos: Jogo[]) => {
        if (jogos.length === 0) return of<EventoJogo[]>([]);
        const streams = jogos
          .filter(j => j.id)
          .map(j =>
            this.jogosSrv.listEventos$(campeonatoId, categoriaId, j.id!),
          );
        return combineLatest(streams).pipe(
          map(arrs => arrs.reduce<EventoJogo[]>((acc, arr) => acc.concat(arr), [])),
        );
      }),
    );
  }

  /**
   * Ranking para um tipo (artilharia, assistência, cartões).
   * Junta eventos + jogadores + equipes e retorna a tabela ordenada.
   */
  ranking$(
    campeonatoId: string,
    categoriaId: string,
    tipo: TipoRanking,
  ): Observable<LinhaRanking[]> {
    return combineLatest([
      this.eventosDaCategoria$(campeonatoId, categoriaId),
      this.jogadoresSrv.list$(campeonatoId, categoriaId),
      this.equipesSrv.list$(campeonatoId, categoriaId),
    ]).pipe(
      map(([eventos, jogadores, equipes]) => this.computar(eventos, jogadores, equipes, tipo)),
    );
  }

  private computar(
    eventos: EventoJogo[],
    jogadores: Jogador[],
    equipes: Equipe[],
    tipo: TipoRanking,
  ): LinhaRanking[] {
    const totais = new Map<string, number>();

    const addPonto = (jogadorId?: string, qtd = 1) => {
      if (!jogadorId) return;
      totais.set(jogadorId, (totais.get(jogadorId) ?? 0) + qtd);
    };

    // Filtra os eventos relevantes e conta por jogador.
    const tipoEvento: EventoTipo | null = (() => {
      switch (tipo) {
        case 'artilharia': return 'gol';
        case 'amarelos':   return 'amarelo';
        case 'vermelhos':  return 'vermelho';
        case 'assistencia':return null; // tratado separado: usa assistenteId dos gols
      }
    })();

    eventos.forEach(e => {
      const qtd = e.quantidade ?? 1;
      if (tipo === 'assistencia') {
        if (e.tipo === 'gol' && e.assistenteId) {
          addPonto(e.assistenteId, qtd);
        }
        return;
      }
      if (e.tipo === tipoEvento) {
        addPonto(e.jogadorId, qtd);
      }
    });

    const eqsMap = new Map(equipes.map(e => [e.id!, e]));

    const linhas: LinhaRanking[] = [];
    totais.forEach((total, jid) => {
      const jogador = jogadores.find(j => j.id === jid);
      if (!jogador) return;
      linhas.push({
        jogador,
        equipe: jogador.equipeId ? eqsMap.get(jogador.equipeId) : undefined,
        total,
        pos: 0,
      });
    });

    linhas.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return (a.jogador.nome ?? '').localeCompare(b.jogador.nome ?? '', 'pt-BR');
    });
    linhas.forEach((l, i) => (l.pos = i + 1));
    return linhas;
  }
}
