import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { DESTAQUE_CORES, PosicaoDestaque } from '../../../../campeonatos/models/fase.model';

@Component({
  selector: 'app-destacar-posicoes-modal',
  templateUrl: './destacar-posicoes-modal.component.html',
  styleUrls: ['./destacar-posicoes-modal.component.scss'],
  standalone: false,
})
export class DestacarPosicoesModalComponent implements OnInit {
  @Input() destaques: PosicaoDestaque[] = [];
  @Input() totalEquipes = 0;

  private readonly modalCtrl = inject(ModalController);

  readonly cores = DESTAQUE_CORES;
  itens: PosicaoDestaque[] = [];

  ngOnInit(): void {
    this.itens = this.destaques.map(d => ({ ...d }));
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  adicionar(): void {
    const ultimo = this.itens[this.itens.length - 1];
    const proximaPos = ultimo ? Math.min(ultimo.ate + 1, Math.max(1, this.totalEquipes)) : 1;
    this.itens.push({
      de: proximaPos,
      ate: proximaPos,
      cor: this.cores[this.itens.length % this.cores.length].cor,
      label: this.cores[this.itens.length % this.cores.length].label,
    });
  }

  remover(i: number): void {
    this.itens.splice(i, 1);
  }

  selecionarCor(item: PosicaoDestaque, cor: string, label?: string): void {
    item.cor = cor;
    if (label && !item.label) item.label = label;
  }

  salvar(): Promise<boolean> {
    return this.modalCtrl.dismiss({ destaques: this.itens });
  }

  trackByIndex(i: number): number {
    return i;
  }
}
