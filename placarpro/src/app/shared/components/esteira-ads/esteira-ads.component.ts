import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { PatrociniosService } from '../../../campeonatos/patrocinios.service';
import { PatrocinioJogo } from '../../../campeonatos/models/patrocinio-jogo.model';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';

/** Tempo de exibição de cada logo no banner antes de rotacionar pro próximo. */
const TEMPO_ROTACAO_MS = 6_000;

/**
 * Banner rotativo de patrocínios PAGOS (créditos de ads).
 *
 * Renderização:
 *  - Caixa branca arredondada no canto INFERIOR ESQUERDO do vídeo
 *  - Mostra UM logo por vez (16:9), rotacionando a cada 6s
 *  - Transição suave de opacidade entre logos
 *  - Auto-some quando não há ads ativos (renderiza container vazio)
 *
 * Visual idêntico ao banner gratuito `.tp-banner-patrocinador` do
 * `app-transmissao-player`, pra UX consistente — espectador não distingue
 * "banner pago" vs "banner gratuito", só vê os patrocinadores da partida.
 *
 * Auto-start: o componente escuta `transmissoesSrv.ativa$()` e dispara
 * `iniciarPatrociniosDoJogo` (transição 'agendado' → 'ativo') automaticamente
 * assim que detecta transmissão ativa — funciona em QUALQUER página que
 * monte o componente. Idempotente.
 */
@Component({
  selector: 'app-esteira-ads',
  templateUrl: './esteira-ads.component.html',
  styleUrls: ['./esteira-ads.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EsteiraAdsComponent implements OnChanges, OnDestroy {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';

  /** Logos achatados de todos os patrocínios ativos (cada um com 1-2). */
  logos: Array<{ nome: string; logoUrl: string }> = [];

  /** Índice do logo atualmente visível no banner. */
  idxAtual = 0;

  /** Flag pra fade na troca — true durante transição. */
  fading = false;

  private adsSub?: Subscription;
  private txSub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private patrociniosIniciados = false;

  private readonly patrSrv = inject(PatrociniosService);
  private readonly txSrv = inject(TransmissoesService);
  private readonly cdr = inject(ChangeDetectorRef);

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['campeonatoId'] || ch['categoriaId'] || ch['jogoId']) {
      this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.adsSub?.unsubscribe();
    this.txSub?.unsubscribe();
    this.stopTimer();
  }

  private refresh(): void {
    this.adsSub?.unsubscribe();
    this.txSub?.unsubscribe();
    this.stopTimer();
    this.patrociniosIniciados = false;
    this.logos = [];
    this.idxAtual = 0;
    this.cdr.markForCheck();

    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) return;

    // Stream de patrocínios ATIVOS — alimenta a rotação do banner.
    this.adsSub = this.patrSrv
      .listarAtivos$(this.campeonatoId, this.categoriaId, this.jogoId)
      .subscribe(ads => {
        const novos = this.flatten(ads);
        const mesmaLista = this.mesmaLista(this.logos, novos);
        this.logos = novos;
        if (!mesmaLista) {
          // Reset índice se a lista mudou (ex: novo patrocínio ativado).
          this.idxAtual = 0;
          this.restartTimer();
        }
        this.cdr.markForCheck();
      });

    // Auto-start: quando aparece transmissão ATIVA, marca patrocínios
    // agendados como ativos. Idempotente.
    this.txSub = this.txSrv
      .ativa$(this.campeonatoId, this.categoriaId, this.jogoId)
      .subscribe(t => {
        if (t && !this.patrociniosIniciados) {
          this.patrociniosIniciados = true;
          this.patrSrv
            .iniciarPatrociniosDoJogo(this.campeonatoId, this.categoriaId, this.jogoId)
            .catch(err => console.warn('[EsteiraAds] erro ao iniciar patrocínios', err));
        }
      });
  }

  /** Achata patrocínios em lista plana de logos válidos (não expirados). */
  private flatten(ads: PatrocinioJogo[]): Array<{ nome: string; logoUrl: string }> {
    const agora = Date.now();
    const validos = ads.filter(a => {
      const expira = (a.expiraEm as Timestamp | null | undefined)?.toMillis?.();
      return expira == null ? true : expira > agora;
    });
    const flat: Array<{ nome: string; logoUrl: string }> = [];
    for (const a of validos) {
      for (const p of a.patrocinadores ?? []) {
        if (p.logoUrl) flat.push({ nome: p.nome, logoUrl: p.logoUrl });
      }
    }
    return flat;
  }

  /** Compara se duas listas de logos têm os mesmos itens (mesma ordem). */
  private mesmaLista(
    a: Array<{ nome: string; logoUrl: string }>,
    b: Array<{ nome: string; logoUrl: string }>,
  ): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].logoUrl !== b[i].logoUrl || a[i].nome !== b[i].nome) return false;
    }
    return true;
  }

  private restartTimer(): void {
    this.stopTimer();
    if (this.logos.length <= 1) return; // sem rotação se só há 1
    this.timer = setInterval(() => this.proximoLogo(), TEMPO_ROTACAO_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Avança pro próximo logo com fade-out → swap → fade-in. O fading
   * dura ~250ms (mesmo timing do CSS transition); durante esse período
   * `[class.fading]="fading"` aplica opacity:0 no template.
   */
  private proximoLogo(): void {
    if (this.logos.length <= 1) return;
    this.fading = true;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.idxAtual = (this.idxAtual + 1) % this.logos.length;
      this.fading = false;
      this.cdr.markForCheck();
    }, 250);
  }
}
