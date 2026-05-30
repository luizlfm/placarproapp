import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { PatrociniosService } from '../../../campeonatos/patrocinios.service';
import { PatrocinioJogo } from '../../../campeonatos/models/patrocinio-jogo.model';
import { TransmissoesService } from '../../../campeonatos/transmissoes.service';
import { JogosService } from '../../../campeonatos/jogos.service';
import { PlanosService } from '../../../users/planos.service';

/**
 * Patrocinador atualmente em exibição na janela ativa.
 * `desbloqueado = true` significa que está na "janela de 6s".
 * `desbloqueado = false` significa que está só aguardando (oculto).
 */
interface PremiumAtivoView {
  patrocinador: {
    nome: string;
    logoUrl: string;
    tipoMidia?: 'imagem' | 'video';
    linkUrl?: string;
  };
  patrocinioId: string;
}

/** Detecta se uma URL aponta pra vídeo pela extensão. Usado como
 *  fallback quando o doc do patrocínio não tem `tipoMidia` explícito. */
function detectarTipoMidiaPorUrl(url: string): 'imagem' | 'video' {
  const u = (url || '').toLowerCase();
  if (u.includes('.mp4') || u.includes('.webm') || u.includes('.mov') || u.includes('video%2f')) {
    return 'video';
  }
  return 'imagem';
}

/**
 * Overlay PREMIUM — intersticial que aparece em "janelas" de 6 segundos
 * a cada 7 minutos a partir do início da transmissão.
 *
 * Modelo:
 *  - Lê `listarPremiumAtivos$` (todos premium com status='ativo')
 *  - Mantém um timer global ancorado em `inicioReal` da transmissão
 *  - A cada (intervaloMin × 60_000)ms abre uma "rajada"
 *  - Na rajada, exibe TODOS os patrocínios premium ativos em SEQUÊNCIA
 *    (um após o outro, 6s cada) — nunca dois ao mesmo tempo
 *  - Emite `(visibilidadeMudou)` pro container hospedeiro recolher o
 *    vídeo, esconder esteira normal e scoreboard sobreposto
 *
 * Renderização:
 *  - Posição absoluta, lateral direita do `.tr-video` / `.live-youtube` /
 *    `.live-wrap` (depende da página)
 *  - Imagem 9:16 (1080×1920) contida na proporção certa
 *  - Fade-in / fade-out de 350ms nas bordas da janela
 *  - Pointer-events: none (não bloqueia interação com vídeo)
 */
