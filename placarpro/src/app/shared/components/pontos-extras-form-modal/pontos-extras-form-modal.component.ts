import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';

/**
 * Sub-modal pequeno usado pra cadastrar UM ajuste de pontos extras
 * (mandante ou visitante). Retorna `{ lado, pontos, motivo }` no dismiss.
 *
 * Aberto a partir do PontosExtrasModalComponent quando o usuário clica
 * "Adicionar" ou no lápis de uma linha existente.
 */
@Component({
  selector: 'app-pontos-extras-form-modal',
  templateUrl: './pontos-extras-form-modal.component.html',
  styleUrls: ['./pontos-extras-form-modal.component.scss'],
  standalone: false,
})
export class PontosExtrasFormModalComponent implements OnInit {
  @Input() equipeLado: 'mandante' | 'visitante' = 'mandante';
  @Input() mandante?: Equipe;
  @Input() visitante?: Equipe;
  /** Valor inicial do número de pontos (positivo = bônus, negativo = penalidade). */
  @Input() valorInicial = 0;
  @Input() motivoInicial = '';

  private readonly modalCtrl = inject(ModalController);

  pontos = 0;
  motivo = '';

  /** Valores possíveis no seletor — bônus +1..+3 e penalidades -1..-3. */
  readonly opcoes = [-3, -2, -1, 0, 1, 2, 3];

  ngOnInit(): void {
    this.pontos = this.valorInicial ?? 0;
    this.motivo = this.motivoInicial ?? '';
  }

  get equipeAtual(): Equipe | undefined {
    return this.equipeLado === 'mandante' ? this.mandante : this.visitante;
  }

  trocarLado(novo: 'mandante' | 'visitante'): void {
    this.equipeLado = novo;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  salvar(): Promise<boolean> {
    return this.modalCtrl.dismiss({
      lado: this.equipeLado,
      pontos: Number(this.pontos),
      motivo: this.motivo.trim() || undefined,
    });
  }
}
