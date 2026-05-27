import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import {
  CRITERIO_LABEL,
  CRITERIOS_PADRAO,
  CriterioId,
  Fase,
} from '../../../../campeonatos/models/fase.model';
import { FasesService } from '../../../../campeonatos/fases.service';

@Component({
  selector: 'app-criterios-modal',
  templateUrl: './criterios-modal.component.html',
  styleUrls: ['./criterios-modal.component.scss'],
  standalone: false,
})
export class CriteriosModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() fase!: Fase;

  private readonly fasesSrv = inject(FasesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  readonly LABELS = CRITERIO_LABEL;
  /** Todos os IDs disponíveis. */
  readonly todos: CriterioId[] = Object.keys(CRITERIO_LABEL) as CriterioId[];

  ativos: CriterioId[] = [];
  pontosVitoria = 3;
  pontosEmpate = 1;
  pontosDerrota = 0;
  loading = false;

  ngOnInit(): void {
    this.ativos = this.fase.criterios?.length
      ? [...this.fase.criterios]
      : [...CRITERIOS_PADRAO];
    this.pontosVitoria = this.fase.pontosVitoria ?? 3;
    this.pontosEmpate = this.fase.pontosEmpate ?? 1;
    this.pontosDerrota = this.fase.pontosDerrota ?? 0;
  }

  get inativos(): CriterioId[] {
    return this.todos.filter(c => !this.ativos.includes(c));
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  mover(c: CriterioId, delta: -1 | 1): void {
    const i = this.ativos.indexOf(c);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.ativos.length) return;
    [this.ativos[i], this.ativos[j]] = [this.ativos[j], this.ativos[i]];
  }

  remover(c: CriterioId): void {
    this.ativos = this.ativos.filter(x => x !== c);
  }

  adicionar(c: CriterioId): void {
    if (!this.ativos.includes(c)) this.ativos.push(c);
  }

  resetar(): void {
    this.ativos = [...CRITERIOS_PADRAO];
    this.pontosVitoria = 3;
    this.pontosEmpate = 1;
    this.pontosDerrota = 0;
  }

  async salvar(): Promise<void> {
    this.loading = true;
    try {
      await this.fasesSrv.atualizar(this.campeonatoId, this.categoriaId, this.fase.id!, {
        criterios: this.ativos,
        pontosVitoria: this.pontosVitoria,
        pontosEmpate: this.pontosEmpate,
        pontosDerrota: this.pontosDerrota,
      });
      await this.toast('Critérios atualizados.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Criterios] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  trackByCriterio(_i: number, c: CriterioId): string {
    return c;
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
