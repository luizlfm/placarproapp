import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { Enquete, EnqueteAlternativa } from '../../../../campeonatos/models/enquete.model';
import { EnquetesService } from '../../../../campeonatos/enquetes.service';
import { AlternativasModalComponent } from '../alternativas-modal/alternativas-modal.component';
import { VotacaoModalComponent } from '../votacao-modal/votacao-modal.component';

@Component({
  selector: 'app-editar-enquete-modal',
  templateUrl: './editar-enquete-modal.component.html',
  styleUrls: ['./editar-enquete-modal.component.scss'],
  standalone: false,
})
export class EditarEnqueteModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  /** Enquete existente — se vier, é edição; senão, criação. */
  @Input() enquete?: Enquete;

  private readonly fb = inject(FormBuilder);
  private readonly enqSrv = inject(EnquetesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly form = this.fb.nonNullable.group({
    pergunta:         ['', [Validators.required, Validators.minLength(3)]],
    visivel:          [true],
    mostrarResultado: [true],
    votacaoAberta:    [true],
    multiplaEscolha:  [false],
  });

  alternativas: EnqueteAlternativa[] = [];
  saving = false;

  ngOnInit(): void {
    if (this.enquete) {
      this.form.patchValue({
        pergunta:         this.enquete.pergunta ?? '',
        visivel:          this.enquete.visivel ?? true,
        mostrarResultado: this.enquete.mostrarResultado ?? true,
        votacaoAberta:    this.enquete.votacaoAberta ?? true,
        multiplaEscolha:  this.enquete.multiplaEscolha ?? false,
      });
      this.alternativas = (this.enquete.alternativas ?? []).map(a => ({ ...a }));
    }
  }

  get isEdicao(): boolean {
    return !!this.enquete?.id;
  }

  async abrirAlternativas(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: AlternativasModalComponent,
      componentProps: { alternativas: this.alternativas },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ alternativas?: EnqueteAlternativa[]; saved?: boolean }>();
    if (data?.saved && data.alternativas) {
      this.alternativas = data.alternativas;
    }
  }

  async verVotacao(): Promise<void> {
    if (!this.enquete) {
      await this.toast('Salve a enquete primeiro pra ver a votação.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: VotacaoModalComponent,
      componentProps: {
        enquete: this.enquete,
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await modal.present();
  }

  toggle(campo: 'visivel' | 'mostrarResultado' | 'votacaoAberta' | 'multiplaEscolha'): void {
    const ctl = this.form.controls[campo];
    ctl.setValue(!ctl.value);
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Informe a pergunta.', 'danger');
      return;
    }
    if (this.alternativas.length < 2) {
      await this.toast('Cadastre pelo menos 2 alternativas.', 'danger');
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    this.saving = true;
    try {
      const raw = this.form.getRawValue();
      const patch: Partial<Enquete> = {
        pergunta:         raw.pergunta.trim(),
        visivel:          raw.visivel,
        mostrarResultado: raw.mostrarResultado,
        votacaoAberta:    raw.votacaoAberta,
        multiplaEscolha:  raw.multiplaEscolha,
        alternativas:     this.alternativas,
      };
      if (this.isEdicao) {
        await this.enqSrv.atualizar(this.campeonatoId, this.categoriaId, this.enquete!.id!, patch);
      } else {
        await this.enqSrv.criar(this.campeonatoId, this.categoriaId, {
          pergunta:         patch.pergunta!,
          alternativas:     patch.alternativas!,
          visivel:          patch.visivel,
          mostrarResultado: patch.mostrarResultado,
          votacaoAberta:    patch.votacaoAberta,
          multiplaEscolha:  patch.multiplaEscolha,
        });
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[EditarEnqueteModal] salvar erro', err);
      await this.toast('Não foi possível salvar.', 'danger');
    } finally {
      this.saving = false;
      await loader.dismiss();
    }
  }

  async remover(): Promise<void> {
    if (!this.isEdicao) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover enquete?',
      message: 'A enquete e todos os votos serão apagados.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.enqSrv.remover(this.campeonatoId, this.categoriaId, this.enquete!.id!);
              await this.modalCtrl.dismiss({ removed: true });
            } catch (err) {
              console.error(err);
              await this.toast('Falha ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
