import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { TipoCampeonato } from '../../../campeonatos/campeonato.model';
import { TipoFase } from '../../../campeonatos/categoria.model';
import {
  Modalidade,
  ModalidadeId,
  getModalidade,
} from '../../../campeonatos/modalidades';
import { ModalidadePickerComponent } from '../../../shared/components/modalidade-picker/modalidade-picker.component';

type Step = 'tipo' | 'detalhes';

@Component({
  selector: 'app-novo-campeonato-modal',
  templateUrl: './novo-campeonato-modal.component.html',
  styleUrls: ['./novo-campeonato-modal.component.scss'],
  standalone: false,
})
export class NovoCampeonatoModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  step: Step = 'tipo';
  loading = false;
  tipoEscolhido: TipoCampeonato | null = null;

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(3)]],
    /** Usado apenas quando tipo === 'unico'. */
    modalidade: ['futebol' as ModalidadeId],
    /** Usado apenas quando tipo === 'unico'. */
    tipoFase: ['pontos-corridos' as TipoFase],
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

  get isUnico(): boolean {
    return this.tipoEscolhido === 'unico';
  }

  get modalidadeSelecionada(): Modalidade | undefined {
    return getModalidade(this.form.controls['modalidade'].value);
  }

  escolherTipo(tipo: TipoCampeonato): void {
    this.tipoEscolhido = tipo;
    this.step = 'detalhes';
  }

  voltar(): void {
    this.step = 'tipo';
  }

  async escolherModalidade(): Promise<void> {
    const modal = await this.modalCtrl.create({
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
    if (this.form.controls['titulo'].invalid || !this.tipoEscolhido) {
      this.form.markAllAsTouched();
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Criando...' });
    await loader.present();
    this.loading = true;
    try {
      const { titulo, modalidade, tipoFase } = this.form.getRawValue();

      const campeonatoId = await this.campeonatosSrv.criar({
        titulo,
        tipo: this.tipoEscolhido,
      });

      // Para campeonato único, criamos automaticamente 1 categoria
      // já com a modalidade e tipo de fase escolhidos. E navegamos
      // direto pra DENTRO dessa categoria — não faz sentido cair na
      // tela do campeonato com lista de categorias quando só vai existir
      // uma. O user vai direto pra Equipes/Jogos/Classificação.
      if (this.tipoEscolhido === 'unico') {
        const categoriaId = await this.categoriasSrv.criar(campeonatoId, {
          titulo: 'Categoria principal',
          modalidade,
          tipoFase,
        });
        // Denormaliza o ID da categoria no documento do campeonato para
        // permitir navegação instantânea (zero query extra) em todos os
        // pontos de entrada do campeonato único.
        await this.campeonatosSrv.atualizar(campeonatoId, { categoriaPrincipalId: categoriaId });
        await this.modalCtrl.dismiss({ created: true, id: campeonatoId });
        await this.router.navigate([
          '/app/campeonato', campeonatoId, 'categoria', categoriaId, 'inicio',
        ]);
        return;
      }

      // Campeonato COM categorias — cai na tela do campeonato pra o user
      // adicionar as categorias manualmente (fluxo original).
      await this.modalCtrl.dismiss({ created: true, id: campeonatoId });
      await this.router.navigate(['/app/campeonato', campeonatoId]);
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
    return 'Não foi possível criar o campeonato. Tente novamente.';
  }
}
