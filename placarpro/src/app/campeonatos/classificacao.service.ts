import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { EquipesService } from './equipes.service';
import { GruposService } from './grupos.service';
import { JogosService } from './jogos.service';
import { Equipe } from './models/equipe.model';
import { Grupo } from './models/grupo.model';
import { Jogo } from './models/jogo.model';
import { CRITERIOS_PADRAO, CriterioId, Fase } from './models/fase.model';

/** Estatísticas de uma equipe no grupo/fase. */
export interface LinhaClassificacao {
  equipe: Equipe;
  pos: number;
  pontos: number;
  pontosBase: number;
  jogos: number;
  vitorias: number;
  empates: number;
  derrotas: number;
  golsPro: number;
  golsContra: number;
  saldoGols: number;
  aproveitamento: number; // % (0-100)
  penalizacao: number;
  cartoesAmarelos: number;
  cartoesVermelhos: number;
  /** Vitórias fora de casa (como visitante). */
  vitoriasFora: number;
  /** Gols marcados como visitante. */
  golsFora: number;
}

export interface ClassificacaoGrupo {
  grupo: Grupo | null;
  linhas: LinhaClassificacao[];
}

@Injectable({ providedIn: 'root' })
export class ClassificacaoService {
  private readonly equipesSrv = inject(EquipesService);
  private readonly gruposSrv = inject(GruposService);
  private readonly jogosSrv = inject(JogosService);

  /**
   * Classificação considerando uma fase opcional.
   * - Se `fase` definido: usa o nome da fase pra filtrar jogos (campo `jogo.fase`) e os pontos da fase.
   * - Se `ordemManual` ativo: usa `equipe.posicaoManual` como ordenação.
   */
  classificacao$(
    campeonatoId: string,
    categoriaId: string,
    fase?: Fase | null,
    ordemManual = false,
  ): Observable<ClassificacaoGrupo[]> {
    return combineLatest([
      this.equipesSrv.list$(campeonatoId, categoriaId),
      this.gruposSrv.list$(campeonatoId, categoriaId),
      this.jogosSrv.list$(campeonatoId, categoriaId),
    ]).pipe(
      map(([equipes, grupos, jogos]) => this.computar(equipes, grupos, jogos, fase, ordemManual)),
    );
  }

