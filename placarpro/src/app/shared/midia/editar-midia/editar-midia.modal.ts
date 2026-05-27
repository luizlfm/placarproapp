import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { MidiasService } from '../../../campeonatos/midias.service';
import { Midia } from '../../../campeonatos/models/midia.model';

/**
 * Modal genérico de edição de mídia para tipos que não têm modal próprio
 * (foto e vídeo da galeria). Permite editar apenas título/descrição —
 * o arquivo já está armazenado e seu URL não é alterado por aqui.
 *
 * Para youtube/link/notícia continuamos usando os modais específicos,
 * que sabem editar suas próprias particularidades (URL, embed, corpo, capa).
 */
@Component({
  selector: 'app-editar-midia-modal',
  templateUrl: './editar-midia.modal.html',
  styleUrls: ['../modal-shared.scss'],
  standalone: false,
})
export class EditarMidiaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId?: string;
  @Input() midia!: Midia;

  private readonly fb = inject(FormBuilder);
  private readonly midias = inject(MidiasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly form = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2)]],
    descricao: [''],
  });

  ngOnInit(): void {
    this.form.patchValue({
      titulo: this.midia?.titulo ?? '',
      descricao: this.midia?.descricao ?? '',
    });
  }

  /** Rótulo do tipo para o título do modal. */
  get rotuloTipo(): string {
    switch (this.midia?.tipo) {
      case 'foto':  return 'foto';
      case 'video': return 'vídeo';
      default:      return 'mídia';
    }
  }

  /** Preview da imagem/vídeo no topo (apenas leitura, não substituível aqui). */
  get previewUrl(): string | null {
    if (this.midia?.tipo === 'foto') return this.midia.arquivoUrl ?? null;
    if (this.midia?.tipo === 'video') return null; // exibimos um placeholder
    return null;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    if (this.form.invalid || !this.midia?.id) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      const { titulo, descricao } = this.form.getRawValue();
      const desc = (descricao ?? '').trim();
      await this.midias.atualizar(this.campeonatoId, this.midia.id, {
        titulo,
        descricao: desc || undefined,
      }, this.categoriaId);
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[EditarMidia] salvar erro', err);
      const t = await this.toastCtrl.create({
        message: 'Não foi possível salvar.',
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
