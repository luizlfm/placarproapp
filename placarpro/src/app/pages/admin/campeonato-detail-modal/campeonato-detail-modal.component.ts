import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { InscricoesService } from '../../../campeonatos/inscricoes.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { Inscricao } from '../../../campeonatos/models/inscricao.model';

interface LinhaCategoria {
  categoria: Categoria;
  equipes: number;
  jogadores: number;
  jogos: number;
  jogosEncerrados: number;
}

@Component({
  selector: 'app-campeonato-detail-modal',
  templateUrl: './campeonato-detail-modal.component.html',
  styleUrls: ['./campeonato-detail-modal.component.scss'],
  standalone: false,
})
export class CampeonatoDetailModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly catsSrv = inject(CategoriasService);
  private readonly eqsSrv = inject(EquipesService);
  private readonly jgsSrv = inject(JogadoresService);
  private readonly jogosSrv = inject(JogosService);
  private readonly inscsSrv = inject(InscricoesService);

  @Input() campeonato!: Campeonato;

  categorias$: Observable<LinhaCategoria[]> = of([]);
  inscricoes$: Observable<Inscricao[]> = of([]);
  totalEquipes = 0;
  totalJogadores = 0;
  totalJogos = 0;

  ngOnInit(): void {
    if (!this.campeonato?.id) return;
    const id = this.campeonato.id;

    // Categorias enriquecidas com contagens (equipes/jogadores/jogos)
    this.categorias$ = this.catsSrv.list$(id).pipe(
      catchError(() => of([] as Categoria[])),
      switchMap(cats => {
        if (!cats || cats.length === 0) {
          this.totalEquipes = this.totalJogadores = this.totalJogos = 0;
          return of([] as LinhaCategoria[]);
        }
        const streams = cats
          .filter(c => !!c.id)
          .map(c => combineLatest([
            this.eqsSrv.list$(id, c.id!).pipe(catchError(() => of([] as Equipe[]))),
            this.jgsSrv.list$(id, c.id!).pipe(catchError(() => of([] as Jogador[]))),
            this.jogosSrv.list$(id, c.id!).pipe(catchError(() => of([] as Jogo[]))),
          ]).pipe(
            map(([eqs, jgds, jgs]): LinhaCategoria => ({
              categoria: c,
              equipes: eqs?.length ?? 0,
              jogadores: jgds?.length ?? 0,
              jogos: jgs?.length ?? 0,
              jogosEncerrados: (jgs ?? []).filter(j => j.status === 'encerrado').length,
            })),
          ));
        return combineLatest(streams).pipe(
          map(linhas => {
            this.totalEquipes = linhas.reduce((s, l) => s + l.equipes, 0);
            this.totalJogadores = linhas.reduce((s, l) => s + l.jogadores, 0);
            this.totalJogos = linhas.reduce((s, l) => s + l.jogos, 0);
            return linhas;
          }),
        );
      }),
      startWith([] as LinhaCategoria[]),
    );

    this.inscricoes$ = this.inscsSrv.list$(id).pipe(
      catchError(() => of([] as Inscricao[])),
      startWith([] as Inscricao[]),
    );
  }

  fechar(abrirCategoriaId?: string): void {
    this.modalCtrl.dismiss(abrirCategoriaId ? { abrirCategoriaId } : undefined);
  }

  abrirCategoria(c: Categoria): void {
    this.fechar(c.id);
  }

  abrirComoOwner(): void {
    // Apenas fecha — o caller (admin.page) é quem decide o que abrir.
    this.modalCtrl.dismiss({ abrirCampeonatoComoOwner: true });
  }

  corStatus(status?: string): string {
    switch (status) {
      case 'aprovada':  return 'aprovada';
      case 'rejeitada': return 'rejeitada';
      case 'pendente':  return 'pendente';
      default:          return 'na';
    }
  }

  formatarDataTs(ts: any): string {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleDateString('pt-BR');
    } catch { return '—'; }
  }
}