  private computar(
    equipes: Equipe[],
    grupos: Grupo[],
    jogos: Jogo[],
    fase?: Fase | null,
    ordemManual = false,
  ): ClassificacaoGrupo[] {
    const criterios = fase?.criterios?.length ? fase.criterios : CRITERIOS_PADRAO;
    const pontosV = fase?.pontosVitoria ?? 3;
    const pontosE = fase?.pontosEmpate ?? 1;
    const pontosD = fase?.pontosDerrota ?? 0;

    const jogosFiltrados = fase
      ? jogos.filter(j => !j.fase || j.fase === fase.nome || j.fase === fase.id)
      : jogos;

    const equipesPorGrupo = new Map<string, Equipe[]>();
    equipes.forEach(e => {
      const key = e.grupoId ?? 'sem-grupo';
      if (!equipesPorGrupo.has(key)) equipesPorGrupo.set(key, []);
      equipesPorGrupo.get(key)!.push(e);
    });

    const buildLinhas = (equipesDoGrupo: Equipe[]): LinhaClassificacao[] => {
      const stats = new Map<string, LinhaClassificacao>();

      equipesDoGrupo.forEach(e => {
        stats.set(e.id!, {
          equipe: e,
          pos: 0,
          pontos: 0,
          pontosBase: 0,
          jogos: 0,
          vitorias: 0,
          empates: 0,
          derrotas: 0,
          golsPro: 0,
          golsContra: 0,
          saldoGols: 0,
          aproveitamento: 0,
          penalizacao: e.penalizacao ?? 0,
          cartoesAmarelos: 0,
          cartoesVermelhos: 0,
          vitoriasFora: 0,
          golsFora: 0,
        });
      });

      // Saldo no confronto direto: A vs B → mapa[A][B] = saldo de gols
      const confrontoDireto = new Map<string, Map<string, number>>();
      const saldoConfronto = new Map<string, Map<string, number>>();
      const addConfronto = (
        a: string,
        b: string,
        pts: number,
        golsA: number,
        golsB: number,
      ) => {
        if (!confrontoDireto.has(a)) confrontoDireto.set(a, new Map());
        confrontoDireto.get(a)!.set(b, (confrontoDireto.get(a)!.get(b) ?? 0) + pts);
        if (!saldoConfronto.has(a)) saldoConfronto.set(a, new Map());
        saldoConfronto.get(a)!.set(
          b,
          (saldoConfronto.get(a)!.get(b) ?? 0) + (golsA - golsB),
        );
      };

      jogosFiltrados
        .filter(j => j.status === 'encerrado' && j.golsMandante != null && j.golsVisitante != null)
        .forEach(j => {
          const man = stats.get(j.mandanteId);
          const vis = stats.get(j.visitanteId);
          if (!man || !vis) return;

          const gM = j.golsMandante!;
          const gV = j.golsVisitante!;

          man.jogos++; vis.jogos++;
          man.golsPro += gM;
          vis.golsPro += gV;
          man.golsContra += gV;
          vis.golsContra += gM;

          // Gols como visitante
          vis.golsFora += gV;

          if (gM > gV) {
            man.vitorias++; man.pontosBase += pontosV;
            vis.derrotas++; vis.pontosBase += pontosD;
            addConfronto(j.mandanteId, j.visitanteId, pontosV, gM, gV);
            addConfronto(j.visitanteId, j.mandanteId, pontosD, gV, gM);
          } else if (gM < gV) {
            vis.vitorias++; vis.pontosBase += pontosV;
            vis.vitoriasFora++; // venceu como visitante
            man.derrotas++; man.pontosBase += pontosD;
            addConfronto(j.visitanteId, j.mandanteId, pontosV, gV, gM);
            addConfronto(j.mandanteId, j.visitanteId, pontosD, gM, gV);
          } else {
            man.empates++; vis.empates++;
            man.pontosBase += pontosE; vis.pontosBase += pontosE;
            addConfronto(j.mandanteId, j.visitanteId, pontosE, gM, gV);
            addConfronto(j.visitanteId, j.mandanteId, pontosE, gV, gM);
          }
        });

      const linhas = Array.from(stats.values()).map(l => ({
        ...l,
        saldoGols: l.golsPro - l.golsContra,
        pontos: Math.max(0, l.pontosBase - l.penalizacao),
        aproveitamento:
          l.jogos > 0 ? Math.round((l.pontosBase / (l.jogos * pontosV)) * 100) : 0,
      }));

      if (ordemManual) {
        linhas.sort((a, b) => {
          const ma = a.equipe.posicaoManual;
          const mb = b.equipe.posicaoManual;
          if (ma != null && mb != null) return ma - mb;
          if (ma != null) return -1;
          if (mb != null) return 1;
          return a.equipe.nome.localeCompare(b.equipe.nome);
        });
      } else {
        linhas.sort((a, b) =>
          this.compararPorCriterios(a, b, criterios, confrontoDireto, saldoConfronto),
        );
      }

      linhas.forEach((l, i) => (l.pos = i + 1));
      return linhas;
    };

    if (grupos.length === 0) {
      return [{ grupo: null, linhas: buildLinhas(equipes) }];
    }

    const resultados = grupos.map(g => ({
      grupo: g,
      linhas: buildLinhas(equipesPorGrupo.get(g.id!) ?? []),
    }));
    const semGrupo = equipesPorGrupo.get('sem-grupo') ?? [];
    if (semGrupo.length > 0) {
      resultados.push({
        grupo: { id: 'sem-grupo', nome: 'Sem grupo', ordem: 999 } as Grupo,
        linhas: buildLinhas(semGrupo),
      });
    }
    return resultados;
  }

  private compararPorCriterios(
    a: LinhaClassificacao,
    b: LinhaClassificacao,
    criterios: CriterioId[],
    confronto: Map<string, Map<string, number>>,
    saldoConfronto: Map<string, Map<string, number>>,
  ): number {
    for (const c of criterios) {
      const diff =
        this.valorCriterio(b, c, confronto, saldoConfronto, a) -
        this.valorCriterio(a, c, confronto, saldoConfronto, b);
      if (diff !== 0) return diff;
    }
    return a.equipe.nome.localeCompare(b.equipe.nome);
  }

  private valorCriterio(
    l: LinhaClassificacao,
    c: CriterioId,
    confronto: Map<string, Map<string, number>>,
    saldoConfronto: Map<string, Map<string, number>>,
    oponente: LinhaClassificacao,
  ): number {
    switch (c) {
      case 'pontos': return l.pontos;
      case 'vitorias': return l.vitorias;
      case 'saldo-gols': return l.saldoGols;
      case 'gols-pro': return l.golsPro;
      case 'gols-contra': return -l.golsContra;
      case 'confronto-direto':
        return confronto.get(l.equipe.id!)?.get(oponente.equipe.id!) ?? 0;
      case 'cartoes-vermelhos': return -l.cartoesVermelhos;
      case 'cartoes-amarelos': return -l.cartoesAmarelos;
      case 'sorteio': return 0;
      // Novos
      case 'aproveitamento': return l.aproveitamento;
      case 'empates': return -l.empates;
      case 'derrotas': return -l.derrotas;
      case 'cartoes-totais': return -(l.cartoesAmarelos + l.cartoesVermelhos);
      case 'saldo-confronto-direto':
        return saldoConfronto.get(l.equipe.id!)?.get(oponente.equipe.id!) ?? 0;
      case 'vitorias-fora': return l.vitoriasFora;
      case 'gols-fora': return l.golsFora;
      case 'jogos-disputados': return l.jogos;
      case 'menor-idade-media': return 0;
      case 'maior-idade-media': return 0;
      case 'criterio-tecnico': return 0;
    }
  }
}
