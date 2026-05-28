import { Component, Input, OnInit, inject } from '@angular/core';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { RodadasService } from '../../../../campeonatos/rodadas.service';

@Component({
  selector: 'app-editar-rodada-modal',
  templateUrl: './editar-rodada-modal.component.html',
  styleUrls: ['./editar-rodada-modal.component.scss'],
  standalone: false,
})
export class EditarRodadaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() faseNome = '';
  @Input() numero = 0;

  private readonly rodadasSrv = inject(RodadasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);

  titulo = '';
  oculta = false;
  permiteEnvioResultados = false;
  loading = false;

  get placeholderTitulo(): string {
    return `${this.numero}ª Rodada`;
  }

  async ngOnInit(): Promise<void> {
    const r = await this.rodadasSrv.buscarPorFaseNumero(
      this.campeonatoId, this.categoriaId, this.faseNome, this.numero,
    );
    if (r) {
      this.titulo = r.titulo ?? '';
      this.oculta = !!r.oculta;
      this.permiteEnvioResultados = !!r.permiteEnvioResultados;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      await this.rodadasSrv.upsert(
        this.campeonatoId, this.categoriaId, this.faseNome, this.numero,
        {
          titulo: this.titulo.trim() || undefined,
          oculta: this.oculta,
          permiteEnvioResultados: this.permiteEnvioResultados,
        },
      );
      await this.toast('Rodada atualizada.', 'success');
      await this.modalCtrl.dismiss({ atualizou: true });
    } catch (err) {
      console.error('[EditarRodada] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  async remover(): Promise<void> {
    if (this.loading) return;
    const alert = await this.alertCtrl.create({
      header: `Remover rodada ${this.numero}?`,
      message: 'Os jogos desta rodada também serão apagados. Esta ação não pode ser desfeita.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Remover', role: 'destructive' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'destructive') return;

    this.loading = true;
    const loader = await this.loadingCtrl.create({
      message: `Removendo rodada ${this.numero}...`,
    });
    await loader.present();
    try {
      const todos = await firstValueFrom(
        this.jogosSrv.list$(this.campeonatoId, this.categoriaId),
      );
      const alvos = todos.filter(j =>
        (j.fase ?? '') === this.faseNome && j.rodada === this.numero,
      );
      for (const j of alvos) {
        if (j.id) await this.jogosSrv.remover(this.campeonatoId, this.categoriaId, j.id);
      }
      await this.rodadasSrv.removerPorFaseNumero(
        this.campeonatoId, this.categoriaId, this.faseNome, this.numero,
      );
      await this.toast(`Rodada ${this.numero} removida.`, 'success');
      await this.modalCtrl.dismiss({ removeu: true });
    } catch (err) {
      console.error('[EditarRodada] remover erro', err);
      await this.toast('Erro ao remover.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
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
