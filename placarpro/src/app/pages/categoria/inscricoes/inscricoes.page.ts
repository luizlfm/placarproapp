import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith, switchMap } from 'rxjs/operators';
import {
  Categoria,
  ConfigInscricoes,
  INSCRICOES_PADRAO,
  CampoFormulario,
} from '../../../campeonatos/categoria.model';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { Inscricao } from '../../../campeonatos/models/inscricao.model';
import { InscricoesService } from '../../../campeonatos/inscricoes.service';
import { FormularioCamposModalComponent } from './formulario-campos-modal/formulario-campos-modal.component';
import { NavBackService } from '../../../shared/nav-back.service';

@Component({
  selector: 'app-cat-inscricoes',
  templateUrl: './inscricoes.page.html',
  styleUrls: ['./inscricoes.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class InscricoesPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly inscricoesSrv = inject(InscricoesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly navBack = inject(NavBackService);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';

  readonly categoria$: Observable<Categoria | undefined> = this.route.paramMap.pipe(
    switchMap(p => {
      const cId = p.get('id');
      const catId = p.get('catId');
      return cId && catId ? this.categoriasSrv.get$(cId, catId) : of(undefined);
    }),
  );

  readonly inscricoes$: Observable<Inscricao[]> = this.campeonatoId && this.categoriaId
    ? this.inscricoesSrv.listPorCategoria$(this.campeonatoId, this.categoriaId).pipe(
        startWith<Inscricao[]>([]),
        catchError(() => of<Inscricao[]>([])),
      )
    : of<Inscricao[]>([]);

  /** Buffer pro textarea — só salva no blur pra não disparar 1 save por tecla. */
  informacoesBuffer = '';

  /** Lê config de inscrições mesclando com defaults. */
  cfg(cat: Categoria): ConfigInscricoes {
    return { ...INSCRICOES_PADRAO, ...(cat.inscricoes ?? {}) };
  }

  // ============ Save helper ============
  private async patch(parcial: Partial<ConfigInscricoes>, msg = 'Salvo.'): Promise<void> {
    try {
      const cat = await firstValueFrom(this.categoria$);
      if (!cat) return;
      const novo: ConfigInscricoes = { ...this.cfg(cat), ...parcial };
      await this.categoriasSrv.atualizar(this.campeonatoId, this.categoriaId, {
        inscricoes: novo,
      });
      await this.toast(msg, 'success');
    } catch (err) {
      console.error('[Inscricoes] save erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    }
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2000, position: 'top', color,
    });
    await t.present();
  }

  // ============ Configurações ============
  async toggleFechadas(cat: Categoria): Promise<void> {
    const cur = this.cfg(cat);
    await this.patch({ fechadas: !cur.fechadas }, 'Atualizado.');
  }

  inicializarBuffer(cat: Categoria): void {
    if (this.informacoesBuffer === '') {
      this.informacoesBuffer = this.cfg(cat).informacoes ?? '';
    }
  }

  async salvarInformacoes(): Promise<void> {
    const cat = await firstValueFrom(this.categoria$);
    if (!cat) return;
    const cur = this.cfg(cat);
    if ((this.informacoesBuffer ?? '') === (cur.informacoes ?? '')) return;
    await this.patch({ informacoes: this.informacoesBuffer.trim() }, 'Informações atualizadas.');
  }

  async toggleEquipe(cat: Categoria): Promise<void> {
    const cur = this.cfg(cat);
    await this.patch({ permiteEquipe: !cur.permiteEquipe }, 'Atualizado.');
  }

  async toggleJogadorIndividual(cat: Categoria): Promise<void> {
    const cur = this.cfg(cat);
    await this.patch(
      { permiteJogadorIndividual: !cur.permiteJogadorIndividual },
      'Atualizado.',
    );
  }

  async alterarLimite(valor: number): Promise<void> {
    await this.patch({ limiteJogadoresPorEquipe: valor }, 'Limite atualizado.');
  }

  onSliderChange(ev: Event): void {
    const v = parseInt((ev.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v)) {
      void this.alterarLimite(v);
    }
  }

  // ============ Formulário (campos custom) ============
  async editarCamposEquipe(cat: Categoria): Promise<void> {
    const cur = this.cfg(cat);
    await this.abrirEditorCampos(
      'Editar formulário das equipes',
      cur.camposEquipe ?? [],
      novos => this.patch({ camposEquipe: novos }, 'Formulário atualizado.'),
    );
  }

  async editarCamposJogador(cat: Categoria): Promise<void> {
    const cur = this.cfg(cat);
    await this.abrirEditorCampos(
      'Editar formulário dos jogadores',
      cur.camposJogador ?? [],
      novos => this.patch({ camposJogador: novos }, 'Formulário atualizado.'),
    );
  }

  private async abrirEditorCampos(
    titulo: string,
    campos: CampoFormulario[],
    onSave: (campos: CampoFormulario[]) => Promise<void>,
  ): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: FormularioCamposModalComponent,
      componentProps: { titulo, campos: [...campos] },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ campos?: CampoFormulario[] }>();
    if (data?.campos) await onSave(data.campos);
  }

  // ============ Inscrições (moderação) ============
  async aprovar(insc: Inscricao): Promise<void> {
    if (!insc.id) return;
    if (!insc.categoriaId) {
      const cat = await firstValueFrom(this.categoria$);
      if (!cat?.id) return;
      await this.inscricoesSrv.atualizar(this.campeonatoId, insc.id, { categoriaId: cat.id });
    }
    const loader = await this.loadingCtrl.create({ message: 'Aprovando inscrição...' });
    await loader.present();
    try {
      await this.inscricoesSrv.aprovar(this.campeonatoId, insc.id, {
        ...insc,
        categoriaId: insc.categoriaId ?? this.categoriaId,
      });
      await this.toast(`"${insc.nomeEquipe}" aprovada.`, 'success');
    } catch (err) {
      console.error('[Inscricoes] aprovar erro', err);
      await this.toast('Erro ao aprovar.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async rejeitar(insc: Inscricao): Promise<void> {
    if (!insc.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Rejeitar inscrição?',
      message: `"${insc.nomeEquipe}" será rejeitada. Você pode informar o motivo.`,
      inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Motivo (opcional)' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Rejeitar',
          role: 'destructive',
          handler: async (data: { motivo: string }) => {
            try {
              await this.inscricoesSrv.rejeitar(this.campeonatoId, insc.id!, data.motivo);
              await this.toast('Inscrição rejeitada.', 'success');
            } catch {
              await this.toast('Erro ao rejeitar.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async remover(insc: Inscricao): Promise<void> {
    if (!insc.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover inscrição?',
      message: `"${insc.nomeEquipe}" será apagada permanentemente.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.inscricoesSrv.remover(this.campeonatoId, insc.id!);
              await this.toast('Inscrição removida.', 'success');
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'config',
    ]);
  }

  trackById(_i: number, x: Inscricao): string {
    return x.id ?? '';
  }

  statusLabel(s: Inscricao['status']): string {
    switch (s) {
      case 'aprovada': return 'Aprovada';
      case 'rejeitada': return 'Rejeitada';
      default: return 'Pendente';
    }
  }
}
