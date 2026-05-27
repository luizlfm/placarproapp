import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { FASE_TIPO_LABEL, Fase, FaseTipo } from '../../../../campeonatos/models/fase.model';
import { FasesService } from '../../../../campeonatos/fases.service';
import { EditarFaseModalComponent } from '../editar-fase-modal/editar-fase-modal.component';

@Component({
  selector: 'app-fases-modal',
  templateUrl: './fases-modal.component.html',
  styleUrls: ['./fases-modal.component.scss'],
  standalone: false,
})
export class FasesModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly fasesSrv = inject(FasesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly TIPO_LABEL = FASE_TIPO_LABEL;

  fases: Fase[] = [];
  loading = false;

  async ngOnInit(): Promise<void> {
    await this.recarregar();
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async novaFase(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Nova fase',
      cssClass: 'alert-nova-fase',
      buttons: [
        {
          text: 'Pontos corridos',
          cssClass: 'alert-btn-tipo',
          handler: () => {
            this.criarFase('pontos-corridos');
          },
        },
        {
          text: 'Eliminatórias',
          cssClass: 'alert-btn-tipo',
          handler: () => {
            this.criarFase('eliminatorias');
          },
        },
        { text: 'Cancelar', role: 'cancel', cssClass: 'alert-btn-cancel' },
      ],
    });
    await alert.present();
  }

  async editar(f: Fase): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EditarFaseModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        fase: f,
      },
      cssClass: 'modal-editar-fase',
      backdropDismiss: true,
    });
    await modal.present();
    await modal.onDidDismiss();
    await this.recarregar();
  }

  trackById(_i: number, f: Fase): string {
    return f.id ?? '';
  }

  private async criarFase(tipo: FaseTipo): Promise<void> {
    this.loading = true;
    try {
      const ordem = this.fases.length;
      const nome = this.proximoNomeOrdinal(ordem, tipo);
      const id = await this.fasesSrv.criar(this.campeonatoId, this.categoriaId, {
        nome,
        tipo,
        turnos: 1,
        classificacaoAtiva: tipo !== 'eliminatorias',
      });
      await this.recarregar();
      const nova = this.fases.find(f => f.id === id);
      if (nova) await this.editar(nova);
    } catch (err) {
      console.error('[Fases] criar erro', err);
      await this.toast('Erro ao criar fase.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  private proximoNomeOrdinal(ordem: number, tipo: FaseTipo): string {
    if (tipo === 'eliminatorias') {
      const usadas = this.fases.filter(f => f.tipo === 'eliminatorias').length;
      const nomes = ['Quartas de final', 'Semifinal', 'Final'];
      return nomes[usadas] ?? `Eliminatória ${usadas + 1}`;
    }
    return `${ordem + 1}º Fase`;
  }

  private async recarregar(): Promise<void> {
    this.fases = await firstValueFrom(
      this.fasesSrv.list$(this.campeonatoId, this.categoriaId),
    );
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
