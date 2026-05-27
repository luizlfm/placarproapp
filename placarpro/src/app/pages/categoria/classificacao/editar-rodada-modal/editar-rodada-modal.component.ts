import { Component, Input, OnInit, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Fase } from '../../../../campeonatos/models/fase.model';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../../campeonatos/jogos.service';

interface RodadaInfo {
  numero: number;
  qtdJogos: number;
  dataHoraComum?: string;
  localComum?: string;
}

@Component({
  selector: 'app-editar-rodada-modal',
  templateUrl: './editar-rodada-modal.component.html',
  styleUrls: ['./editar-rodada-modal.component.scss'],
  standalone: false,
})
export class EditarRodadaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() fase!: Fase;

  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  rodadas: RodadaInfo[] = [];
  rodadaSelecionada?: RodadaInfo;
  novaDataHora = '';
  novoLocal = '';
  aplicarData = false;
  aplicarLocal = false;
  carregando = true;
  loading = false;

  private jogosDaFase: Jogo[] = [];

  async ngOnInit(): Promise<void> {
    await this.recarregar();
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  selecionar(r: RodadaInfo): void {
    this.rodadaSelecionada = r;
    this.novaDataHora = r.dataHoraComum ?? '';
    this.novoLocal = r.localComum ?? '';
    this.aplicarData = false;
    this.aplicarLocal = false;
  }

  voltarParaLista(): void {
    this.rodadaSelecionada = undefined;
  }

  async salvar(): Promise<void> {
    if (!this.rodadaSelecionada) return;
    if (!this.aplicarData && !this.aplicarLocal) {
      await this.toast('Marque pelo menos um campo para aplicar.', 'danger');
      return;
    }
    this.loading = true;
    const loader = await this.loadingCtrl.create({ message: 'Aplicando...' });
    await loader.present();
    try {
      const numero = this.rodadaSelecionada.numero;
      const jogosRodada = this.jogosDaFase.filter(j => j.rodada === numero);
      for (const j of jogosRodada) {
        const patch: Partial<Jogo> = {};
        if (this.aplicarData) patch.dataHora = this.novaDataHora || '';
        if (this.aplicarLocal) patch.local = this.novoLocal || '';
        if (Object.keys(patch).length > 0) {
          await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, j.id!, patch);
        }
      }
      await this.toast(`Rodada ${numero} atualizada (${jogosRodada.length} jogos).`, 'success');
      await this.recarregar();
      this.rodadaSelecionada = undefined;
    } catch (err) {
      console.error('[EditarRodada] erro', err);
      await this.toast('Erro ao atualizar.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  async removerRodada(r: RodadaInfo): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    const loader = await this.loadingCtrl.create({
      message: `Removendo rodada ${r.numero}...`,
    });
    await loader.present();
    try {
      const jogos = this.jogosDaFase.filter(j => j.rodada === r.numero);
      for (const j of jogos) {
        if (j.id) await this.jogosSrv.remover(this.campeonatoId, this.categoriaId, j.id);
      }
      await this.toast(`Rodada ${r.numero} removida.`, 'success');
      await this.recarregar();
    } catch {
      await this.toast('Erro ao remover.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  trackByNumero(_i: number, r: RodadaInfo): number {
    return r.numero;
  }

  private async recarregar(): Promise<void> {
    this.carregando = true;
    const todos = await firstValueFrom(
      this.jogosSrv.list$(this.campeonatoId, this.categoriaId),
    );
    this.jogosDaFase = todos.filter(j => !j.fase || j.fase === this.fase.nome);

    const mapa = new Map<number, Jogo[]>();
    this.jogosDaFase.forEach(j => {
      const r = j.rodada ?? 0;
      if (!mapa.has(r)) mapa.set(r, []);
      mapa.get(r)!.push(j);
    });

    this.rodadas = Array.from(mapa.entries())
      .sort(([a], [b]) => a - b)
      .map(([numero, jogos]) => {
        const datas = new Set(jogos.map(j => j.dataHora).filter(Boolean));
        const locais = new Set(jogos.map(j => j.local).filter(Boolean));
        return {
          numero,
          qtdJogos: jogos.length,
          dataHoraComum: datas.size === 1 ? [...datas][0] : '',
          localComum: locais.size === 1 ? [...locais][0] : '',
        };
      })
      .filter(r => r.numero > 0);

    this.carregando = false;
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
