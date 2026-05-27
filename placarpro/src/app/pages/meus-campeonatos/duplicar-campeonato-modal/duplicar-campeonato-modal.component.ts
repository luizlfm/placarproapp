import { Component, Input, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { Campeonato, TipoCampeonato } from '../../../campeonatos/campeonato.model';

/**
 * Modal "Criar sequência" — duplica um campeonato existente. O usuário escolhe:
 *  - Nome do novo campeonato (padrão: original + " (2)")
 *  - Subtítulo
 *  - Manter seguidores (copiar o array de UIDs)
 *  - Copiar equipes (com nomes/logos)
 *      └── Copiar jogadores (depende de equipes)
 *      └── Copiar partidas (depende de equipes — placar fica zerado)
 *  - Campeonato com categorias (mantém estrutura ou força ÚNICO)
 *
 * Submete chamando `campeonatosSrv.duplicar(originalId, options)` que retorna
 * o ID do novo campeonato e redireciona pra ele.
 */
@Component({
  selector: 'app-duplicar-campeonato-modal',
  templateUrl: './duplicar-campeonato-modal.component.html',
  styleUrls: ['./duplicar-campeonato-modal.component.scss'],
  standalone: false,
})
export class DuplicarCampeonatoModalComponent implements OnInit {
  /** Campeonato original a ser duplicado. */
  @Input() original!: Campeonato;

  private readonly fb = inject(FormBuilder);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  loading = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(3)]],
    subtitulo: [''],
    manterSeguidores: [true],
    copiarEquipes: [false],
    copiarJogadores: [{ value: false, disabled: true }],
    copiarPartidas: [{ value: false, disabled: true }],
    comCategorias: [true],
  });

  ngOnInit(): void {
    // Sufixo "(2)" padrão no nome — incentiva o user a só editar se quiser
    this.form.patchValue({
      titulo: `${this.original.titulo} (2)`,
      subtitulo: this.original.subtitulo || '',
      comCategorias: this.original.tipo !== 'unico',
    });

    // Dependência: jogadores e partidas só fazem sentido se equipes for marcado.
    // Quando equipes muda, habilita/desabilita os dois filhos.
    this.form.controls['copiarEquipes'].valueChanges.subscribe((on: boolean) => {
      const cj = this.form.controls['copiarJogadores'];
      const cp = this.form.controls['copiarPartidas'];
      if (on) {
        cj.enable({ emitEvent: false });
        cp.enable({ emitEvent: false });
      } else {
        cj.setValue(false, { emitEvent: false });
        cp.setValue(false, { emitEvent: false });
        cj.disable({ emitEvent: false });
        cp.disable({ emitEvent: false });
      }
    });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async submit(): Promise<void> {
    if (this.form.controls['titulo'].invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Duplicando campeonato...' });
    await loader.present();
    this.loading = true;
    try {
      const v = this.form.getRawValue();
      const tipo: TipoCampeonato = v.comCategorias ? 'com-categorias' : 'unico';

      const novoId = await this.campeonatosSrv.duplicar(this.original.id!, {
        titulo: v.titulo,
        subtitulo: v.subtitulo,
        tipo,
        manterSeguidores: !!v.manterSeguidores,
        copiarEquipes: !!v.copiarEquipes,
        copiarJogadores: !!v.copiarJogadores,
        copiarPartidas: !!v.copiarPartidas,
      });

      await this.modalCtrl.dismiss({ created: true, id: novoId });
      await this.router.navigate(['/app/campeonato', novoId]);
    } catch (err) {
      const t = await this.toastCtrl.create({
        message: this.errorMessage(err),
        duration: 3000,
        position: 'top',
        color: 'danger',
        buttons: [{ text: 'OK', role: 'cancel' }],
      });
      await t.present();
    } finally {
      this.loading = false;
      await loader.dismiss();
    }
  }

  private errorMessage(err: unknown): string {
    const code = (err as { code?: string })?.code;
    if (code === 'permission-denied') {
      return 'Sem permissão. Verifique as Firestore Security Rules.';
    }
    return (err as Error)?.message || 'Não foi possível duplicar o campeonato.';
  }
}
