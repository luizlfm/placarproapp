import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { MidiasService } from '../../../campeonatos/midias.service';
import { Midia } from '../../../campeonatos/models/midia.model';

@Component({
  selector: 'app-criar-noticia-modal',
  templateUrl: './criar-noticia.modal.html',
  styleUrls: ['../modal-shared.scss', './criar-noticia.modal.scss'],
  standalone: false,
})
export class CriarNoticiaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  /** Opcional: escopo da categoria. */
  @Input() categoriaId?: string;
  /** Quando definido, abre em modo edição/leitura. */
  @Input() midia?: Midia;

  private readonly fb = inject(FormBuilder);
  private readonly midias = inject(MidiasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  @ViewChild('capaPicker') capaPicker?: ElementRef<HTMLInputElement>;

  capaUrl: string | null = null;
  capaPath: string | null = null;
  /** Arquivo da capa selecionado, ainda não enviado. Upload acontece no salvar. */
  private capaFile: File | null = null;

  readonly form = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2)]],
    subtitulo: [''],
    corpo: ['', [Validators.required, Validators.minLength(5)]],
  });

  ngOnInit(): void {
    if (this.midia) {
      this.form.patchValue({
        titulo: this.midia.titulo ?? '',
        subtitulo: this.midia.descricao ?? '',
        corpo: this.midia.corpo ?? '',
      });
      this.capaUrl = this.midia.capaUrl ?? null;
      this.capaPath = this.midia.capaPath ?? null;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  escolherCapa(): void {
    this.capaPicker?.nativeElement.click();
  }

  onCapaEscolhida(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    this.capaFile = file;
    const reader = new FileReader();
    reader.onload = () => { this.capaUrl = reader.result as string; };
    reader.readAsDataURL(file);
  }

  removerCapa(ev: Event): void {
    ev.stopPropagation();
    this.capaFile = null;
    this.capaUrl = null;
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      let capaUrl = this.midia?.capaUrl ?? undefined;
      let capaPath = this.midia?.capaPath ?? undefined;

      if (this.capaFile) {
        const up = await this.midias.uploadArquivo(this.campeonatoId, this.capaFile, this.categoriaId);
        capaUrl = up.url;
        capaPath = up.path;
      } else if (!this.capaUrl) {
        capaUrl = undefined;
        capaPath = undefined;
      }

      const { titulo, subtitulo, corpo } = this.form.getRawValue();
      if (this.midia?.id) {
        await this.midias.atualizar(this.campeonatoId, this.midia.id, {
          titulo,
          descricao: subtitulo || undefined,
          corpo,
          capaUrl,
          capaPath,
        }, this.categoriaId);
      } else {
        await this.midias.criar(this.campeonatoId, {
          campeonatoId: this.campeonatoId,
          categoriaId: this.categoriaId,
          tipo: 'noticia',
          titulo,
          descricao: subtitulo || undefined,
          corpo,
          capaUrl,
          capaPath,
        }, this.categoriaId);
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error(err);
      const t = await this.toastCtrl.create({
        message: 'Não foi possível salvar a notícia.',
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
