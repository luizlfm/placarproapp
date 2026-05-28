import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo, PontosExtras } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';
import { PontosExtrasFormModalComponent } from '../pontos-extras-form-modal/pontos-extras-form-modal.component';

/**
 * Modal principal de Pontos Extras: lista os ajustes já aplicados
 * (mandante e/ou visitante) e oferece "Adicionar" pra abrir o form
 * de criação/edição em outro modal menor.
 */
@Component({
  selector: 'app-pontos-extras-modal',
  templateUrl: './pontos-extras-modal.component.html',
  styleUrls: ['./pontos-extras-modal.component.scss'],
  standalone: false,
})
export class PontosExtrasModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogo!: Jogo;
  @Input() equipes: Equipe[] = [];

  private readonly modalCtrl = inject(ModalController);
  private readonly jogosSrv = inject(JogosService);
  private readonly toastCtrl = inject(ToastController);

  pontosExtras: PontosExtras = {};

  ngOnInit(): void {
    this.pontosExtras = { ...(this.jogo?.pontosExtras ?? {}) };
  }

  get mandante(): Equipe | undefined {
    return this.equipes.find(e => e.id === this.jogo?.mandanteId);
  }
  get visitante(): Equipe | undefined {
    return this.equipes.find(e => e.id === this.jogo?.visitanteId);
  }

  /** Retorna lista de entries pra exibir (apenas equipes com pontos != 0). */
  get itens(): { lado: 'mandante' | 'visitante'; equipe?: Equipe; pontos: number }[] {
    const out: { lado: 'mandante' | 'visitante'; equipe?: Equipe; pontos: number }[] = [];
    if (this.pontosExtras.mandante) {
      out.push({ lado: 'mandante', equipe: this.mandante, pontos: this.pontosExtras.mandante });
    }
    if (this.pontosExtras.visitante) {
      out.push({ lado: 'visitante', equipe: this.visitante, pontos: this.pontosExtras.visitante });
    }
    return out;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async adicionar(lado?: 'mandante' | 'visitante'): Promise<void> {
    const ladoEscolhido = lado ?? (this.pontosExtras.mandante ? 'visitante' : 'mandante');
    const modal = await this.modalCtrl.create({
      component: PontosExtrasFormModalComponent,
      componentProps: {
        equipe: ladoEscolhido === 'mandante' ? this.mandante : this.visitante,
        equipeLado: ladoEscolhido,
        mandante: this.mandante,
        visitante: this.visitante,
        valorInicial: this.pontosExtras[ladoEscolhido] ?? 0,
        motivoInicial: this.pontosExtras.motivo ?? '',
      },
      cssClass: 'modal-pontos-extras-form',
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{
      lado: 'mandante' | 'visitante';
      pontos: number;
      motivo?: string;
    } | undefined>();
    if (!data) return;
    this.pontosExtras = {
      ...this.pontosExtras,
      [data.lado]: data.pontos,
      motivo: data.motivo ?? this.pontosExtras.motivo,
    };
    await this.persistir();
  }

  async remover(lado: 'mandante' | 'visitante'): Promise<void> {
    const { [lado]: _drop, ...resto } = this.pontosExtras;
    this.pontosExtras = resto;
    await this.persistir();
  }

  private async persistir(): Promise<void> {
    if (!this.jogo?.id) return;
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id, {
        pontosExtras: this.pontosExtras,
      });
    } catch {
      const t = await this.toastCtrl.create({
        message: 'Erro ao salvar pontos extras.',
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    }
  }
}
