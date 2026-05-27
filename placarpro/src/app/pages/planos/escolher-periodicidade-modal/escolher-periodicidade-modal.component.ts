import { Component, Input, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { PlanosService, PlanoDef, Periodicidade } from '../../../users/planos.service';

/** Resultado emitido pelo modal — null se cancelou. */
export interface EscolherPeriodicidadeResult {
  periodicidade: Periodicidade;
  valorCentavos: number;
}

/**
 * Modal de escolha da periodicidade ao assinar um plano.
 * Exibe as 4 opções (Mensal/Trimestral/Semestral/Anual) com preço total
 * e desconto vs mensal. Usuário confirma e seguimos pra criar a cobrança.
 */
@Component({
  selector: 'app-escolher-periodicidade-modal',
  templateUrl: './escolher-periodicidade-modal.component.html',
  styleUrls: ['./escolher-periodicidade-modal.component.scss'],
  standalone: false,
})
export class EscolherPeriodicidadeModalComponent {
  private readonly modalCtrl = inject(ModalController);
  private readonly planosSrv = inject(PlanosService);

  @Input() plano!: PlanoDef;
  /** Periodicidade pré-selecionada (default: anual — maior desconto). */
  selecionada: Periodicidade = 'anual';

  readonly opcoes: Periodicidade[] = ['mensal', 'trimestral', 'semestral', 'anual'];

  labelPeriodicidade(p: Periodicidade): string {
    switch (p) {
      case 'mensal':     return 'Mensal';
      case 'trimestral': return 'Trimestral';
      case 'semestral':  return 'Semestral';
      case 'anual':      return 'Anual';
    }
  }

  subPeriodicidade(p: Periodicidade): string {
    switch (p) {
      case 'mensal':     return 'Pago uma vez por mês';
      case 'trimestral': return 'Pago a cada 3 meses';
      case 'semestral':  return 'Pago a cada 6 meses';
      case 'anual':      return 'Pago uma vez por ano';
    }
  }

  precoTotal(p: Periodicidade): string {
    const v = this.planosSrv.precoPorPeriodo(this.plano, p);
    return this.planosSrv.formatarMoeda(v);
  }

  precoMensal(p: Periodicidade): string {
    if (p === 'mensal') return '';
    const v = this.planosSrv.precoMensalEquivalente(this.plano, p);
    return `equivale a R$ ${v.toFixed(2).replace('.', ',')} / mês`;
  }

  desconto(p: Periodicidade): number {
    return this.planosSrv.descontoVsMensal(this.plano, p);
  }

  selecionar(p: Periodicidade): void {
    this.selecionada = p;
  }

  cancelar(): void {
    void this.modalCtrl.dismiss(null);
  }

  confirmar(): void {
    const valorReais = this.planosSrv.precoPorPeriodo(this.plano, this.selecionada);
    const result: EscolherPeriodicidadeResult = {
      periodicidade: this.selecionada,
      valorCentavos: Math.round(valorReais * 100),
    };
    void this.modalCtrl.dismiss(result);
  }
}
