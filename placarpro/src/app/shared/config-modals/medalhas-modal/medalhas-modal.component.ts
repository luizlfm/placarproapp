import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { firstValueFrom } from 'rxjs';

interface MedalhaCategoria {
  categoriaId: string;
  categoriaTitulo: string;
  /** IDs das equipes — `null` quando ainda não definido. */
  ouro?: string | null;
  prata?: string | null;
  bronze?: string | null;
  /** Equipes daquela categoria para o select. */
  equipes: Equipe[];
}

interface RankingEquipe {
  equipe: Equipe;
  ouros: number;
  pratas: number;
  bronzes: number;
  total: number;
}

/**
 * Modal de Quadro de Medalhas. Permite ao admin definir manualmente o pódio
 * (ouro/prata/bronze) de cada categoria. Em seguida agrega tudo num ranking
 * por equipe (similar às Olimpíadas).
 *
 * Diferente de classificação que é calculada — aqui é declarativo, porque
 * o organizador define "quem ficou em 1º/2º/3º na fase final" e isso pode
 * envolver critérios subjetivos (saldo de gols, confrontos diretos, etc.).
 */
@Component({
  selector: 'app-medalhas-modal',
  templateUrl: './medalhas-modal.component.html',
  styleUrls: ['./medalhas-modal.component.scss'],
  standalone: false,
})
export class MedalhasModalComponent implements OnInit {
  @Input() campeonatoId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly catSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly toastCtrl = inject(ToastController);

  /** Medalhas configuradas por categoria. */
  medalhas: MedalhaCategoria[] = [];
  /** Ranking agregado por equipe (computado). */
  ranking: RankingEquipe[] = [];

  loading = true;
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    try {
      // 1. Carrega categorias
      const categorias = await firstValueFrom(this.catSrv.list$(this.campeonatoId));
      // 2. Carrega o doc do campeonato pra pegar as medalhas já salvas
      const camp = await firstValueFrom(this.campSrv.get$(this.campeonatoId));
      const salvas = ((camp as { medalhas?: MedalhaCategoria[] } | undefined)?.medalhas) ?? [];
      // 3. Para cada categoria, carrega as equipes e monta o objeto.
      this.medalhas = await Promise.all(
        categorias.map(async (cat: Categoria) => {
          const equipes = await firstValueFrom(
            this.equipesSrv.list$(this.campeonatoId, cat.id!),
          );
          const ja = salvas.find(m => m.categoriaId === cat.id);
          return {
            categoriaId: cat.id!,
            categoriaTitulo: cat.titulo,
            ouro: ja?.ouro ?? null,
            prata: ja?.prata ?? null,
            bronze: ja?.bronze ?? null,
            equipes,
          };
        }),
      );
      this.recalcularRanking();
    } catch (err) {
      console.warn('[Medalhas] load erro', err);
    } finally {
      this.loading = false;
    }
  }

  setOuro(idx: number, valor: string): void {
    if (this.medalhas[idx]) {
      this.medalhas[idx] = { ...this.medalhas[idx], ouro: valor || null };
      this.recalcularRanking();
    }
  }
  setPrata(idx: number, valor: string): void {
    if (this.medalhas[idx]) {
      this.medalhas[idx] = { ...this.medalhas[idx], prata: valor || null };
      this.recalcularRanking();
    }
  }
  setBronze(idx: number, valor: string): void {
    if (this.medalhas[idx]) {
      this.medalhas[idx] = { ...this.medalhas[idx], bronze: valor || null };
      this.recalcularRanking();
    }
  }

  /**
   * Recalcula o ranking somando medalhas por equipe.
   * Ordena: mais ouros → mais pratas → mais bronzes → ordem alfabética.
   */
  private recalcularRanking(): void {
    const mapa = new Map<string, RankingEquipe>();
    for (const cat of this.medalhas) {
      const adicionar = (eqId: string | null | undefined, tipo: 'ouro' | 'prata' | 'bronze') => {
        if (!eqId) return;
        const eq = cat.equipes.find(e => e.id === eqId);
        if (!eq) return;
        let r = mapa.get(eqId);
        if (!r) {
          r = { equipe: eq, ouros: 0, pratas: 0, bronzes: 0, total: 0 };
          mapa.set(eqId, r);
        }
        if (tipo === 'ouro')   r.ouros++;
        if (tipo === 'prata')  r.pratas++;
        if (tipo === 'bronze') r.bronzes++;
        r.total = r.ouros + r.pratas + r.bronzes;
      };
      adicionar(cat.ouro, 'ouro');
      adicionar(cat.prata, 'prata');
      adicionar(cat.bronze, 'bronze');
    }
    this.ranking = Array.from(mapa.values()).sort((a, b) => {
      if (a.ouros !== b.ouros) return b.ouros - a.ouros;
      if (a.pratas !== b.pratas) return b.pratas - a.pratas;
      if (a.bronzes !== b.bronzes) return b.bronzes - a.bronzes;
      return a.equipe.nome.localeCompare(b.equipe.nome);
    });
  }

  async salvar(): Promise<void> {
    // Persiste no campeonato como `medalhas` (não tipado no model — usa cast).
    const payload = this.medalhas.map(m => ({
      categoriaId: m.categoriaId,
      categoriaTitulo: m.categoriaTitulo,
      ouro: m.ouro ?? null,
      prata: m.prata ?? null,
      bronze: m.bronze ?? null,
    }));
    this.salvando = true;
    try {
      await this.campSrv.atualizar(this.campeonatoId, { medalhas: payload } as never);
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Medalhas] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackByCat(_i: number, m: MedalhaCategoria): string { return m.categoriaId; }
  trackByRanking(_i: number, r: RankingEquipe): string { return r.equipe.id ?? ''; }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
