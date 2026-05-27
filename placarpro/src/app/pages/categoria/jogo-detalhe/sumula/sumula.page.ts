import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import {
  ArbitroJogo,
  EventoJogo,
  EventoTipo,
  FuncaoArbitro,
  Jogo,
} from '../../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { dataHoraIsoParaBr } from '../../../../shared/directives/mask.directive';
import { NavBackService } from '../../../../shared/nav-back.service';

interface LinhaEvento {
  tipo: EventoTipo;
  jogadorNome: string;
  equipe: 'mandante' | 'visitante';
  minuto?: number;
  observacao?: string;
  quantidade?: number;
}

interface JogadorEscalado {
  jogador: Jogador;
  amarelos: number;
  vermelhos: number;
  gols: number;
}

interface SumulaView {
  jogo: Jogo;
  campeonato?: Campeonato;
  categoria?: Categoria;
  mandante?: Equipe;
  visitante?: Equipe;
  escMandante: JogadorEscalado[];
  escVisitante: JogadorEscalado[];
  lances: LinhaEvento[];
  arbitros: ArbitroJogo[];
}

const ROTULO_TIPO: Record<EventoTipo, string> = {
  gol: 'Gol',
  'gol-contra': 'Gol contra',
  amarelo: 'Cartão amarelo',
  vermelho: 'Cartão vermelho',
  azul: 'Cartão azul',
  falta: 'Falta',
  defesa: 'Defesa',
  'sub-entrou': 'Substituição (entrou)',
  'sub-saiu': 'Substituição (saiu)',
  'pen-convertido': 'Pênalti convertido',
  'pen-perdido': 'Pênalti perdido',
  'pen-defendido': 'Pênalti defendido',
};

const ROTULO_FUNCAO: Record<FuncaoArbitro, string> = {
  principal: 'Árbitro principal',
  'auxiliar-1': 'Assistente 1',
  'auxiliar-2': 'Assistente 2',
  'quarto-arbitro': '4º árbitro',
  mesario: 'Mesário',
  cronometrista: 'Cronometrista',
};

/**
 * Página de Súmula imprimível.
 *
 * Layout otimizado pra impressão A4 — abre tudo em uma única página com:
 *  - Cabeçalho (campeonato + categoria + fase/rodada + data/local)
 *  - Placar grande no centro
 *  - Escalações de mandante e visitante lado a lado
 *  - Lista de lances ordenada por minuto
 *  - Arbitragem (se houver) + linhas de assinatura
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/jogo/:jogoId/sumula`
 * Use `window.print()` direto na página pra gerar o PDF.
 */
