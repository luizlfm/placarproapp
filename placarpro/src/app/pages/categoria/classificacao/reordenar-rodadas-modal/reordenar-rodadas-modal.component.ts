import { Component, Input, OnInit, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Fase } from '../../../../campeonatos/models/fase.model';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../../campeonatos/jogos.service';

interface RodadaItem {
  /** Numeração original (antes da reordenação). */
  original: number;
  /** Numeração atual na ordem em memória. */
  novo: number;
  qtdJogos: number;
}

@Component({
  selector: 'app-reordenar-rodadas-modal',
  templateUrl: './reordenar-rodadas-modal.component.html',
  styleUrls: ['./reordenar-rodadas-modal.component.scss'],
  standalone: false,
})
export class ReordenarRodadasModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() fase!: Fase;

  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  itens: RodadaItem[] = [];
  carregando = true;
  loading = false;

  private jogosDaFase: Jogo[] = [];

  async ngOnInit(): Promise<void> {
    const todos = await firstValueFrom(
      this.jogosSrv.list$(this.campeonatoId, this.categoriaId),
    );
    this.jogosDaFase = todos.filter(j => !j.fase || j.fase === this.fase.nome);
    const mapa = new Map<number, number>();
    this.jogosDaFase.forEach(j => {
      const r = j.rodada ?? 0;
      if (r > 0) mapa.set(r, (mapa.get(r) ?? 0) + 1);
    });
    this.itens = Array.from(mapa.entries())
      .sort(([a], [b]) => a - b)
      .map(([original, qtd]) => ({ original, novo: original, qtdJogos: qtd }));
    this.carregando = false;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  mover(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= this.itens.length) return;
    [this.itens[i], this.itens[j]] = [this.itens[j], this.itens[i]];
    this.recalcularNumeros();
  }

  private recalcularNumeros(): void {
    this.itens.forEach((it, idx) => (it.novo = idx + 1));
  }

  get temMudancas(): boolean {
    return this.itens.some(it => it.novo !== it.original);
  }

  async salvar(): Promise<void> {
    if (!this.temMudancas) {
      await this.toast('Nenhuma mudança para salvar.', 'danger');
      return;
    }
    this.loading = true;
    const loader = await this.loadingCtrl.create({
      message: 'Renumerando rodadas...',
    });
    await loader.present();
    try {
      // Estratégia em 2 passos pra evitar colisão de números:
      // 1) Move tudo pra rodada negativa (-original)
      // 2) Move da negativa pra "novo"
      const mapaNovo = new Map(this.itens.map(it => [it.original, it.novo]));

      for (const j of this.jogosDaFase) {
        const orig = j.rodada;
        if (orig == null || orig <= 0) continue;
        if (!mapaNovo.has(orig)) continue;
        await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, j.id!, {
          rodada: -orig,
        });
      }
      for (const j of this.jogosDaFase) {
        const orig = j.rodada;
        if (orig == null) continue;
        const original = Math.abs(orig);
        const novo = mapaNovo.get(original);
        if (novo != null) {
          await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, j.id!, {
            rodada: novo,
          });
        }
      }
      await this.toast('Rodadas reordenadas.', 'success');
      await this.modalCtrl.dismiss({ reordered: true });
    } catch (err) {
      console.error('[ReordenarRodadas] erro', err);
      await this.toast('Erro ao reordenar.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  trackByOriginal(_i: number, it: RodadaItem): number {
    return it.original;
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'bottom',
      color,
    });
    await t.present();
  }
}
