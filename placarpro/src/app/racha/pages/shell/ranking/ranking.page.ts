import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { RachaJogador } from '../../../models/racha.model';

/** Categoria do ranking — espelha o sidebar do FutBora. */
interface CategoriaRanking {
  id: string;
  label: string;
  icon: string;
  /** Cor de destaque do ícone (Ionic color OU hex). */
  cor: string;
  /** Tipo do ranking (individual ou time). */
  tipo: 'individual' | 'time';
  /** Subtítulo exibido no header da categoria. */
  subtitulo: string;
}

/**
 * Página RANKING — 9 categorias (artilheiros, assistência, etc.) em
 * sidebar vertical. Os dados reais virão de subcoleção `partidas` quando
 * implementarmos. Por enquanto mostra a estrutura + lista de jogadores
 * pré-cadastrados ordenados por critério aplicável (notaGeral).
 */
@Component({
  selector: 'app-racha-ranking',
  templateUrl: './ranking.page.html',
  styleUrls: ['./ranking.page.scss'],
  standalone: false,
})
export class RachaRankingPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  rachaId = '';
  loading = true;
  jogadores: RachaJogador[] = [];

  /** Categorias laterais do ranking. */
  readonly categorias: CategoriaRanking[] = [
    { id: 'artilheiros',  label: 'ARTILHEIROS',  icon: 'football',          cor: '#f5c518', tipo: 'individual', subtitulo: 'Artilheiro' },
    { id: 'assistencia',  label: 'ASSISTÊNCIA',  icon: 'paw-outline',       cor: '#16a34a', tipo: 'individual', subtitulo: 'Assistente' },
    { id: 'xerifao',      label: 'XERIFÃO',      icon: 'star',              cor: '#f59e0b', tipo: 'individual', subtitulo: 'Xerifão (MVP)' },
    { id: 'goleiro',      label: 'GOLEIRO',      icon: 'hand-left-outline', cor: '#3b82f6', tipo: 'individual', subtitulo: 'Goleiro (menos gols sofridos)' },
    { id: 'times',        label: 'TIMES',        icon: 'shield',            cor: '#1d4ed8', tipo: 'time',       subtitulo: 'Ranking de times' },
    { id: 'campeao',      label: 'CAMPEÃO',      icon: 'ribbon',            cor: '#f59e0b', tipo: 'individual', subtitulo: 'Campeão (mais vitórias)' },
    { id: 'fominha',      label: 'FOMINHA',      icon: 'calendar',          cor: '#ef4444', tipo: 'individual', subtitulo: 'Fominha (mais presenças)' },
    { id: 'reiPontos',    label: 'REI PONTOS',   icon: 'people-circle',     cor: '#7CC61D', tipo: 'individual', subtitulo: 'Rei dos Pontos' },
    { id: 'menosVazado',  label: 'MENOS VAZADO', icon: 'shield-half-outline', cor: '#f59e0b', tipo: 'individual', subtitulo: 'Menos Vazado' },
  ];

  categoriaAtiva: CategoriaRanking = this.categorias[0];

  /** Período do filtro (anos disponíveis — placeholder). */
  filtroAno = String(new Date().getFullYear());
  filtroAberto = false;

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.sub = this.rachaSrv.listJogadores$(this.rachaId).pipe(
      startWith([] as RachaJogador[]),
      catchError(err => { console.error('[Ranking] jogadores', err); return of([] as RachaJogador[]); }),
    ).subscribe(arr => {
      this.jogadores = arr.filter(j => j.ativo !== false);
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  selecionarCategoria(c: CategoriaRanking): void {
    this.categoriaAtiva = c;
  }

  /** Lista de jogadores pra categoria atual (mock por enquanto). */
  get jogadoresRanking(): RachaJogador[] {
    // TODO: quando tivermos partidas/eventos, calcular gols/assists/etc.
    // Por enquanto ordenamos por notaGeral como proxy.
    return [...this.jogadores]
      .sort((a, b) => (b.notaGeral ?? 0) - (a.notaGeral ?? 0))
      .slice(0, 50);
  }

  get qtdJogadores(): number {
    return this.jogadoresRanking.length;
  }

  compartilhar(): void {
    const linhas = [`🏆 *${this.categoriaAtiva.subtitulo} — Ranking*`, ''];
    this.jogadoresRanking.slice(0, 10).forEach((j, i) => {
      linhas.push(`${i + 1}. ${j.apelido || j.nome} — Nota ${j.notaGeral ?? '—'}`);
    });
    navigator.clipboard?.writeText(linhas.join('\n')).then(
      () => this.toast('Ranking copiado!', 'success'),
      () => this.toast('Falha ao copiar.', 'danger'),
    );
  }

  irParaRankingMundial(): void {
    this.router.navigate(['/racha', this.rachaId, 'ranking-mundial']);
  }

  toggleFiltro(): void {
    this.filtroAberto = !this.filtroAberto;
  }

  inicial(j: RachaJogador): string {
    return (j.apelido?.charAt(0) || j.nome?.charAt(0) || '?').toUpperCase();
  }

  trackByCategoria(_i: number, c: CategoriaRanking): string {
    return c.id;
  }
  trackByJogador(_i: number, j: RachaJogador): string {
    return j.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'top', color });
    await t.present();
  }
  /** Volta pra tela anterior usando histórico do browser; fallback pra
   *  home do racha quando entrou direto via URL. */
  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}