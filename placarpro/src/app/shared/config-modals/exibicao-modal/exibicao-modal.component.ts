import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';

/**
 * Modal pra configurar quais campos aparecem na página pública (nomes e datas).
 * São flags simples gravadas no documento do campeonato.
 */
@Component({
  selector: 'app-exibicao-modal',
  templateUrl: './exibicao-modal.component.html',
  styleUrls: ['./exibicao-modal.component.scss'],
  standalone: false,
})
export class ExibicaoModalComponent implements OnInit {
  @Input() campeonatoId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly toastCtrl = inject(ToastController);

  exibirNomes = true;
  exibirDatas = true;
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    const sub = this.campSrv.get$(this.campeonatoId).subscribe(c => {
      this.exibirNomes = c?.exibirNomes ?? true;
      this.exibirDatas = c?.exibirDatas ?? true;
      setTimeout(() => sub.unsubscribe(), 0);
    });
  }

  async salvar(): Promise<void> {
    this.salvando = true;
    try {
      await this.campSrv.atualizar(this.campeonatoId, {
        exibirNomes: this.exibirNomes,
        exibirDatas: this.exibirDatas,
      });
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Exibicao] salvar erro', err);
      const t = await this.toastCtrl.create({
        message: 'Falha ao salvar.', duration: 2200, position: 'top', color: 'danger',
      });
      await t.present();
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }
}
