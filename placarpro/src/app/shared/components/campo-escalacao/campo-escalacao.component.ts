import { Component, EventEmitter, Input, OnChanges, Output, inject } from '@angular/core';
import { Observable, combineLatest, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { JogosService } from '../../../campeonatos/jogos.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { Jogador } from '../../../campeonatos/models/jogador.model';

/** Jogador selecionado no campo (pra editar número/posição). */
export interface JogadorSelecionado {
  id: string;
  nome: string;
  numero: string;
  posicao: string;
}

interface JogadorCampo {
  id: string;
  nome: string;
  numero: string;
  posicao: string;
  posicaoLabel: string;
}
interface LinhaCampo {
  jogadores: JogadorCampo[];
}
interface CampoVM {
  /** Linhas do campo (topo->base: ATA, MEI, DEF, GOL). */
  linhas: LinhaCampo[];
  /** Lista plana pra coluna de nomes (ordem natural: GOL -> ATA). */
  lista: JogadorCampo[];
}

type Setor = 'GOL' | 'DEF' | 'MEI' | 'ATA';

/**
 * Campo de futebol read-only que desenha a escalação de UMA equipe num jogo,
 * estilo "monte sua escalação": camisas com número + posição + nome.
 *
 * v1 — posicionamento AUTOMÁTICO: classifica cada jogador escalado pela
 * `posicao` cadastrada (goleiro/zagueiro/lateral/meia/ponta/atacante) em 4
 * setores (GOL/DEF/MEI/ATA) e distribui em linhas (atacantes no topo, goleiro
 * embaixo — como na arte). Sem formação fixa: o nº de jogadores por linha
 * sai dos dados.
 *
 * Autocontido: recebe só os IDs e faz a própria leitura (`escalacao$` +
 * `listPorEquipeSemIndex$`) — assim as páginas hospedeiras só inserem a tag.
 * `posicao`/`numeroCamisa` NÃO são PII (continuam públicos após a migração),
 * então funciona na página pública.
 */
@Component({
  selector: 'app-campo-escalacao',
  templateUrl: './campo-escalacao.component.html',
  styleUrls: ['./campo-escalacao.component.scss'],
  standalone: false,
})
export class CampoEscalacaoComponent implements OnChanges {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  @Input() equipeId = '';
  @Input() nomeEquipe = '';
  /** Quando true, as camisas viram botões clicáveis (editar número/posição). */
  @Input() editavel = false;
  /** Emite o jogador clicado quando `editavel`. */
  @Output() selecionarJogador = new EventEmitter<JogadorSelecionado>();

  private readonly jogosSrv = inject(JogosService);
  private readonly jogadoresSrv = inject(JogadoresService);

  vm$: Observable<CampoVM> = of({ linhas: [], lista: [] });

  onSelecionar(j: JogadorCampo): void {
    if (!this.editavel || !j.id) return;
    this.selecionarJogador.emit({ id: j.id, nome: j.nome, numero: j.numero, posicao: j.posicao });
  }

  ngOnChanges(): void {
    if (!this.campeonatoId || !this.categoriaId || !this.jogoId || !this.equipeId) {
      this.vm$ = of({ linhas: [], lista: [] });
      return;
    }
    const esc$ = this.jogosSrv.escalacao$(
      this.campeonatoId, this.categoriaId, this.jogoId, this.equipeId,
    );
    const jog$ = this.jogadoresSrv.listPorEquipeSemIndex$(
      this.campeonatoId, this.categoriaId, this.equipeId,
    );
    this.vm$ = combineLatest([esc$, jog$]).pipe(
      map(([esc, jogadores]) => {
        const ids = (esc ?? []) as string[];
        if (!ids.length) return { linhas: [], lista: [] } as CampoVM;
        const byId = new Map(jogadores.map(j => [j.id ?? '', j]));
        const escalados = ids
          .map(id => byId.get(id))
          .filter((j): j is Jogador => !!j);
        const linhas = this.montarLinhas(escalados);
        // Lista plana em ordem natural (goleiro primeiro): inverte as linhas.
        const lista = linhas.slice().reverse().flatMap(l => l.jogadores);
        return { linhas, lista };
      }),
    );
  }

  // ─── Internos ────────────────────────────────────────────────────────────

  private montarLinhas(jogadores: Jogador[]): LinhaCampo[] {
    const setores: Record<Setor, Jogador[]> = { GOL: [], DEF: [], MEI: [], ATA: [] };
    for (const j of jogadores) setores[this.classificar(j.posicao)].push(j);

    // Ordena cada linha por lado: esquerda -> centro -> direita.
    const ordenar = (arr: Jogador[]) =>
      arr.slice().sort((a, b) => this.ladoPeso(a.posicao) - this.ladoPeso(b.posicao));

    // Topo -> base: atacantes em cima, goleiro embaixo (como na arte).
    return (['ATA', 'MEI', 'DEF', 'GOL'] as Setor[])
      .map(setor => ({
        jogadores: ordenar(setores[setor]).map(j => ({
          id: j.id ?? '',
          nome: this.primeiroNome(j),
          numero: (j.numeroCamisa ?? '').toString().trim(),
          posicao: (j.posicao ?? '').trim(),
          posicaoLabel: (j.posicao ?? '').toUpperCase().trim(),
        })),
      }))
      .filter(linha => linha.jogadores.length > 0);
  }

  private classificar(pos?: string): Setor {
    const p = this.norm(pos);
    if (!p) return 'MEI';
    if (p.includes('golei') || p === 'gol' || p.includes('goleir')) return 'GOL';
    if (
      p.includes('zagu') || p.includes('zaga') || p.includes('lateral') ||
      p.includes('defens') || p.includes('beque') || p.includes('ala') || p.includes('fixo')
    ) return 'DEF';
    if (
      p.includes('atac') || p.includes('ponta') || p.includes('centroavante') ||
      p.includes('avante') || p.includes('extrem') || p.includes('artilh') || p.includes('pivo')
    ) return 'ATA';
    if (
      p.includes('volant') || p.includes('meia') || p.includes('meio') ||
      p.includes('armad') || p.includes('cabeca')
    ) return 'MEI';
    return 'MEI';
  }

  /** esquerda = 0, centro = 1, direita = 2 (pra ordenar a linha). */
  private ladoPeso(pos?: string): number {
    const p = this.norm(pos);
    if (p.includes('esquerd')) return 0;
    if (p.includes('direit')) return 2;
    return 1;
  }

  private primeiroNome(j: Jogador): string {
    return (j.apelido?.trim() || j.nome?.trim() || '').split(/\s+/)[0] ?? '';
  }

  private norm(s?: string): string {
    return (s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }
}
