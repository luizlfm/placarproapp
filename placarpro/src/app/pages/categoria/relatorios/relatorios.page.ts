import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import {
  CarteirinhasPdfService,
  TamanhoCarteirinha,
} from '../../../campeonatos/carteirinhas-pdf.service';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { CarteirinhasTamanhoModalComponent } from '../../../shared/components/carteirinhas-tamanho-modal/carteirinhas-tamanho-modal.component';
import {
  CarteirinhasConfigModalComponent,
  CarteirinhasConfigResult,
} from '../../../shared/components/carteirinhas-config-modal/carteirinhas-config-modal.component';
import { CarteirinhasEquipesModalComponent } from '../../../shared/components/carteirinhas-equipes-modal/carteirinhas-equipes-modal.component';
import { EscolherJogoSumulaModalComponent } from '../../../shared/components/escolher-jogo-sumula-modal/escolher-jogo-sumula-modal.component';
import { CarteirinhasState } from '../../../campeonatos/carteirinhas-state.service';

/**
 * Página dedicada para impressão de relatórios da categoria
 * (extraída da aba Configurações para virar item separado no menu).
 */
@Component({
  selector: 'app-cat-relatorios',
  templateUrl: './relatorios.page.html',
  styleUrls: ['./relatorios.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class RelatoriosPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly carteirinhasPdf = inject(CarteirinhasPdfService);
  private readonly carteirinhasState = inject(CarteirinhasState);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';

  imprimirEquipes(): void { this.abrirPrint('equipes'); }
  imprimirJogadores(): void { this.abrirPrint('jogadores'); }
  imprimirCarteirinhas(): void { void this.abrirCarteirinhas(); }
  imprimirPartidas(): void { this.abrirPrint('partidas'); }
  imprimirClassificacao(): void { this.abrirPrint('classificacao'); }
  imprimirRanking(): void { this.abrirPrint('rankings'); }

  /** Termo de Autorização para Menor — página com editor + preview. */
  abrirTermoMenor(): void {
    void this.router.navigate([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'relatorios', 'termo-menor',
    ]);
  }

  /**
   * Fluxo de Pré-Súmula simplificado:
   *  1. Abre seletor de jogo (`EscolherJogoSumulaModal`)
   *  2. Navega pra `/pre-sumula` — todas as opções de edição ficam IN-SCREEN
   *     num painel lateral (estilo carteirinhas-preview), sem modal extra.
   */
  async imprimirPreSumula(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;

    const jogoModal = await this.modalCtrl.create({
      component: EscolherJogoSumulaModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await jogoModal.present();
    const { data: jogoData } = await jogoModal.onDidDismiss<{ jogoIds?: string[]; jogoId?: string }>();
    // Pré-súmula é por jogo único — usa o primeiro selecionado.
    const jogoId = jogoData?.jogoIds?.[0] ?? jogoData?.jogoId;
    if (!jogoId) return;

    this.router.navigate([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'jogo', jogoId,
      'pre-sumula',
    ]);
  }

  /**
   * Botão "Cabeçalho da Pré-Súmula" — vai pra mesma tela WYSIWYG, mas sem
   * seleção de jogo (usa o primeiro jogo da categoria como "preview" pra
   * mostrar a tabela de exemplo enquanto o usuário edita o cabeçalho).
   * Se não houver nenhum jogo cadastrado, exibe um aviso.
   */
  async editarCabecalhoPreSumula(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;

    // Reusa o seletor pra deixar o usuário escolher qual jogo carregar o preview
    const modal = await this.modalCtrl.create({
      component: EscolherJogoSumulaModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ jogoIds?: string[]; jogoId?: string }>();
    const jogoId = data?.jogoIds?.[0] ?? data?.jogoId;
    if (!jogoId) return;

    this.router.navigate([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'jogo', jogoId,
      'pre-sumula',
    ]);
  }

  /** Abre a página dedicada de impressão (layout limpo A4, igual súmula). */
  private abrirPrint(tipo: string): void {
    void this.router.navigate([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'print', tipo,
    ]);
  }

  /** Súmula é por partida — navega pra página `/sumulas` com painel lateral
   *  de seleção múltipla (padrão da carteirinha-preview, sem modal). */
  async imprimirSumula(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;
    this.router.navigate([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'sumulas',
    ]);
  }

  /** Página única de carteirinhas — config inline + preview + imprimir. */
  private async abrirCarteirinhas(): Promise<void> {
    await this.router.navigate([
      '/app/campeonato', this.campeonatoId,
      'categoria', this.categoriaId,
      'carteirinhas',
    ]);
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' = 'success',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }
}
