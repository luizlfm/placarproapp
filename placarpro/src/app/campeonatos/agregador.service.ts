import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import { Campeonato } from './campeonato.model';
import { Categoria } from './categoria.model';
import { Equipe } from './models/equipe.model';
import { Jogador } from './models/jogador.model';
import { CampeonatosService } from './campeonatos.service';
import { CategoriasService } from './categorias.service';
import { EquipesService } from './equipes.service';
import { JogadoresService } from './jogadores.service';

export interface EquipeAgregada extends Equipe {
  campeonatoTitulo: string;
  categoriaTitulo: string;
}

export interface JogadorAgregado extends Jogador {
  campeonatoTitulo: string;
  categoriaTitulo: string;
  equipeNome?: string;
}

/**
 * Agrega dados de TODAS as categorias de TODOS os campeonatos do usuário
 * para as telas globais "Cadastro de equipes" e "Cadastro de jogadores".
 *
 * Como Firestore não tem JOIN, fazemos a explosão no cliente:
 * campeonatos → categorias → equipes/jogadores → flatten.
 */
@Injectable({ providedIn: 'root' })
export class AgregadorService {
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);

  /** Todas as equipes do usuário, anotadas com nome do campeonato e categoria. */
  todasEquipes$(): Observable<EquipeAgregada[]> {
    return this.campeonatosSrv.listMeus$().pipe(
      switchMap(camps => {
        if (camps.length === 0) return of([] as EquipeAgregada[]);

        // Para cada campeonato, lista todas as categorias
        const porCamp$ = camps.map(c =>
          this.categoriasSrv.list$(c.id!).pipe(
            switchMap(cats => {
              if (cats.length === 0) return of([] as EquipeAgregada[]);
              // Para cada categoria, lista as equipes
              const porCat$ = cats.map(cat =>
                this.equipesSrv.list$(c.id!, cat.id!).pipe(
                  map(eqs =>
                    eqs.map<EquipeAgregada>(e => ({
                      ...e,
                      campeonatoTitulo: c.titulo,
                      categoriaTitulo: cat.titulo,
                    })),
                  ),
                ),
              );
              return combineLatest(porCat$).pipe(map(arr => ([] as any[]).concat(...arr)));
            }),
          ),
        );

        return combineLatest(porCamp$).pipe(map(arr => ([] as any[]).concat(...arr)));
      }),
    );
  }

  /** Todos os jogadores do usuário com nome da equipe/categoria/campeonato. */
  todosJogadores$(): Observable<JogadorAgregado[]> {
    return this.campeonatosSrv.listMeus$().pipe(
      switchMap(camps => {
        if (camps.length === 0) return of([] as JogadorAgregado[]);

        const porCamp$ = camps.map(c =>
          this.categoriasSrv.list$(c.id!).pipe(
            switchMap(cats => {
              if (cats.length === 0) return of([] as JogadorAgregado[]);
              const porCat$ = cats.map(cat =>
                combineLatest([
                  this.jogadoresSrv.list$(c.id!, cat.id!),
                  this.equipesSrv.list$(c.id!, cat.id!),
                ]).pipe(
                  map(([jgs, eqs]) =>
                    jgs.map<JogadorAgregado>(j => ({
                      ...j,
                      campeonatoTitulo: c.titulo,
                      categoriaTitulo: cat.titulo,
                      equipeNome: eqs.find(e => e.id === j.equipeId)?.nome,
                    })),
                  ),
                ),
              );
              return combineLatest(porCat$).pipe(map(arr => ([] as any[]).concat(...arr)));
            }),
          ),
        );

        return combineLatest(porCamp$).pipe(map(arr => ([] as any[]).concat(...arr)));
      }),
    );
  }
}
