import { Component, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AgregadorService, EquipeAgregada } from '../../campeonatos/agregador.service';

@Component({
  selector: 'app-equipes-global',
  templateUrl: './equipes.page.html',
  styleUrls: ['./equipes.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class EquipesPage {
  private readonly agregador = inject(AgregadorService);

  readonly equipes$: Observable<EquipeAgregada[]> = this.agregador.todasEquipes$();

  trackById(_i: number, e: EquipeAgregada): string {
    return e.id ?? '';
  }
}
