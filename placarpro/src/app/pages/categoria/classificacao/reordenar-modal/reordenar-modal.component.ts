import { Component, Input, OnInit, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { EquipesService } from '../../../../campeonatos/equipes.service';

@Component({
  selector: 'app-reordenar-modal',
  templateUrl: './reordenar-modal.component.html',
  styleUrls: ['./reordenar-modal.component.scss'],
  standalone: false,
})
export class ReordenarModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly equipesSrv = inject(EquipesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  equipes: Equipe[] = [];
  loading = false;

  async ngOnInit(): Promise<void> {
    const lista = await firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId));
    this.equipes = [...lista].sort((a, b) => {
      const pa = a.posicaoManual;
      const pb = b.posicaoManual;
      if (pa != null && pb != null) return pa - pb;
      if (pa != null) return -1;
      if (pb != null) return 1;
      return a.nome.localeCompare(b.nome);
    });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  mover(eq: Equipe, delta: -1 | 1): void {
    const i = this.equipes.findIndex(e => e.id === eq.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.equipes.length) return;
    [this.equipes[i], this.equipes[j]] = [this.equipes[j], this.equipes[i]];
  }

  async salvar(): Promise<void> {
    this.loading = true;
    const loader = await this.loadingCtrl.create({ message: 'Salvando ordem...' });
    await loader.present();
    try {
      for (let i = 0; i < this.equipes.length; i++) {
        const eq = this.equipes[i];
        if (!eq.id) continue;
        if (eq.posicaoManual !== i) {
          await this.equipesSrv.atualizar(this.campeonatoId, this.categoriaId, eq.id, {
            posicaoManual: i,
          });
        }
      }
      await this.toast('Ordem manual salva.', 'success');
      await this.modalCtrl.dismiss({ saved: true, manual: true });
    } catch (err) {
      console.error('[Reordenar] salvar erro', err);
      await this.toast('Erro ao salvar ordem.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  async limparOrdem(): Promise<void> {
    this.loading = true;
    const loader = await this.loadingCtrl.create({ message: 'Limpando ordem manual...' });
    await loader.present();
    try {
      for (const eq of this.equipes) {
        if (eq.posicaoManual != null && eq.id) {
          await this.equipesSrv.atualizar(this.campeonatoId, this.categoriaId, eq.id, {
            posicaoManual: null as unknown as number,
          });
        }
      }
      await this.toast('Ordem natural restaurada.', 'success');
      await this.modalCtrl.dismiss({ saved: true, manual: false });
    } catch {
      await this.toast('Erro ao limpar ordem.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  trackById(_i: number, e: Equipe): string {
    return e.id ?? '';
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
