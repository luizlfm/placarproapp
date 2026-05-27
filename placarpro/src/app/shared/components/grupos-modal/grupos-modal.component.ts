import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Grupo } from '../../../campeonatos/models/grupo.model';
import { GruposService } from '../../../campeonatos/grupos.service';

@Component({
  selector: 'app-grupos-modal',
  templateUrl: './grupos-modal.component.html',
  styleUrls: ['./grupos-modal.component.scss'],
  standalone: false,
})
export class GruposModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly gruposSrv = inject(GruposService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  qtd = 2;
  grupos: Grupo[] = [];
  loading = false;

  async ngOnInit(): Promise<void> {
    this.grupos = await firstValueFrom(this.gruposSrv.list$(this.campeonatoId, this.categoriaId));
    if (this.grupos.length > 0) this.qtd = this.grupos.length;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async sortear(): Promise<void> {
    this.loading = true;
    try {
      await this.gruposSrv.sortear(this.campeonatoId, this.categoriaId);
      await this.toast('Equipes sorteadas nos grupos!', 'success');
    } finally {
      this.loading = false;
    }
  }

  async aplicarQuantidade(): Promise<void> {
    if (this.qtd < 1 || this.qtd > 16) return;
    this.loading = true;
    try {
      await this.gruposSrv.definirQuantidade(this.campeonatoId, this.categoriaId, this.qtd);
      this.grupos = await firstValueFrom(this.gruposSrv.list$(this.campeonatoId, this.categoriaId));
      await this.toast(`Estrutura atualizada: ${this.qtd} grupo(s).`, 'success');
    } finally {
      this.loading = false;
    }
  }

  async renomear(g: Grupo): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Renomear grupo',
      inputs: [{ name: 'nome', type: 'text', value: g.nome, placeholder: 'Nome do grupo' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { nome: string }) => {
            const nome = (data.nome || '').trim();
            if (!nome) return;
            await this.gruposSrv.renomear(this.campeonatoId, this.categoriaId, g.id!, nome);
            this.grupos = await firstValueFrom(this.gruposSrv.list$(this.campeonatoId, this.categoriaId));
          },
        },
      ],
    });
    await alert.present();
  }

  trackById(_i: number, g: Grupo): string {
    return g.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }
}
