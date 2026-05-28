import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, firstValueFrom, of, switchMap } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { LinhaRanking, RankingsService, TipoRanking } from '../../../campeonatos/rankings.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { ExportRankingsService } from '../../../campeonatos/export-rankings.service';
import { EnquetesService } from '../../../campeonatos/enquetes.service';
import { Enquete } from '../../../campeonatos/models/enquete.model';
import {
  ModeradorPermissoesService,
  PermissoesEfetivas,
} from '../../../shared/moderador-permissoes.service';

interface Tab {
  id: TipoRanking;
  label: string;
  icon: string;
  cor: string;
}

@Component({
  selector: 'app-rankings',
  templateUrl: './rankings.page.html',
  styleUrls: ['./rankings.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class RankingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rankSrv = inject(RankingsService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly exportSrv = inject(ExportRankingsService);
  private readonly enqSrv = inject(EnquetesService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);
  private readonly modPerms = inject(ModeradorPermissoesService);
  exportando = false;

  readonly campeonatoId = this.route.parent?.snapshot.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId = this.route.parent?.snapshot.paramMap.get('catId') ?? this.route.snapshot.paramMap.get('catId') ?? '';

  /** Permissões efetivas no campeonato — usado pra esconder os botões de
   *  "Criar votação" e "Tocar para editar" pra moderadores sem
   *  `gerenciarEnquetes`. Owner/admin sempre passam (tudo true). */
  readonly permissoes$: Observable<PermissoesEfetivas> = this.campeonatoId
    ? this.modPerms.efetivas$(this.campeonatoId)
    : of<PermissoesEfetivas>({
        nivel: 'nenhum',
        editarCampeonato: false,
        gerenciarEquipes: false,
        editarResultados: false,
        enviarMidias: false,
        gerenciarEnquetes: false,
      });

  readonly tabs: Tab[] = [
    { id: 'artilharia',  label: 'Artilharia',   icon: 'football-outline',         cor: '#1C2E3D' },
    { id: 'assistencia', label: 'Assistências', icon: 'people-outline',           cor: '#4DABF7' },
    { id: 'amarelos',    label: 'Amarelos',     icon: 'card-outline',             cor: '#F1B500' },
    { id: 'vermelhos',   label: 'Vermelhos',    icon: 'card',                     cor: '#E55353' },
  ];

  readonly tipoSubject = new BehaviorSubject<TipoRanking>('artilharia');

  readonly linhas$: Observable<LinhaRanking[]> =
    this.campeonatoId && this.categoriaId
      ? this.tipoSubject.pipe(
          switchMap(tipo => this.rankSrv.ranking$(this.campeonatoId, this.categoriaId, tipo)),
        )
      : of([]);

  /** Enquetes existentes da categoria (pra mostrar abaixo dos rankings). */
  readonly enquetes$: Observable<Enquete[]> =
    this.campeonatoId && this.categoriaId
      ? this.enqSrv.list$(this.campeonatoId, this.categoriaId).pipe(
          startWith<Enquete[]>([]),
          catchError(err => {
            console.warn('[Rankings] enquetes$ erro', err);
            return of<Enquete[]>([]);
          }),
        )
      : of<Enquete[]>([]);

  /** Navega pra página de enquetes — opcionalmente com flag pra abrir modal de criação. */
  irParaEnquetes(modo: 'novo' | 'lista' | string = 'lista'): void {
    if (!this.campeonatoId || !this.categoriaId) return;
    const base = `/app/campeonato/${this.campeonatoId}/categoria/${this.categoriaId}/enquetes`;
    if (modo === 'novo') {
      this.router.navigate([base], { queryParams: { novo: 1 } });
    } else if (modo && modo !== 'lista') {
      // modo é um enqueteId — abre direto pra edição
      this.router.navigate([base], { queryParams: { editar: modo } });
    } else {
      this.router.navigate([base]);
    }
  }

  get tipoAtual(): TipoRanking {
    return this.tipoSubject.value;
  }

  selecionarTipo(t: TipoRanking): void {
    if (t === this.tipoSubject.value) return;
    this.tipoSubject.next(t);
  }

  trackById(_i: number, l: LinhaRanking): string {
    return l.jogador.id ?? `${_i}`;
  }

  trackByEnquete(_i: number, e: Enquete): string {
    return e.id ?? `${_i}`;
  }

  /** % de votos da alternativa em relação ao total. */
  percentualEnq(enquete: Enquete, votos: number): number {
    const total = enquete.totalVotos ?? 0;
    if (total <= 0) return 0;
    return Math.round((votos / total) * 100);
  }

  /** Helper pra colorir o badge do top 3. */
  corMedalha(pos: number): string | null {
    if (pos === 1) return '#FFD43B'; // ouro
    if (pos === 2) return '#CED4DA'; // prata
    if (pos === 3) return '#E8A87C'; // bronze
    return null;
  }

  async exportar(formato: 'pdf' | 'png'): Promise<void> {
    if (this.exportando) return;
    if (!this.campeonatoId || !this.categoriaId) return;
    this.exportando = true;
    const loader = await this.loadingCtrl.create({
      message: formato === 'pdf' ? 'Gerando PDF...' : 'Gerando imagem...',
    });
    await loader.present();
    try {
      const [linhas, campeonato, categoria] = await Promise.all([
        firstValueFrom(this.linhas$),
        firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId)),
        firstValueFrom(this.categoriasSrv.get$(this.campeonatoId, this.categoriaId)),
      ]);
      if (!linhas || linhas.length === 0) {
        await this.toast('Nada pra exportar ainda nesse ranking.', 'warning');
        return;
      }
      const ctx = this.exportSrv.buildContext(
        this.tipoAtual,
        linhas,
        campeonato,
        categoria,
      );
      if (formato === 'pdf') {
        await this.exportSrv.exportarPdf(ctx, this.toastCtrl, this.modalCtrl);
      } else {
        await this.exportSrv.exportarImagem(ctx);
      }
      await this.toast(
        formato === 'pdf' ? 'PDF gerado!' : 'Imagem gerada!',
        'success',
      );
    } catch (err) {
      console.error('[Rankings] exportar erro', err);
      await this.toast('Erro ao gerar arquivo.', 'danger');
    } finally {
      this.exportando = false;
      await loader.dismiss();
    }
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
