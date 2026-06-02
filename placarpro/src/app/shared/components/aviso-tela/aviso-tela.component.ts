import { Component, Input } from '@angular/core';
import { AvisoTela } from '../../../campeonatos/models/jogo.model';

/**
 * Faixa "lower-third" (recado ao vivo) sobreposta ao vídeo da transmissão.
 *
 * Componente puramente APRESENTACIONAL: recebe `[aviso]` (o objeto
 * `jogo.avisoTela`) e renderiza a faixa quando `ativo === true` e há texto.
 * Quem assina o jogo (detalhe / transmissão / público) passa o aviso —
 * a sincronização em tempo real vem do snapshot do Firestore lá em cima.
 *
 * Posicionamento: `:host` é absoluto no RODAPÉ do container pai (que deve
 * ser `position: relative`), tipicamente `.tr-stage` / `.live-wrap` /
 * `.live-video`. Ancorar no container (não no `.tr-video` 16:9, que
 * transborda a viewport em tela cheia) garante que a faixa fique sempre
 * dentro da área visível.
 */
@Component({
  selector: 'app-aviso-tela',
  templateUrl: './aviso-tela.component.html',
  styleUrls: ['./aviso-tela.component.scss'],
  standalone: false,
})
export class AvisoTelaComponent {
  @Input() aviso: AvisoTela | null | undefined = null;

  /** True quando há recado pra exibir (ativo + texto preenchido). */
  get visivel(): boolean {
    return !!this.aviso?.ativo && !!this.aviso?.texto?.trim();
  }
}
