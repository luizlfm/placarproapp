import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { FASE_TIPO_LABEL, Fase, FaseTipo } from '../../../../campeonatos/models/fase.model';
import { FasesService } from '../../../../campeonatos/fases.service';
import { EditarFaseModalComponent } from '../editar-fase-modal/editar-fase-modal.component';
import { NovaFaseModalComponent } from '../nova-fase-modal/nova-fase-modal.component';

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
    const modal = await this.modalCtrl.create({
      component: NovaFaseModalComponent,
      cssClass: 'modal-nova-fase',
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ tipo?: FaseTipo }>();
    if (data?.tipo) {
      await this.criarFase(data.tipo);
    }
  }

  async editar(f: Fase): Promise<string | undefined> {
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
    const { role } = await modal.onDidDismiss();
    await this.recarregar();
    return role;
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
      if (!nova) return;
      // Abre Editar fase pra customizar. Se o usuário fechar SEM salvar
      // (role !== 'saved' e !== 'removed'), apaga a fase recém-criada — o
      // X é interpretado como "desistir de criar", não como "manter rascunho".
      const role = await this.editar(nova);
      if (role !== 'saved' && role !== 'removed') {
        await this.fasesSrv.remover(this.campeonatoId, this.categoriaId, id);
        await this.recarregar();
      }
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