@Component({
  selector: 'app-premium-overlay',
  templateUrl: './premium-overlay.component.html',
  styleUrls: ['./premium-overlay.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PremiumOverlayComponent implements OnChanges, OnDestroy {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';

  /**
   * TEST / DEV — quando setado, força a exibição do banner imediatamente
   * (ignora timers de janela) por `forcedTest.duracaoMs` ms.
   *
   * Usado pelo botão "Testar banner premium" no jogo-detalhe pra previewar
   * o efeito sem ter que esperar 7min de transmissão.
   *
   * REMOVER quando o feature estiver validado em produção.
   */
  @Input() set forcedTest(payload: { patrocinador: { nome: string; logoUrl: string; tipoMidia?: 'imagem' | 'video' }; duracaoMs: number } | null) {
    if (!payload) return;
    const tipo = payload.patrocinador.tipoMidia ?? detectarTipoMidiaPorUrl(payload.patrocinador.logoUrl);
    this.patrocinadorAtual = {
      patrocinador: { ...payload.patrocinador, tipoMidia: tipo },
      patrocinioId: 'TEST',
    };
    this.saindoJanela = false;
    this.janelaAberta = true;
    this.visibilidadeMudou.emit(true);
    this.cdr.markForCheck();
    // No fim da duração, fecha com animação de saída (mesma curva da entrada).
    setTimeout(() => this.fecharJanela(), payload.duracaoMs);
  }

  /** Emite `true` no início da janela, `false` no fim. Container usa
   *  pra recolher o vídeo + esconder esteira/scoreboard. */
  @Output() readonly visibilidadeMudou = new EventEmitter<boolean>();

  /** Patrocinador atual na janela. `null` = sem janela ativa. */
  patrocinadorAtual: PremiumAtivoView | null = null;

  /** True nos últimos 350ms antes do fechamento — aplica classe `.saindo`
   *  no template pra animar a saída (slide-out + fade-out) com o mesmo
   *  timing/curva do efeito de entrada. */
  saindoJanela = false;

  /** Duração da animação de saída em ms (igual à entrada `premium-fade-in`). */
  private readonly ANIM_SAIDA_MS = 350;

  /** Lista de patrocínios premium ativos (exibidos em sequência na rajada). */
  private premiums: PatrocinioJogo[] = [];

  /** Início da transmissão (timestamp) — ancora pra calcular as janelas.
   *  Lemos do doc da Transmissao quando ela liga. */
  private inicioTransmissaoMs: number | null = null;

  /** Posição atual na rajada (qual patrocínio da fila está em exibição). */
  private filaBurst = 0;

  /** Estado da janela em curso. */
  private janelaAberta = false;

  private adsSub?: Subscription;
  private txSub?: Subscription;
  private jogoSub?: Subscription;
  private timerJanela?: ReturnType<typeof setTimeout>;
  private timerFecha?: ReturnType<typeof setTimeout>;

  /** Último `_testePremiumAt` visto — pra detectar mudança e disparar. */
  private ultimoTesteAtMs: number | null = null;

  private readonly patrSrv = inject(PatrociniosService);
  private readonly txSrv = inject(TransmissoesService);
  private readonly jogosSrv = inject(JogosService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly planosSrv = inject(PlanosService);

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['campeonatoId'] || ch['categoriaId'] || ch['jogoId']) {
      this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.adsSub?.unsubscribe();
    this.txSub?.unsubscribe();
    this.jogoSub?.unsubscribe();
    this.cancelarTimers();
  }

  // ════════════════════════════════════════════════════════
  // Lifecycle: subscribe na lista de premium ativos + transmissao
  // ════════════════════════════════════════════════════════

  private refresh(): void {
    this.adsSub?.unsubscribe();
    this.txSub?.unsubscribe();
    this.jogoSub?.unsubscribe();
    this.cancelarTimers();
    this.premiums = [];
    this.patrocinadorAtual = null;
    this.janelaAberta = false;
    this.filaBurst = 0;
    this.inicioTransmissaoMs = null;
    this.ultimoTesteAtMs = null;
    this.cdr.markForCheck();

    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) return;

    // ─── DEV/TEST: escuta o jogo pra detectar disparos do botão
    //     "Testar banner premium" (admin grava `_testePremiumAt`).
    //     REMOVER junto com a feature de teste. ───
    this.jogoSub = this.jogosSrv
      .get$(this.campeonatoId, this.categoriaId, this.jogoId)
      .subscribe(jogo => {
        const at = (jogo?._testePremiumAt as { toMillis?: () => number } | undefined)?.toMillis?.();
        if (!at || at === this.ultimoTesteAtMs) return;
        // Primeira vez que vemos o campo (snapshot inicial) — só guarda
        // o valor, não dispara (evita banner pop-up ao abrir a página).
        if (this.ultimoTesteAtMs === null) {
          this.ultimoTesteAtMs = at;
          return;
        }
        // Mudou desde o último visto → DISPARAR.
        this.ultimoTesteAtMs = at;

        // Se há premium ATIVOS, valida o FLUXO REAL: roda a rajada (burst)
        // mostrando TODOS os premium ativos em sequência (janela de cada um),
        // exatamente como acontece a cada `intervaloMin` durante a transmissão.
        // Assim o teste prova que múltiplos premium aparecem (round-robin).
        if (this.premiums.length > 0) {
          this.cancelarTimers();
          this.abrirJanela();
          return;
        }

        // Fallback (nenhum premium ativo): banner de teste único.
        const url = jogo?._testePremiumLogoUrl;
        const nome = jogo?._testePremiumNome ?? 'Patrocinador';
        if (!url) return;
        const tipoMidia = detectarTipoMidiaPorUrl(url);
        this.patrocinadorAtual = {
          patrocinador: { nome, logoUrl: url, tipoMidia },
          patrocinioId: 'TEST',
        };
        this.saindoJanela = false;
        this.janelaAberta = true;
        this.visibilidadeMudou.emit(true);
        this.cdr.markForCheck();
        // No fim da janela, fecha com animação de saída.
        this.timerFecha = setTimeout(
          () => this.fecharJanela(),
          this.planosSrv.premiumJanelaSeg * 1_000,
        );
      });

    this.adsSub = this.patrSrv
      .listarPremiumAtivos$(this.campeonatoId, this.categoriaId, this.jogoId)
      .subscribe(ads => {
        // Filtra patrocínios que já expiraram (defesa client-side).
        const agora = Date.now();
        this.premiums = ads.filter(a => {
          const expira = (a.expiraEm as Timestamp | null | undefined)?.toMillis?.();
          return expira == null ? true : expira > agora;
        });
        // Se a lista esvaziou e havia janela aberta, força fechar.
        if (this.premiums.length === 0 && this.janelaAberta) {
          this.fecharJanela();
        }
        // Se temos transmissão ATIVA + premiums + ainda sem timer agendado,
        // calcula próxima janela.
        if (this.premiums.length > 0 && this.inicioTransmissaoMs != null && !this.timerJanela && !this.janelaAberta) {
          this.agendarProximaJanela();
        }
        this.cdr.markForCheck();
      });

    this.txSub = this.txSrv
      .ativa$(this.campeonatoId, this.categoriaId, this.jogoId)
      .subscribe(t => {
        // Pega `iniciadoEm` da transmissão. Quando ela liga, agendamos
        // a primeira janela em `intervaloMin` minutos.
        const inicioTs = (t?.iniciadoEm as Timestamp | null | undefined)?.toMillis?.();
        if (inicioTs && inicioTs !== this.inicioTransmissaoMs) {
          this.inicioTransmissaoMs = inicioTs;
          this.cancelarTimers();
          this.janelaAberta = false;
          this.patrocinadorAtual = null;
          if (this.premiums.length > 0) this.agendarProximaJanela();
          this.cdr.markForCheck();
        }
        // Se transmissão acabou, cancela tudo.
        if (!t && this.inicioTransmissaoMs != null) {
          this.inicioTransmissaoMs = null;
          this.cancelarTimers();
          if (this.janelaAberta) this.fecharJanela();
        }
      });
  }

  // ════════════════════════════════════════════════════════
  // Timer das janelas (a cada 7min, dura 6s)
  // ════════════════════════════════════════════════════════

  /**
   * Calcula em quantos ms a próxima janela vai abrir e agenda o setTimeout.
   * A 1ª janela: `inicioTransmissao + 7min`.
   * A 2ª janela: `inicioTransmissao + 14min`. E assim por diante.
   *
   * Se já passamos da N-ésima janela e ainda estamos dentro da duração
   * dela (improvável mas possível em refresh tardio), abrimos imediatamente.
   */
  private agendarProximaJanela(): void {
    if (this.inicioTransmissaoMs == null || this.premiums.length === 0) return;

    const agora = Date.now();
    const intervaloMs = this.planosSrv.premiumIntervaloMin * 60_000;
    const duracaoMs = this.planosSrv.premiumJanelaSeg * 1_000;

    // Tempo decorrido desde início da transmissão (pode ser negativo
    // se de alguma forma o clock estiver torto — tratamos como 0).
    const decorrido = Math.max(0, agora - this.inicioTransmissaoMs);

    // Qual a próxima "âncora" de janela?
    //   âncora N = inicio + N × intervaloMs   (N>=1)
    //   primeira janela em N=1 (após 7min). Antes disso, fica oculto.
    const proximoN = Math.max(1, Math.ceil(decorrido / intervaloMs));
    const proximoAbreEm = (this.inicioTransmissaoMs + proximoN * intervaloMs) - agora;

    // Se proximoAbreEm < -duracaoMs, significa que a janela já terminou
    // (passou completamente). Avançamos pro próximo N.
    if (proximoAbreEm + duracaoMs < 0) {
      // Já passou — vamos pro próximo N
      const proxN2 = proximoN + 1;
      const tEm = (this.inicioTransmissaoMs + proxN2 * intervaloMs) - agora;
      this.timerJanela = setTimeout(() => this.abrirJanela(), Math.max(0, tEm));
      return;
    }

    // Se proximoAbreEm <= 0 mas ainda dentro da janela: abre a rajada já.
    if (proximoAbreEm <= 0) {
      this.abrirJanela();
      return;
    }

    this.timerJanela = setTimeout(() => this.abrirJanela(), proximoAbreEm);
  }

  /**
   * Abre uma "rajada": exibe TODOS os patrocínios premium ativos em
   * SEQUÊNCIA, um após o outro, `janelaDuracaoSeg` (6s) cada — sem
   * sobreposição. Quando o último termina, fecha e agenda a próxima rajada
   * no próximo intervalo (7min). Assim, com vários premium, eles aparecem
   * "seguidos um do outro" em vez de só um por janela.
   */
  private abrirJanela(): void {
    this.timerJanela = undefined;
    if (this.premiums.length === 0) return;
    this.filaBurst = 0;
    this.janelaAberta = true;
    this.visibilidadeMudou.emit(true);
    this.mostrarProximoDoBurst();
  }

  /** Exibe o próximo patrocínio da fila por 6s; ao esgotar a fila, fecha. */
  private mostrarProximoDoBurst(): void {
    // Esgotou a fila → encerra a rajada (anima saída + agenda próxima).
    if (this.filaBurst >= this.premiums.length) {
      this.fecharJanela();
      return;
    }
    const p = this.premiums[this.filaBurst];
    this.filaBurst++;
    const principal = p.patrocinadores?.[0];
    if (!principal?.logoUrl) {
      // Patrocínio sem logo — pula direto pro próximo da fila.
      this.mostrarProximoDoBurst();
      return;
    }
    // Garante que `tipoMidia` existe — fallback pela extensão da URL se o
    // doc legacy não tiver o campo definido.
    const tipoMidia = principal.tipoMidia ?? detectarTipoMidiaPorUrl(principal.logoUrl);
    this.patrocinadorAtual = {
      patrocinador: { ...principal, tipoMidia },
      patrocinioId: p.id ?? '',
    };
    this.saindoJanela = false;
    this.janelaAberta = true;
    this.visibilidadeMudou.emit(true);
    this.cdr.markForCheck();

    const duracao = this.planosSrv.premiumJanelaSeg * 1_000;
    this.timerFecha = setTimeout(() => this.mostrarProximoDoBurst(), duracao);
  }

  /** Fecha a janela atual com animação de saída (mesmo timing/curva da
   *  entrada). Sequência:
   *   1. Marca `saindoJanela = true` → CSS aplica `.saindo` que dispara
   *      `premium-fade-out` (350ms)
   *   2. Emite `visibilidadeMudou(false)` IMEDIATAMENTE pra o vídeo
   *      voltar a mostrar esteira/scoreboard com fade-in suave
   *   3. Após ANIM_SAIDA_MS, remove o nó do DOM (`patrocinadorAtual = null`)
   *   4. Agenda próxima janela
   */
  private fecharJanela(): void {
    this.timerFecha = undefined;
    if (!this.patrocinadorAtual) {
      // Já está fechado — só agenda próxima.
      this.agendarProximaJanela();
      return;
    }
    this.saindoJanela = true;
    this.visibilidadeMudou.emit(false);
    this.cdr.markForCheck();
    setTimeout(() => {
      this.janelaAberta = false;
      this.patrocinadorAtual = null;
      this.saindoJanela = false;
      this.cdr.markForCheck();
      this.agendarProximaJanela();
    }, this.ANIM_SAIDA_MS);
  }

  private cancelarTimers(): void {
    if (this.timerJanela) { clearTimeout(this.timerJanela); this.timerJanela = undefined; }
    if (this.timerFecha) { clearTimeout(this.timerFecha); this.timerFecha = undefined; }
  }
}
