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
/** Jogador espalhado aleatoriamente (quando não há posições definidas). */
interface AleatorioItem {
  id: string;
  nome: string;
  numero: string;
  top: number;  // % vertical
  left: number; // % horizontal
}
interface CampoVM {
  /** 'formacao' = tem posições; 'aleatorio' = ninguém tem posição. */
  modo: 'formacao' | 'aleatorio';
  /** Linhas do campo (topo->base: ATA, MEI, DEF, GOL) — modo formação. */
  linhas: LinhaCampo[];
  /** Jogadores espalhados — modo aleatório. */
  aleatorios: AleatorioItem[];
  /** True quando nenhum jogador tem posição (mostra aviso). */
  semPosicoes: boolean;
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

  private readonly vmVazio: CampoVM = { modo: 'formacao', linhas: [], aleatorios: [], semPosicoes: false };

  vm$: Observable<CampoVM> = of(this.vmVazio);

  onSelecionar(j: JogadorCampo): void {
    if (!this.editavel || !j.id) return;
    this.selecionarJogador.emit({ id: j.id, nome: j.nome, numero: j.numero, posicao: j.posicao });
  }

  ngOnChanges(): void {
    if (!this.campeonatoId || !this.categoriaId || !this.jogoId || !this.equipeId) {
      this.vm$ = of(this.vmVazio);
      return;
    }
    const esc$ = this.jogosSrv.escalacao$(
      this.campeonatoId, this.categoriaId, this.jogoId, this.equipeId,
    );
    const jog$ = this.jogadoresSrv.listPorEquipeSemIndex$(
      this.campeonatoId, this.categoriaId, this.equipeId,
    );
    const tit$ = this.jogosSrv.titulares$(
      this.campeonatoId, this.categoriaId, this.jogoId, this.equipeId,
    );
    this.vm$ = combineLatest([esc$, jog$, tit$]).pipe(
      map(([esc, jogadores, titulares]) => {
        const ids = (esc ?? []) as string[];
        if (!ids.length) return this.vmVazio;
        // Se há titulares marcados, exibe SÓ eles; senão, todos (fallback).
        const titIds = (titulares ?? []) as string[];
        const soTitulares = titIds.length ? ids.filter(id => titIds.includes(id)) : [];
        const exibir = soTitulares.length ? soTitulares : ids;
        const byId = new Map(jogadores.map(j => [j.id ?? '', j]));
        const escalados = exibir
          .map(id => byId.get(id))
          .filter((j): j is Jogador => !!j);
        return this.montar(escalados);
      }),
    );
  }

  // ─── Internos ────────────────────────────────────────────────────────────

  private montar(escalados: Jogador[]): CampoVM {
    // Se NINGUÉM tem posição → não dá pra montar formação: espalha aleatório
    // (posição estável por jogador, sem ficar pulando a cada render) e avisa.
    const temAlgumaPosicao = escalados.some(j => this.norm(j.posicao) !== '');
    if (!temAlgumaPosicao) {
      // Sem posições definidas: arruma numa GRADE organizada (linhas iguais,
      // distribuídas pelo campo) em vez de espalhar aleatório (que sobrepunha
      // e ficava bagunçado). Continua mostrando o aviso "sem posições".
      return { modo: 'formacao', linhas: this.montarGrade(escalados), aleatorios: [], semPosicoes: true };
    }
    return { modo: 'formacao', linhas: this.montarLinhas(escalados), aleatorios: [], semPosicoes: false };
  }

  /** Distribui os jogadores numa grade equilibrada (sem posições): nº de
   *  colunas ≈ raiz quadrada do total, chunk por linha. Reusa o layout de
   *  linhas (space-evenly) — organizado e sem sobreposição. */
  private montarGrade(jogadores: Jogador[]): LinhaCampo[] {
    const n = jogadores.length;
    if (!n) return [];
    const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(n))));
    const linhas: LinhaCampo[] = [];
    for (let i = 0; i < n; i += cols) {
      linhas.push({
        jogadores: jogadores.slice(i, i + cols).map(j => ({
          id: j.id ?? '',
          nome: this.primeiroNome(j),
          numero: (j.numeroCamisa ?? '').toString().trim(),
          posicao: '',
          posicaoLabel: '',
        })),
      });
    }
    return linhas;
  }

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
