import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import {
  CRITERIOS_PADRAO,
  CriterioId,
  FASE_TIPO_LABEL,
  Fase,
  PosicaoDestaque,
} from '../../../../campeonatos/models/fase.model';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { FasesService } from '../../../../campeonatos/fases.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { DestacarPosicoesModalComponent } from '../destacar-posicoes-modal/destacar-posicoes-modal.component';
import { CriteriosModalComponent } from '../criterios-modal/criterios-modal.component';

@Component({
  selector: 'app-editar-fase-modal',
  templateUrl: './editar-fase-modal.component.html',
  styleUrls: ['./editar-fase-modal.component.scss'],
  standalone: false,
})
export class EditarFaseModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() fase!: Fase;

  private readonly fasesSrv = inject(FasesService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  titulo = '';
  classificacaoAtiva = true;
  destaques: PosicaoDestaque[] = [];
  equipesSelecionadas: string[] = [];
  continuarDeFaseId?: string;
  turnos: 1 | 2 = 1;
  pontosVitoria = 3;
  pontosEmpate = 1;
  pontosDerrota = 0;
  criterios: CriterioId[] = [];

  fases: Fase[] = [];
  equipes: Equipe[] = [];
  loading = false;

  async ngOnInit(): Promise<void> {
    this.aplicarFaseLocal(this.fase);

    this.fases = await firstValueFrom(this.fasesSrv.list$(this.campeonatoId, this.categoriaId));
    this.equipes = await firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId));
  }

  /** Hidrata as variáveis locais a partir do doc da fase. Usado no init e
   *  depois que o sub-modal de critérios salva (pra refletir mudanças). */
  private aplicarFaseLocal(f: Fase): void {
    this.titulo = f.nome;
    this.classificacaoAtiva = f.classificacaoAtiva ?? f.tipo !== 'eliminatorias';
    this.destaques = [...(f.destaques ?? [])];
    this.equipesSelecionadas = [...(f.equipesSelecionadas ?? [])];
    this.continuarDeFaseId = f.continuarDeFaseId;
    this.turnos = (f.turnos === 2 ? 2 : 1) as 1 | 2;
    this.pontosVitoria = f.pontosVitoria ?? 3;
    this.pontosEmpate = f.pontosEmpate ?? 1;
    this.pontosDerrota = f.pontosDerrota ?? 0;
    this.criterios = f.criterios?.length ? [...f.criterios] : [...CRITERIOS_PADRAO];
  }

  get isEliminatoria(): boolean {
    return this.fase.tipo === 'eliminatorias';
  }

  get tipoLabel(): string {
    return FASE_TIPO_LABEL[this.fase.tipo] ?? this.fase.tipo;
  }

  get equipesResumo(): string {
    if (this.equipesSelecionadas.length === 0) return 'Todas';
    return `${this.equipesSelecionadas.length} de ${this.equipes.length}`;
  }

  get continuarResumo(): string {
    if (!this.continuarDeFaseId) return 'Nenhuma';
    return this.fases.find(f => f.id === this.continuarDeFaseId)?.nome ?? 'Outra';
  }

  get destaquesResumo(): string {
    if (this.destaques.length === 0) return 'Sem destaques';
    return `${this.destaques.length} faixa(s)`;
  }

  get criteriosResumo(): string {
    if (!this.criterios.length) return 'Padrão';
    return `${this.criterios.length} ativos`;
  }

  dismiss(role: 'cancel' | 'saved' | 'removed' = 'cancel'): Promise<boolean> {
    return this.modalCtrl.dismiss(undefined, role);
  }

  async editarDestaques(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: DestacarPosicoesModalComponent,
      componentProps: {
        destaques: this.destaques,
        totalEquipes: this.equipes.length,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ destaques?: PosicaoDestaque[] }>();
    if (data?.destaques) this.destaques = data.destaques;
  }

  /**
   * Abre o modal de critérios de desempate. Esse modal também salva a
   * pontuação V/E/D direto no doc da fase, então depois precisamos
   * recarregar o doc local pra não sobrescrever ao salvar daqui.
   */
  async editarCriterios(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CriteriosModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        fase: this.fase,
      },
    });
    await modal.present();
    await modal.onDidDismiss();
    // Recarrega a fase do Firestore — o modal de critérios já persistiu.
    const todas = await firstValueFrom(this.fasesSrv.list$(this.campeonatoId, this.categoriaId));
    const atual = todas.find(f => f.id === this.fase.id);
    if (atual) {
      this.fase = atual;
      this.aplicarFaseLocal(atual);
    }
  }

  async editarEquipes(): Promise<void> {
    const inputs = this.equipes.map(e => ({
      name: e.id!,
      type: 'checkbox' as const,
      label: e.nome,
      value: e.id!,
      checked: this.equipesSelecionadas.length === 0 || this.equipesSelecionadas.includes(e.id!),
    }));
    const alert = await this.alertCtrl.create({
      header: 'Selecionar equipes',
      message: 'Equipes que disputam esta fase. Vazio = todas.',
      cssClass: 'alert-tall',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Aplicar',
          handler: (selecionados: string[]) => {
            // Se selecionar todas, deixa vazio (=todas)
            if (selecionados.length === this.equipes.length || selecionados.length === 0) {
              this.equipesSelecionadas = [];
            } else {
              this.equipesSelecionadas = selecionados;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async editarContinuar(): Promise<void> {
    const outras = this.fases.filter(f => f.id !== this.fase.id);
    if (outras.length === 0) {
      await this.toast('Não há outras fases para continuar a tabela.', 'danger');
      return;
    }
    const inputs = [
      {
        name: 'continuar',
        type: 'radio' as const,
        label: 'Nenhuma — começar do zero',
        value: '',
        checked: !this.continuarDeFaseId,
      },
      ...outras.map(f => ({
        name: 'continuar',
        type: 'radio' as const,
        label: f.nome,
        value: f.id!,
        checked: this.continuarDeFaseId === f.id,
      })),
    ];
    const alert = await this.alertCtrl.create({
      header: 'Continuar tabela',
      message: 'A classificação parte dos pontos da fase escolhida.',
      inputs,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Aplicar',
          handler: (valor: string) => {
            this.continuarDeFaseId = valor || undefined;
          },
        },
      ],
    });
    await alert.present();
  }

  async salvar(): Promise<void> {
    const nome = this.titulo.trim();
    if (nome.length < 2) {
      await this.toast('Título muito curto.', 'danger');
      return;
    }
    this.loading = true;
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      await this.fasesSrv.atualizar(this.campeonatoId, this.categoriaId, this.fase.id!, {
        nome,
        classificacaoAtiva: this.classificacaoAtiva,
        destaques: this.destaques,
        equipesSelecionadas: this.equipesSelecionadas,
        continuarDeFaseId: this.continuarDeFaseId,
        turnos: this.turnos,
        pontosVitoria: this.pontosVitoria,
        pontosEmpate: this.pontosEmpate,
        pontosDerrota: this.pontosDerrota,
        criterios: this.criterios,
      });
      await this.toast('Fase atualizada.', 'success');
      await this.dismiss('saved');
    } catch (err) {
      console.error('[EditarFase] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  async remover(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover fase?',
      message: `"${this.fase.nome}" e suas configurações serão apagadas.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.fasesSrv.remover(this.campeonatoId, this.categoriaId, this.fase.id!);
              await this.dismiss('removed');
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
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
