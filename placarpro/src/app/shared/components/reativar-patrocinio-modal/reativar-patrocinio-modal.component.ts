import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { UsersService } from '../../../users/users.service';
import { PatrociniosService } from '../../../campeonatos/patrocinios.service';
import { PlanosService } from '../../../users/planos.service';
import { PatrocinioJogo } from '../../../campeonatos/models/patrocinio-jogo.model';

/**
 * Modal de REATIVAR patrocínio.
 *
 * - Mostra info do patrocínio (anunciantes + tipo)
 * - Stepper visual pra escolher quantidade de créditos
 * - Calcula duração proporcional (créditos × 60min) em tempo real
 * - Resumo de custo destacado
 * - Confirmar → chama `patrSrv.reativarPatrocinio()` (mesmo doc é
 *   atualizado pra status='ativo' com nova duração)
 */
@Component({
  selector: 'app-reativar-patrocinio-modal',
  templateUrl: './reativar-patrocinio-modal.component.html',
  styleUrls: ['./reativar-patrocinio-modal.component.scss'],
  standalone: false,
})
export class ReativarPatrocinioModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly usersSrv = inject(UsersService);
  private readonly patrSrv = inject(PatrociniosService);
  private readonly planosSrv = inject(PlanosService);

  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  @Input() patrocinio?: PatrocinioJogo;

  /** Quantidade de créditos selecionada. Cada crédito = 60min. */
  creditos = 1;

  /** Saldo atual (snapshot) — cap do stepper. */
  saldo = 0;
  saldo$: Observable<number> = of(0);
  salvando = false;

  /** Duração base por crédito (min) — editável pelo admin (config comercial). */
  get duracaoBaseMin(): number { return this.planosSrv.duracaoCreditoNormalMin; }

  /** Preço unitário do crédito (editável pelo admin via config comercial). */
  get precoUnit(): number {
    return this.patrocinio?.tipo === 'premium'
      ? this.planosSrv.precoCreditoPremium
      : this.planosSrv.precoCreditoNormal;
  }

  /** Texto humano do tipo selecionado. */
  get tipoLabel(): string {
    return this.patrocinio?.tipo === 'premium' ? 'PREMIUM' : 'Normal';
  }

  /** Duração total em minutos = créditos × 60. */
  get duracaoTotalMin(): number {
    return this.creditos * this.duracaoBaseMin;
  }

  /** Duração formatada (ex: "3h" ou "1h 30min" se quiser meia hora). */
  get duracaoTexto(): string {
    const min = this.duracaoTotalMin;
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const r = min % 60;
      return r === 0 ? `${h}h` : `${h}h ${r}min`;
    }
    return `${min}min`;
  }

  /** Custo total em reais. */
  get custoTotal(): number {
    return this.creditos * this.precoUnit;
  }

  /** Quantidade de anunciantes no patrocínio. */
  get qtdAnunciantes(): number {
    return this.patrocinio?.patrocinadores?.length ?? 0;
  }

  ngOnInit(): void {
    const tipoEhPremium = this.patrocinio?.tipo === 'premium';
    this.saldo$ = this.usersSrv.profile$().pipe(
      map(p => tipoEhPremium
        ? (p?.creditosPatrocinioPremium ?? 0)
        : (p?.creditosPatrocinio ?? 0)),
    );
    this.saldo$.subscribe(s => {
      this.saldo = s;
      if (this.creditos > s) this.creditos = Math.max(1, s);
    });
  }

  ajustar(delta: number): void {
    const novo = this.creditos + delta;
    if (novo < 1) return;
    if (novo > this.saldo) return;
    this.creditos = novo;
  }

  async confirmar(): Promise<void> {
    if (!this.patrocinio?.id) return;
    if (this.creditos < 1 || this.creditos > this.saldo) return;

    this.salvando = true;
    try {
      await this.patrSrv.reativarPatrocinio(
        this.campeonatoId, this.categoriaId, this.jogoId, this.patrocinio, this.creditos,
      );
      const t = await this.toastCtrl.create({
        message: `Reativado por ${this.duracaoTexto}! ${this.creditos} crédito${this.creditos > 1 ? 's' : ''} debitado${this.creditos > 1 ? 's' : ''}.`,
        duration: 2800, color: 'success', position: 'top',
      });
      await t.present();
      await this.modalCtrl.dismiss({ reativado: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const t = await this.toastCtrl.create({
        message: msg, duration: 3500, color: 'danger', position: 'top',
      });
      await t.present();
    } finally {
      this.salvando = false;
    }
  }

  async fechar(): Promise<void> {
    await this.modalCtrl.dismiss();
  }
}
