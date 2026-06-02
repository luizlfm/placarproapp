import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { UsersService } from '../../users/users.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { Campeonato } from '../../campeonatos/campeonato.model';

@Component({
  selector: 'app-seguindo',
  templateUrl: './seguindo.page.html',
  styleUrls: ['./seguindo.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class SeguindoPage {
  private readonly users = inject(UsersService);
  private readonly campSrv = inject(CampeonatosService);
  private readonly router = inject(Router);

  readonly campeonatos$: Observable<Campeonato[]> = this.users.seguindoIds$().pipe(
    switchMap(ids => ids.length === 0 ? of<Campeonato[]>([]) : this.campSrv.listByIds$(ids)),
  );

  abrir(c: Campeonato): void {
    if (!c.id) return;
    // Rota PÚBLICA (`/:slug`) — quem segue normalmente é espectador e não
    // tem acesso à área autenticada `/app/campeonato/:id` (cairia em guard).
    this.router.navigate(['/', c.slug || c.shortCode || c.id]);
  }

  async deixarDeSeguir(ev: Event, c: Campeonato): Promise<void> {
    ev.stopPropagation();
    if (!c.id) return;
    await this.users.deixarDeSeguir(c.id);
    try { await this.campSrv.ajustarContadorSeguidores(c.id, -1); } catch { /* ignore */ }
  }

  trackById(_i: number, c: Campeonato): string {
    return c.id ?? `${_i}`;
  }
}
