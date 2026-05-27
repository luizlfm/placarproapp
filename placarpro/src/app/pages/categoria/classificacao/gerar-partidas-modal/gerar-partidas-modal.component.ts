import { Component, Input, OnInit, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Grupo } from '../../../../campeonatos/models/grupo.model';
import { Fase } from '../../../../campeonatos/models/fase.model';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { GruposService } from '../../../../campeonatos/grupos.service';
import { JogosService } from '../../../../campeonatos/jogos.service';

@Component({
  selector: 'app-gerar-partidas-modal',
  templateUrl: './gerar-partidas-modal.component.html',
  styleUrls: ['./gerar-partidas-modal.component.scss'],
  standalone: false,
})
export class GerarPartidasModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() fase!: Fase;

  private readonly equipesSrv = inject(EquipesService);
  private readonly gruposSrv = inject(GruposService);
  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  equipes: Equipe[] = [];
  grupos: Grupo[] = [];
  turnos: 1 | 2 = 1;
  porGrupos = false;
  apagarExistentes = true;
  loading = false;
  carregando = true;

  async ngOnInit(): Promise<void> {
    this.turnos = this.fase.turnos ?? 1;
    this.equipes = await firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId));
    this.grupos = await firstValueFrom(this.gruposSrv.list$(this.campeonatoId, this.categoriaId));
    this.porGrupos = this.grupos.length > 0 && this.fase.tipo === 'pontos-corridos-grupos';
    this.carregando = false;
  }

  get totalPartidas(): number {
    const n = this.equipes.length;
    if (n < 2) return 0;
    if (this.porGrupos && this.grupos.length > 0) {
      const porGrupo = new Map<string, number>();
      this.equipes.forEach(e => {
        if (!e.grupoId) return;
        porGrupo.set(e.grupoId, (porGrupo.get(e.grupoId) ?? 0) + 1);
      });
      let total = 0;
      porGrupo.forEach(qtd => {
        total += (qtd * (qtd - 1)) / 2;
      });
      return total * this.turnos;
    }
    return ((n * (n - 1)) / 2) * this.turnos;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async confirmar(): Promise<void> {
    if (this.equipes.length < 2) {
      await this.toast('São necessárias pelo menos 2 equipes.', 'danger');
      return;
    }
    this.loading = true;
    const loader = await this.loadingCtrl.create({ message: 'Gerando partidas...' });
    await loader.present();
    try {
      if (this.apagarExistentes) {
        await this.jogosSrv.limparFase(this.campeonatoId, this.categoriaId, this.fase.nome);
      }

      let total = 0;
      if (this.porGrupos && this.grupos.length > 0) {
        for (const g of this.grupos) {
          const equipesDoGrupo = this.equipes.filter(e => e.grupoId === g.id);
          if (equipesDoGrupo.length < 2) continue;
          total += await this.jogosSrv.gerarRoundRobin(
            this.campeonatoId,
            this.categoriaId,
            equipesDoGrupo,
            this.turnos,
            this.fase.nome,
            g.id,
          );
        }
      } else {
        total = await this.jogosSrv.gerarRoundRobin(
          this.campeonatoId,
          this.categoriaId,
          this.equipes,
          this.turnos,
          this.fase.nome,
        );
      }

      await this.toast(`${total} partida(s) geradas!`, 'success');
      await this.modalCtrl.dismiss({ generated: total });
    } catch (err) {
      console.error('[GerarPartidas] erro', err);
      await this.toast('Erro ao gerar partidas.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
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
