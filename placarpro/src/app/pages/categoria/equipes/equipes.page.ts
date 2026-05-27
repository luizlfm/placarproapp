import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Grupo } from '../../../campeonatos/models/grupo.model';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { GruposService } from '../../../campeonatos/grupos.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { ConvitesEquipeService } from '../../../campeonatos/convites-equipe.service';
import { AuthService } from '../../../auth/auth.service';
import { EquipeModalComponent } from './equipe-modal/equipe-modal.component';
import { JogadorModalComponent } from './jogador-modal/jogador-modal.component';

interface EquipeView extends Equipe {
  grupoNome?: string;
}

@Component({
  selector: 'app-cat-equipes',
  templateUrl: './equipes.page.html',
  styleUrls: ['./equipes.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class EquipesPage {
  private readonly route = inject(ActivatedRoute);
  private readonly equipesSrv = inject(EquipesService);
  private readonly gruposSrv = inject(GruposService);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly convitesSrv = inject(ConvitesEquipeService);
  private readonly authSrv = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.snapshot.paramMap.get('catId') ?? '';

  novoNome = '';
  criando = false;
  erro = '';

  /** Termo de busca (filtra equipes pela lista carregada). */
  private readonly buscaSubject = new BehaviorSubject<string>('');
  set busca(v: string) {
    this.buscaSubject.next(v ?? '');
  }
  get busca(): string {
    return this.buscaSubject.value;
  }

  readonly equipes$: Observable<EquipeView[]> = (
    this.campeonatoId && this.categoriaId
      ? combineLatest([
          this.equipesSrv.list$(this.campeonatoId, this.categoriaId).pipe(
            startWith<Equipe[]>([]),
            catchError(err => {
              console.error('[Equipes] list$ erro', err);
              this.erro = 'Não foi possível carregar equipes. Verifique sua conexão e regras do Firestore.';
              return of<Equipe[]>([]);
            }),
          ),
          this.gruposSrv.list$(this.campeonatoId, this.categoriaId).pipe(
            startWith<Grupo[]>([]),
            catchError(() => of<Grupo[]>([])),
          ),
          this.buscaSubject.pipe(startWith('')),
        ]).pipe(
          map(([eqs, grupos, busca]) => {
            const termo = busca.trim().toLowerCase();
            const view: EquipeView[] = eqs.map(e => ({
              ...e,
              grupoNome: grupos.find(g => g.id === e.grupoId)?.nome,
            }));
            return termo
              ? view.filter(
                  e =>
                    e.nome.toLowerCase().includes(termo) ||
                    (e.cidade ?? '').toLowerCase().includes(termo) ||
                    (e.tecnico ?? '').toLowerCase().includes(termo) ||
                    (e.grupoNome ?? '').toLowerCase().includes(termo),
                )
              : view;
          }),
        )
      : of<EquipeView[]>([])
  );

  async adicionarRapido(): Promise<void> {
    const nome = this.novoNome.trim();
    if (!nome) return;
    this.criando = true;
    this.erro = '';
    try {
      await this.equipesSrv.criar(this.campeonatoId, this.categoriaId, { nome });
      this.novoNome = '';
      await this.showToast(`Equipe "${nome}" criada.`, 'success');
    } catch (err) {
      console.error('[Equipes] criar falhou', err);
      await this.showToast('Não foi possível criar a equipe. Verifique permissões.', 'danger');
    } finally {
      this.criando = false;
    }
  }

  async abrirEditarEquipe(eq: Equipe): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EquipeModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipeExistente: eq,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  async abrirJogadores(eq: Equipe): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: JogadorModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipe: eq,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  async confirmarRemover(eq: Equipe): Promise<void> {
    if (!eq.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover equipe?',
      message: `"${eq.nome}" e seus jogadores serão removidos. Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.equipesSrv.remover(this.campeonatoId, this.categoriaId, eq.id!);
              await this.showToast('Equipe removida.', 'success');
            } catch (err) {
              console.error('[Equipes] remover falhou', err);
              await this.showToast('Erro ao remover equipe.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * Gera link público de inscrição vinculado à equipe. O dono da equipe
   * abre o link e preenche os atletas em uma página igual à ficha impressa.
   * Mostra alerta com link copiável + opção de compartilhar via WhatsApp.
   */
  async gerarLinkInscricao(eq: Equipe): Promise<void> {
    if (!eq.id) return;
    const uid = this.authSrv.currentUser?.uid;
    if (!uid) {
      await this.showToast('Você precisa estar logado.', 'danger');
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Gerando link...' });
    await loader.present();
    try {
      const [camp, cat] = await Promise.all([
        firstValueFrom(this.campsSrv.get$(this.campeonatoId)),
        firstValueFrom(this.catsSrv.get$(this.campeonatoId, this.categoriaId)),
      ]);
      const token = await this.convitesSrv.criarOuRecuperar(
        this.campeonatoId,
        this.categoriaId,
        eq.id,
        uid,
        eq.nome,
        camp?.titulo,
        cat?.titulo ?? camp?.subtitulo,
      );
      // Salva o token na equipe pra que o modal possa oferecer "Reabrir ficha"
      // sem precisar listar a coleção `convitesEquipe` (que tem list:false).
      try {
        await this.equipesSrv.atualizar(this.campeonatoId, this.categoriaId, eq.id, {
          inscricaoToken: token,
        });
      } catch (err) {
        console.warn('[equipes] não foi possível salvar inscricaoToken na equipe', err);
      }
      const url = `${location.origin}/inscricao/${token}`;
      await loader.dismiss();

      const msg = `Olá! Aqui está o link para preencher os atletas da equipe *${eq.nome}* no ${camp?.titulo ?? 'campeonato'}:%0A%0A${encodeURIComponent(url)}`;
      const alert = await this.alertCtrl.create({
        header: 'Link de inscrição gerado',
        message: `Envie este link para o responsável pela equipe preencher os atletas:<br><br><strong style="word-break:break-all">${url}</strong>`,
        buttons: [
          {
            text: 'Copiar',
            handler: async () => {
              try {
                await navigator.clipboard.writeText(url);
                await this.showToast('Link copiado!', 'success');
              } catch {
                await this.showToast(url, 'success');
              }
            },
          },
          {
            text: 'WhatsApp',
            handler: () => {
              window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener');
            },
          },
          { text: 'Fechar', role: 'cancel' },
        ],
      });
      await alert.present();
    } catch (err) {
      console.error('[Equipes] gerar link erro', err);
      await loader.dismiss();
      await this.showToast('Falha ao gerar link.', 'danger');
    }
  }

  limparBusca(): void {
    this.busca = '';
  }

  trackById(_i: number, e: Equipe): string {
    return e.id ?? '';
  }

  private async showToast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
