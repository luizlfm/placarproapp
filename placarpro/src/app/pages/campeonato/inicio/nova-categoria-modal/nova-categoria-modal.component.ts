import { Component, Input, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LoadingController, ModalController, PopoverController, ToastController } from '@ionic/angular';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { TipoFase } from '../../../../campeonatos/categoria.model';
import { MODALIDADES, Modalidade, ModalidadeId, getModalidade } from '../../../../campeonatos/modalidades';
import { ModalidadePickerComponent } from '../../../../shared/components/modalidade-picker/modalidade-picker.component';

@Component({
  selector: 'app-nova-categoria-modal',
  templateUrl: './nova-categoria-modal.component.html',
  styleUrls: ['./nova-categoria-modal.component.scss'],
  standalone: false,
})
export class NovaCategoriaModalComponent {
  @Input() campeonatoId = '';

  private readonly fb = inject(FormBuilder);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly subModalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  loading = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2)]],
    modalidade: ['futebol' as ModalidadeId, [Validators.required]],
    tipoFase: ['pontos-corridos' as TipoFase, [Validators.required]],
  });

  readonly fases: { value: TipoFase; label: string; desc: string }[] = [
    {
      value: 'pontos-corridos',
      label: 'Pontos corridos',
      desc: 'Todos contra todos, classificação por pontos.',
    },
    {
      value: 'pontos-corridos-eliminatorias',
      label: 'Pontos corridos + Eliminatórias',
      desc: 'Classificatória + mata-mata.',
    },
    {
      value: 'eliminatorias',
      label: 'Eliminatórias',
      desc: 'Chaveamento direto até a final.',
    },
  ];

  get modalidadeSelecionada(): Modalidade | undefined {
    return getModalidade(this.form.controls['modalidade'].value);
  }

  async escolherModalidade(): Promise<void> {
    const modal = await this.subModalCtrl.create({
      component: ModalidadePickerComponent,
      componentProps: { atual: this.form.controls['modalidade'].value },
      breakpoints: [0, 0.65, 1],
      initialBreakpoint: 0.85,
      handle: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ modalidade?: ModalidadeId }>();
    if (data?.modalidade) {
      this.form.controls['modalidade'].setValue(data.modalidade);
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.campeonatoId) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Criando...' });
    await loader.present();
    this.loading = true;
    try {
      const id = await this.categoriasSrv.criar(this.campeonatoId, this.form.getRawValue());
      await this.modalCtrl.dismiss({ created: true, id });
    } catch (err) {
      const t = await this.toastCtrl.create({
        message: 'Não foi possível criar a categoria.',
        duration: 3000,
        position: 'top',
        color: 'danger',
      });
      await t.present();
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }
}
