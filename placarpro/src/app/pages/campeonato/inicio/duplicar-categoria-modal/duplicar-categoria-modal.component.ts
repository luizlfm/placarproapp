import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { getModalidade, Modalidade } from '../../../../campeonatos/modalidades';

/**
 * Modal de duplicação: cria uma nova categoria a partir de uma existente,
 * com opções para copiar equipes / jogadores / partidas.
 */
@Component({
  selector: 'app-duplicar-categoria-modal',
  templateUrl: './duplicar-categoria-modal.component.html',
  styleUrls: ['./duplicar-categoria-modal.component.scss'],
  standalone: false,
})
export class DuplicarCategoriaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() source!: Categoria;

  private readonly fb = inject(FormBuilder);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  loading = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2)]],
    copiarEquipes: [true],
    copiarJogadores: [false],
    copiarPartidas: [true],
  });

  ngOnInit(): void {
    // Pré-preenche o nome com sufixo "(2)" pra dar pistas que é uma cópia.
    const baseTitulo = (this.source?.titulo || '').trim();
    this.form.controls['titulo'].setValue(baseTitulo ? `${baseTitulo} (2)` : '');
  }

  get modalidade(): Modalidade | undefined {
    return getModalidade(this.source?.modalidade);
  }

  /**
   * Jogadores só podem ser copiados se equipes também forem. Sincroniza esse
   * vínculo no toggle para evitar estado inválido na UI.
   */
  onToggleEquipes(checked: boolean): void {
    this.form.controls['copiarEquipes'].setValue(checked);
    if (!checked) {
      this.form.controls['copiarJogadores'].setValue(false);
      this.form.controls['copiarPartidas'].setValue(false);
    }
  }

  onToggleJogadores(checked: boolean): void {
    this.form.controls['copiarJogadores'].setValue(checked);
    // Habilita equipes automaticamente, já que jogadores dependem delas.
    if (checked) this.form.controls['copiarEquipes'].setValue(true);
  }

  onTogglePartidas(checked: boolean): void {
    this.form.controls['copiarPartidas'].setValue(checked);
    if (checked) this.form.controls['copiarEquipes'].setValue(true);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.campeonatoId || !this.source?.id) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const loader = await this.loadingCtrl.create({ message: 'Duplicando...' });
    await loader.present();
    this.loading = true;
    try {
      const id = await this.categoriasSrv.duplicar(
        this.campeonatoId,
        this.source.id,
        v.titulo,
        {
          copiarEquipes: !!v.copiarEquipes,
          copiarJogadores: !!v.copiarJogadores,
          copiarPartidas: !!v.copiarPartidas,
        },
      );
      await this.modalCtrl.dismiss({ created: true, id });
    } catch (err) {
      console.error('[Duplicar] falhou', err);
      const t = await this.toastCtrl.create({
        message: 'Não foi possível duplicar a categoria.',
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
