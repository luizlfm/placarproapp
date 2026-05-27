import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogosService } from '../../../campeonatos/jogos.service';

interface LinhaJogo {
  jogo: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  dataBr: string;
}

interface GrupoFase {
  fase: string;
  linhas: LinhaJogo[];
}

/**
 * Modal pra escolher uma OU VÁRIAS partidas pra imprimir súmula.
 * - Toque no card: alterna seleção
 * - Botão "Selecionar todas" / "Limpar"
 * - Botão "Imprimir N súmulas" no rodapé
 *
 * Retorna `{ jogoIds: string[] }` no dismiss. Se for 1 só, abre a súmula
 * direto; se for múltiplos, o caller decide (ex: abrir cada uma em nova aba).
 */
@Component({
  selector: 'app-escolher-jogo-sumula-modal',
  templateUrl: './escolher-jogo-sumula-modal.component.html',
  styleUrls: ['./escolher-jogo-sumula-modal.component.scss'],
  standalone: false,
})
export class EscolherJogoSumulaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);

  grupos$: Observable<GrupoFase[]> = of([]);
  busca = '';

  /** IDs das partidas selecionadas (Set pra lookup rápido). */
  selecionadas = new Set<string>();

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) return;
    const jogos$ = this.jogosSrv.list$(this.campeonatoId, this.categoriaId).pipe(
      startWith<Jogo[]>([]),
      catchError(() => of<Jogo[]>([])),
    );
    const equipes$ = this.equipesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
      startWith<Equipe[]>([]),
      catchError(() => of<Equipe[]>([])),
    );

    this.grupos$ = combineLatest([jogos$, equipes$]).pipe(
      map(([jogos, equipes]) => {
        const eqMap = new Map<string, Equipe>();
        equipes.forEach(e => e.id && eqMap.set(e.id, e));

        const linhas: LinhaJogo[] = jogos.map(j => ({
          jogo: j,
          mandante: j.mandanteId ? eqMap.get(j.mandanteId) : undefined,
          visitante: j.visitanteId ? eqMap.get(j.visitanteId) : undefined,
          dataBr: j.dataHora
            ? j.dataHora.slice(0, 10).split('-').reverse().join('/')
            : '',
        }));

        linhas.sort((a, b) => {
          const da = a.jogo.dataHora || '￿';
          const db = b.jogo.dataHora || '￿';
          return da.localeCompare(db);
        });

        const mapa = new Map<string, LinhaJogo[]>();
        for (const l of linhas) {
          const fase = l.jogo.fase || 'Sem fase';
          if (!mapa.has(fase)) mapa.set(fase, []);
          mapa.get(fase)!.push(l);
        }
        return Array.from(mapa.entries()).map(([fase, ls]) => ({ fase, linhas: ls }));
      }),
    );
  }

  /** Filtra grupos pelo termo de busca (nome das equipes ou fase). */
  filtrar(grupos: GrupoFase[]): GrupoFase[] {
    const t = this.busca.trim().toLowerCase();
    if (!t) return grupos;
    return grupos
      .map(g => ({
        fase: g.fase,
        linhas: g.linhas.filter(l =>
          (l.mandante?.nome ?? '').toLowerCase().includes(t) ||
          (l.visitante?.nome ?? '').toLowerCase().includes(t) ||
          g.fase.toLowerCase().includes(t),
        ),
      }))
      .filter(g => g.linhas.length > 0);
  }

  /** Toggle de seleção pra uma partida. */
  toggle(jogoId?: string): void {
    if (!jogoId) return;
    if (this.selecionadas.has(jogoId)) {
      this.selecionadas.delete(jogoId);
    } else {
      this.selecionadas.add(jogoId);
    }
  }

  isSelecionada(jogoId?: string): boolean {
    return !!jogoId && this.selecionadas.has(jogoId);
  }

  /** Conta quantas partidas estão selecionadas. */
  get qtdSelecionadas(): number {
    return this.selecionadas.size;
  }

  /** Marca todas as partidas visíveis (depois do filtro de busca) como selecionadas. */
  selecionarTodas(grupos: GrupoFase[]): void {
    for (const g of grupos) {
      for (const l of g.linhas) {
        if (l.jogo.id) this.selecionadas.add(l.jogo.id);
      }
    }
  }

  /** Limpa todas as seleções. */
  limparSelecao(): void {
    this.selecionadas.clear();
  }

  /** Confirma e devolve as IDs selecionadas pro caller. */
  async confirmar(): Promise<void> {
    if (this.selecionadas.size === 0) return;
    const jogoIds = Array.from(this.selecionadas);
    await this.modalCtrl.dismiss({ jogoIds });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackByGrupo(_i: number, g: GrupoFase): string {
    return g.fase;
  }
  trackByLinha(_i: number, l: LinhaJogo): string {
    return l.jogo.id ?? `${_i}`;
  }
}