@Component({
  selector: 'app-sumula',
  templateUrl: './sumula.page.html',
  styleUrls: ['./sumula.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class SumulaPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly navBack = inject(NavBackService);

  readonly campeonatoId = this.lerParam('id');
  readonly categoriaId = this.lerParam('catId');
  readonly jogoId = this.lerParam('jogoId');

  readonly ROTULO_TIPO = ROTULO_TIPO;
  readonly ROTULO_FUNCAO = ROTULO_FUNCAO;

  /** Quantidade de linhas fixas pra jogadores em cada equipe (replica modelo). */
  readonly LINHAS_JOGADORES = 19;
  /** Grade numerada de 1 a 26 no rodapé. */
  readonly NUMEROS_13 = Array.from({ length: 13 }, (_, i) => i + 1);

readonly NUMEROS_13_2 = Array.from({ length: 13 }, (_, i) => i + 14);

/* quantidade de linhas vazias */
readonly  COLUNAS_VAZIAS = Array.from({ length: 13 });

  sumula$: Observable<SumulaView | undefined> = of(undefined);

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) {
      console.error('[Sumula] params ausentes');
      return;
    }
    this.sumula$ = this.montarObservable();
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      this.jogoId,
    ]);
  }

  imprimir(): void {
    window.print();
  }

  formatarDataBr(iso?: string | null): string {
    if (!iso) return 'A definir';
    return dataHoraIsoParaBr(iso) || iso;
  }

  /** Extrai só DD/MM/YYYY do datetime ISO. */
  formatarSomenteData(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return iso;
    }
  }

  /** Monta "NOME (CIDADE/UF)" — formato dos times no cabeçalho. */
  nomeCompleto(eq?: Equipe): string {
    if (!eq) return '';
    if (eq.cidade) return `${eq.nome} (${eq.cidade})`;
    return eq.nome;
  }

  /** Junta cidades das duas equipes para a linha "CIDADE". */
  cidadeEquipes(s: SumulaView): string {
    const cm = s.mandante?.cidade;
    const cv = s.visitante?.cidade;
    if (cm && cv && cm !== cv) return `${cm} / ${cv}`;
    return cm || cv || '';
  }

  /** Acha o árbitro de uma função específica e retorna só o nome. */
  arbitroPor(funcao: FuncaoArbitro, arbitros: ArbitroJogo[]): string {
    return arbitros.find(a => a.funcao === funcao)?.nome ?? '';
  }

  /**
   * Garante N linhas na tabela de jogadores (mesmo que o time tenha menos).
   * Replica o modelo impresso que sempre mostra ~19 linhas pra escrita manual.
   */
  preencherLinhas(
    escalados: JogadorEscalado[],
    quantidade: number,
  ): (JogadorEscalado | undefined)[] {
    const out: (JogadorEscalado | undefined)[] = [...escalados];
    while (out.length < quantidade) out.push(undefined);
    return out.slice(0, Math.max(quantidade, out.length));
  }

  /**
   * Calcula quantas linhas mostrar em CADA tabela — usa o máximo entre as duas
   * equipes (pra que ambas fiquem com a mesma altura) ou LINHAS_JOGADORES (19)
   * como mínimo. Garante que as separações horizontais fluem alinhadas dos
   * dois lados.
   */
  linhasParaAmbas(s: SumulaView): number {
    return Math.max(
      this.LINHAS_JOGADORES,
      s.escMandante?.length ?? 0,
      s.escVisitante?.length ?? 0,
    );
  }

  private montarObservable(): Observable<SumulaView | undefined> {
    const campeonato$ = this.campsSrv.get$(this.campeonatoId).pipe(catchError(() => of(undefined)));
    const categoria$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));
    const jogo$ = this.jogosSrv
      .get$(this.campeonatoId, this.categoriaId, this.jogoId)
      .pipe(catchError(() => of(undefined)));
    const equipes$ = this.equipesSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Equipe[]>([]), catchError(() => of<Equipe[]>([])));
    const jogadores$ = this.jogadoresSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Jogador[]>([]), catchError(() => of<Jogador[]>([])));
    const eventos$ = this.jogosSrv
      .listEventos$(this.campeonatoId, this.categoriaId, this.jogoId)
      .pipe(startWith<EventoJogo[]>([]), catchError(() => of<EventoJogo[]>([])));

    return combineLatest([campeonato$, categoria$, jogo$, equipes$, jogadores$, eventos$]).pipe(
      map(([camp, cat, jogo, equipes, jogadores, eventos]) => {
        if (!jogo) return undefined;
        const m = equipes.find(e => e.id === jogo.mandanteId);
        const v = equipes.find(e => e.id === jogo.visitanteId);

        // Lances ordenados por minuto (lances sem minuto vão pro fim)
        const lances: LinhaEvento[] = eventos
          .map(ev => ({
            tipo: ev.tipo,
            jogadorNome:
              jogadores.find(j => j.id === ev.jogadorId)?.nome ?? '(sem jogador)',
            equipe: (ev.equipeId === jogo.mandanteId ? 'mandante' : 'visitante') as
              | 'mandante'
              | 'visitante',
            minuto: ev.minuto,
            observacao: ev.observacao,
            quantidade: ev.quantidade,
          }))
          .sort((a, b) => (a.minuto ?? 999) - (b.minuto ?? 999));

        // Escalações com contagem de gols/amarelos/vermelhos
        const escMandante = this.montarEscalados(jogadores, eventos, jogo.mandanteId);
        const escVisitante = this.montarEscalados(jogadores, eventos, jogo.visitanteId);

        return {
          jogo,
          campeonato: camp,
          categoria: cat,
          mandante: m,
          visitante: v,
          escMandante,
          escVisitante,
          lances,
          arbitros: jogo.arbitros ?? [],
        };
      }),
    );
  }

  private montarEscalados(
    jogadores: Jogador[],
    eventos: EventoJogo[],
    equipeId: string,
  ): JogadorEscalado[] {
    const ids = jogadores.filter(j => j.equipeId === equipeId).map(j => j.id!);
    return ids
      .map(id => jogadores.find(j => j.id === id))
      .filter((j): j is Jogador => !!j)
      .map(j => {
        const meus = eventos.filter(e => e.jogadorId === j.id && e.equipeId === equipeId);
        return {
          jogador: j,
          gols: meus
            .filter(e => e.tipo === 'gol')
            .reduce((s, e) => s + (e.quantidade ?? 1), 0),
          amarelos: meus.filter(e => e.tipo === 'amarelo').length,
          vermelhos: meus.filter(e => e.tipo === 'vermelho').length,
        };
      })
      .sort((a, b) => (a.jogador.nome ?? '').localeCompare(b.jogador.nome ?? '', 'pt-BR'));
  }

  private lerParam(name: string): string {
    let cursor: ActivatedRoute | null = this.route;
    while (cursor) {
      const v = cursor.snapshot.paramMap.get(name);
      if (v) return v;
      cursor = cursor.parent;
    }
    return '';
  }

  rotuloStatus(s: string): string {
    switch (s) {
      case 'encerrado': return 'Encerrada';
      case 'em-andamento': return 'Em andamento';
      case 'agendado': return 'Agendada';
      case 'cancelado': return 'Cancelada';
      case 'wo': return 'W.O.';
      default: return s;
    }
  }
}
