import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
import { Subscription, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../../../../auth/auth.service';
import { RachaService } from '../../../racha.service';
import { RachaAvaliacao, RachaJogador } from '../../../models/racha.model';

/** Linha da lista — jogador + sua nota média + nota dada pelo user logado. */
interface LinhaAvaliacao {
  jogador: RachaJogador;
  media: number;
  totalVotos: number;
  /** Nota que o user logado deu (1-5) ou 0 se ainda não avaliou. */
  minhaNota: number;
}

/**
 * Página de Avaliação peer-to-peer.
 *
 * Cada jogador do racha pode avaliar todos os outros (1-5 estrelas).
 * O dono do racha (sempre logado aqui) avalia em nome próprio — em uma
 * fase futura, jogadores logados via convite podem avaliar uns aos outros.
 *
 * Salva em `rachas/{id}/avaliacoes/{avaliadorId_avaliadoId}`.
 */
@Component({
  selector: 'app-racha-avaliacao',
  templateUrl: './avaliacao.page.html',
  styleUrls: ['./avaliacao.page.scss'],
  standalone: false,
})
export class RachaAvaliacaoPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly authSrv = inject(AuthService);
  private readonly toastCtrl = inject(ToastController);

  rachaId = '';
  /** UID do user logado — usado como `avaliadorId`. */
  uid = '';
  loading = true;
  linhas: LinhaAvaliacao[] = [];
  private sub?: Subscription;
  /** Estrelas pra render (1-5). */
  readonly estrelas = [1, 2, 3, 4, 5];

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    this.uid = this.authSrv.currentUser?.uid ?? '';
    if (!this.rachaId) return;

    // combineLatest: emite quando qualquer um dos dois muda
    this.sub = combineLatest([
      this.rachaSrv.listJogadores$(this.rachaId),
      this.rachaSrv.listAvaliacoes$(this.rachaId),
    ])
      .pipe(map(([jogadores, avals]) => this.computarLinhas(jogadores, avals)))
      .subscribe(linhas => {
        this.linhas = linhas;
        this.loading = false;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Monta a tabela: pra cada jogador calcula média + minha nota. */
  private computarLinhas(
    jogadores: RachaJogador[],
    avaliacoes: RachaAvaliacao[],
  ): LinhaAvaliacao[] {
    return jogadores
      .filter(j => j.ativo !== false)
      .map(j => {
        const dele = avaliacoes.filter(a => a.avaliadoId === j.id);
        const soma = dele.reduce((s, a) => s + (a.nota ?? 0), 0);
        const media = dele.length > 0 ? soma / dele.length : 0;
        const minha = dele.find(a => a.avaliadorId === this.uid);
        return {
          jogador: j,
          media,
          totalVotos: dele.length,
          minhaNota: minha?.nota ?? 0,
        };
      })
      .sort((a, b) => b.media - a.media);
  }

  /** Salva avaliação ao clicar em uma estrela. */
  async avaliar(linha: LinhaAvaliacao, nota: number): Promise<void> {
    if (!this.uid || !linha.jogador.id) {
      this.toast('Você precisa estar logado pra avaliar.', 'warning');
      return;
    }
    // Não permite avaliar a si mesmo (se o user estiver vinculado a um jogador)
    if (linha.jogador.uidVinculado === this.uid) {
      this.toast('Você não pode avaliar a si mesmo.', 'warning');
      return;
    }
    try {
      await this.rachaSrv.salvarAvaliacao(this.rachaId, {
        avaliadorId: this.uid,
        avaliadoId: linha.jogador.id,
        nota,
      });
      // Otimista: já atualiza local (stream também vai atualizar)
      linha.minhaNota = nota;
      this.toast(`Nota ${nota} enviada!`, 'success');
    } catch (err) {
      console.error('[Avaliacao] salvar', err);
      this.toast('Erro ao salvar avaliação.', 'danger');
    }
  }

  /** Helper template — retorna 'cheia', 'metade' ou 'vazia' pra cada
   *  estrela da MÉDIA do jogador (decimal). */
  iconeMedia(estrela: number, media: number): string {
    if (media >= estrela) return 'star';
    if (media >= estrela - 0.5) return 'star-half';
    return 'star-outline';
  }

  trackByLinha(_i: number, l: LinhaAvaliacao): string {
    return l.jogador.id ?? `${_i}`;
  }

  /** Botão voltar do toolbar — segue padrão das outras pages do shell. */
  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 1800,
      position: 'top',
      color,
    });
    await t.present();
  }
}
