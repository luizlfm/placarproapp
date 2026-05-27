import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../campeonatos/models/jogador.model';
import { NavBackService } from '../../../shared/nav-back.service';
import {
  TAMANHOS_CARTEIRINHA,
  TamanhoCarteirinha,
  TamanhoCarteirinhaId,
} from '../../../campeonatos/carteirinhas-pdf.service';

interface CartaoView {
  jogador: Jogador;
  equipe?: Equipe;
}

/**
 * Página única de carteirinhas — toolbar com Imprimir + painel de configurações
 * inline (tamanho, nome, subtítulo, organização, escudo, verso, equipes) + preview
 * ao vivo. Imitando o padrão da súmula, mas com todos os controles dentro
 * da tela (sem modal). Imprime via `window.print()` com @media print.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/carteirinhas`
 */
@Component({
  selector: 'app-carteirinhas-preview',
  templateUrl: './carteirinhas-preview.page.html',
  styleUrls: ['./carteirinhas-preview.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class CarteirinhasPreviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly navBack = inject(NavBackService);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';

  // ─── Dados carregados ───
  campeonato?: Campeonato;
  categoria?: Categoria;
  equipes: Equipe[] = [];
  jogadores: Jogador[] = [];
  loading = true;

  // ─── Configurações editáveis pelo usuário ───
  readonly tamanhos = TAMANHOS_CARTEIRINHA;
  tamanhoId: TamanhoCarteirinhaId = 'p1-86x59';
  nomeCampeonato = '';
  subtitulo = '';
  organizacao = '';
  incluirEscudo = true;
  incluirVerso = false;
  endereco = '';
  cidade = '';
  telefone = '';

  /** Mapa equipeId → marcada para impressão. */
  marcadas = new Map<string, boolean>();

  /** Painel lateral aberto/fechado (mobile). */
  painelAberto = true;

  async ngOnInit(): Promise<void> {
    try {
      const [camp, cat, equipes, jogadores] = await Promise.all([
        firstValueFrom(this.campsSrv.get$(this.campeonatoId)),
        firstValueFrom(this.catsSrv.get$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId)),
      ]);
      this.campeonato = camp;
      this.categoria  = cat;
      this.equipes    = [...equipes].sort((a, b) =>
        (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
      );
      this.jogadores = jogadores;

      // Defaults vindos do campeonato/categoria
      this.nomeCampeonato = camp?.titulo ?? '';
      this.subtitulo = cat?.titulo ?? '';
      this.organizacao = camp?.subtitulo ?? '';

      // Por padrão, todas as equipes começam marcadas
      for (const eq of this.equipes) {
        if (eq.id) this.marcadas.set(eq.id, true);
      }
    } catch (err) {
      console.error('[Carteirinhas] erro carregando dados', err);
    } finally {
      this.loading = false;
    }
  }

  /** Toggle de uma equipe na lista. */
  toggleEquipe(eq: Equipe): void {
    if (!eq.id) return;
    this.marcadas.set(eq.id, !this.marcadas.get(eq.id));
  }
  isMarcada(eq: Equipe): boolean {
    return !!(eq.id && this.marcadas.get(eq.id));
  }
  marcarTodas(): void {
    const todasJa = this.equipes.every(e => this.isMarcada(e));
    for (const eq of this.equipes) {
      if (eq.id) this.marcadas.set(eq.id, !todasJa);
    }
  }
  qtdMarcadas(): number {
    return Array.from(this.marcadas.values()).filter(v => v).length;
  }

  /** Tamanho selecionado (objeto completo). */
  get tamanho(): TamanhoCarteirinha {
    return this.tamanhos.find(t => t.id === this.tamanhoId) ?? this.tamanhos[0];
  }
  larguraMm(): number { return this.tamanho.larguraMm; }
  alturaMm(): number  { return this.tamanho.alturaMm; }

  /** Jogadores das equipes marcadas, ordenados (equipe → nome). */
  get cartoes(): CartaoView[] {
    if (this.loading) return [];
    const ids = new Set<string>();
    for (const [k, v] of this.marcadas) if (v) ids.add(k);
    return this.jogadores
      .filter(j => ids.has(j.equipeId))
      .sort((a, b) => {
        const e = a.equipeId.localeCompare(b.equipeId);
        if (e !== 0) return e;
        return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
      })
      .map(j => ({
        jogador: j,
        equipe: this.equipes.find(e => e.id === j.equipeId),
      }));
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'relatorios',
    ]);
  }

  imprimir(): void {
    window.print();
  }

  togglePainel(): void {
    this.painelAberto = !this.painelAberto;
  }

  /** Formata YYYY-MM-DD → DD/MM/YYYY. */
  formatarData(iso?: string | null): string {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  /** Label compacta da equipe pra checkbox. */
  labelEquipe(eq: Equipe): string {
    const cidade = (eq as { cidade?: string }).cidade ?? '';
    return cidade ? `${eq.nome} — ${cidade}` : eq.nome;
  }

  trackByCartao(_i: number, c: CartaoView): string { return c.jogador.id ?? `${_i}`; }
  trackByEquipe(_i: number, e: Equipe): string { return e.id ?? `${_i}`; }
}
