import { Component, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AgregadorService, JogadorAgregado } from '../../campeonatos/agregador.service';

@Component({
  selector: 'app-jogadores-global',
  templateUrl: './jogadores.page.html',
  styleUrls: ['./jogadores.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class JogadoresPage {
  private readonly agregador = inject(AgregadorService);

  readonly jogadores$: Observable<JogadorAgregado[]> = this.agregador.todosJogadores$();

  trackById(_i: number, j: JogadorAgregado): string {
    return j.id ?? '';
  }
}
