import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { MidiasService } from '../../../campeonatos/midias.service';
import { Midia } from '../../../campeonatos/models/midia.model';

@Component({
  selector: 'app-adicionar-link-modal',
  templateUrl: './adicionar-link.modal.html',
  styleUrls: ['../modal-shared.scss'],
  standalone: false,
})
export class AdicionarLinkModalComponent implements OnInit {
  @Input() campeonatoId = '';
  /** Opcional: quando definido, salva a mídia dentro da categoria. */
  @Input() categoriaId?: string;
  /** Quando passado, o modal entra em modo edição (patch + update). */
  @Input() midia?: Midia;

  private readonly fb = inject(FormBuilder);
  private readonly midias = inject(MidiasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly form = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2)]],
    url: ['', [Validators.required, Validators.pattern(/^https?:\/\/.+/i)]],
    descricao: [''],
  });

  ngOnInit(): void {
    if (this.midia) {
      this.form.patchValue({
        titulo: this.midia.titulo ?? '',
        url: this.midia.url ?? '',
        descricao: this.midia.descricao ?? '',
      });
    }
  }

  /** True quando estamos editando uma mídia existente. */
  get editando(): boolean { return !!this.midia?.id; }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      const { titulo, url, descricao } = this.form.getRawValue();
      const desc = (descricao ?? '').trim();
      if (this.editando && this.midia?.id) {
        await this.midias.atualizar(this.campeonatoId, this.midia.id, {
          titulo,
          url,
          descricao: desc || undefined,
        }, this.categoriaId);
      } else {
        await this.midias.criar(this.campeonatoId, {
          campeonatoId: this.campeonatoId,
          categoriaId: this.categoriaId,
          tipo: 'link',
          titulo,
          url,
          descricao: desc || undefined,
        }, this.categoriaId);
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[AdicionarLinkModal] salvar erro', err);
      const t = await this.toastCtrl.create({
        message: 'Não foi possível salvar o link.',
        duration: 2400,
        position: 'top',
        color: 'danger',
      });
      await t.present();
    } finally {
      await loader.dismiss();
    }
  }
}
