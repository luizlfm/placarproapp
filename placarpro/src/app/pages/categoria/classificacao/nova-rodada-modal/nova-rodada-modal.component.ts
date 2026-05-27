import { Component, Input, OnInit, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Fase } from '../../../../campeonatos/models/fase.model';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { JogosService } from '../../../../campeonatos/jogos.service';

interface ConfrontoRow {
  mandanteId: string;
  visitanteId: string;
  dataHora?: string;
  local?: string;
}

@Component({
  selector: 'app-nova-rodada-modal',
  templateUrl: './nova-rodada-modal.component.html',
  styleUrls: ['./nova-rodada-modal.component.scss'],
  standalone: false,
})
export class NovaRodadaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() fase!: Fase;
  /** Sugestão da próxima rodada. Calculado a partir dos jogos da fase. */
  @Input() proximaRodada = 1;

  private readonly equipesSrv = inject(EquipesService);
  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  equipes: Equipe[] = [];
  rodada = 1;
  confrontos: ConfrontoRow[] = [];
  loading = false;
  carregando = true;

  async ngOnInit(): Promise<void> {
    this.rodada = this.proximaRodada;
    this.equipes = await firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId));
    // Sugestão inicial: emparelhar 1ª×2ª, 3ª×4ª, etc.
    const pares = Math.floor(this.equipes.length / 2);
    for (let i = 0; i < pares; i++) {
      this.confrontos.push({
        mandanteId: this.equipes[i * 2]?.id ?? '',
        visitanteId: this.equipes[i * 2 + 1]?.id ?? '',
      });
    }
    if (this.confrontos.length === 0 && this.equipes.length >= 2) {
      this.confrontos.push({
        mandanteId: this.equipes[0].id!,
        visitanteId: this.equipes[1].id!,
      });
    }
    this.carregando = false;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  adicionarConfronto(): void {
    const usados = new Set<string>();
    this.confrontos.forEach(c => {
      if (c.mandanteId) usados.add(c.mandanteId);
      if (c.visitanteId) usados.add(c.visitanteId);
    });
    const livres = this.equipes.filter(e => !usados.has(e.id!));
    this.confrontos.push({
      mandanteId: livres[0]?.id ?? '',
      visitanteId: livres[1]?.id ?? '',
    });
  }

  removerConfronto(i: number): void {
    this.confrontos.splice(i, 1);
  }

  get totalValidos(): number {
    return this.confrontos.filter(
      c => c.mandanteId && c.visitanteId && c.mandanteId !== c.visitanteId,
    ).length;
  }

  trocarLados(c: ConfrontoRow): void {
    [c.mandanteId, c.visitanteId] = [c.visitanteId, c.mandanteId];
  }

  async confirmar(): Promise<void> {
    const validos = this.confrontos.filter(
      c => c.mandanteId && c.visitanteId && c.mandanteId !== c.visitanteId,
    );
    if (validos.length === 0) {
      await this.toast('Adicione pelo menos um confronto válido.', 'danger');
      return;
    }
    this.loading = true;
    const loader = await this.loadingCtrl.create({
      message: `Criando ${validos.length} jogo(s)...`,
    });
    await loader.present();
    try {
      for (const c of validos) {
        const input: Partial<Jogo> = {
          mandanteId: c.mandanteId,
          visitanteId: c.visitanteId,
          rodada: this.rodada,
          fase: this.fase.nome,
        };
        if (c.dataHora) input.dataHora = c.dataHora;
        if (c.local) input.local = c.local;
        await this.jogosSrv.criar(
          this.campeonatoId,
          this.categoriaId,
          input as { mandanteId: string; visitanteId: string },
        );
      }
      await this.toast(`Rodada ${this.rodada}: ${validos.length} jogo(s) criados.`, 'success');
      await this.modalCtrl.dismiss({ created: validos.length });
    } catch (err) {
      console.error('[NovaRodada] erro', err);
      await this.toast('Erro ao criar rodada.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  trackByIndex(i: number): number {
    return i;
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'bottom',
      color,
    });
    await t.present();
  }
}
