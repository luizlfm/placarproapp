import { Component, inject, Input, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { MidiasService } from '../../../campeonatos/midias.service';
import { Midia } from '../../../campeonatos/models/midia.model';

@Component({
  selector: 'app-youtube-modal',
  templateUrl: './youtube.modal.html',
  styleUrls: ['../modal-shared.scss'],
  standalone: false,
})
export class YoutubeModalComponent implements OnInit {
  @Input() campeonatoId = '';
  /** Opcional: escopo da categoria. */
  @Input() categoriaId?: string;
  /** Quando passado, o modal entra em modo edição. */
  @Input() midia?: Midia;

  private readonly fb = inject(FormBuilder);
  private readonly midias = inject(MidiasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly form = this.fb.nonNullable.group({
    url: ['', [Validators.required]],
    titulo: ['', [Validators.required, Validators.minLength(2)]],
    descricao: [''],
  });

  ngOnInit(): void {
    if (this.midia) {
      // No modo edição preferimos a URL completa quando ela foi salva;
      // se não temos, montamos uma URL canônica a partir do youtubeId.
      const url = this.midia.url
        || (this.midia.youtubeId ? `https://www.youtube.com/watch?v=${this.midia.youtubeId}` : '');
      this.form.patchValue({
        url,
        titulo: this.midia.titulo ?? '',
        descricao: this.midia.descricao ?? '',
      });
    }
  }

  get editando(): boolean { return !!this.midia?.id; }

  get youtubeId(): string | null {
    const raw = this.form.controls.url.value;
    return MidiasService.parseYoutubeId(raw);
  }

  /**
   * URL da thumbnail (hqdefault = 480×360). Usamos imagem em vez de iframe
   * pra evitar que o player do YouTube capture toques/scroll e impeça o
   * usuário de rolar até os campos "Título" e "Descrição" abaixo do preview.
   */
  get thumbUrl(): string | null {
    const id = this.youtubeId;
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  }

  /** Abre o vídeo na aba nova quando o usuário clica na thumb. */
  abrirVideo(): void {
    const id = this.youtubeId;
    if (!id) return;
    window.open(`https://www.youtube.com/watch?v=${id}`, '_blank', 'noopener');
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    const youtubeId = this.youtubeId;
    if (this.form.invalid || !youtubeId) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      const { titulo, descricao, url } = this.form.getRawValue();
      if (this.editando && this.midia?.id) {
        await this.midias.atualizar(this.campeonatoId, this.midia.id, {
          titulo,
          descricao: descricao || undefined,
          youtubeId,
          url,
        }, this.categoriaId);
      } else {
        await this.midias.criar(this.campeonatoId, {
          campeonatoId: this.campeonatoId,
          categoriaId: this.categoriaId,
          tipo: 'youtube',
          titulo,
          descricao: descricao || undefined,
          youtubeId,
          url,
        }, this.categoriaId);
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      const t = await this.toastCtrl.create({
        message: 'Não foi possível salvar o vídeo.',
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
