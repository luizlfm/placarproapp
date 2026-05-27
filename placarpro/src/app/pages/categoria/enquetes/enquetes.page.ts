import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable, firstValueFrom, of, switchMap } from 'rxjs';
import { EnquetesService } from '../../../campeonatos/enquetes.service';
import { Enquete } from '../../../campeonatos/models/enquete.model';
import { EditarEnqueteModalComponent } from './editar-enquete-modal/editar-enquete-modal.component';

@Component({
  selector: 'app-enquetes',
  templateUrl: './enquetes.page.html',
  styleUrls: ['./enquetes.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class EnquetesPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly enqSrv = inject(EnquetesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  readonly campeonatoId = this.route.parent?.snapshot.paramMap.get('id')
    ?? this.route.snapshot.paramMap.get('id')
    ?? '';
  readonly categoriaId = this.route.parent?.snapshot.paramMap.get('catId')
    ?? this.route.snapshot.paramMap.get('catId')
    ?? '';

  readonly enquetes$: Observable<Enquete[]> = this.route.paramMap.pipe(
    switchMap(() =>
      this.campeonatoId && this.categoriaId
        ? this.enqSrv.list$(this.campeonatoId, this.categoriaId)
        : of<Enquete[]>([]),
    ),
  );

  /**
   * Lê query params ao entrar:
   *  - `?novo=1` → abre modal de criação
   *  - `?editar={id}` → abre modal pra editar enquete específica
   */
  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const novo = params.get('novo');
    const editar = params.get('editar');
    if (novo === '1') {
      // Limpa query string pra não reabrir ao voltar pra essa rota
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
      setTimeout(() => this.novaEnquete(), 50);
    } else if (editar) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
      // Acha a enquete na lista atual e abre o modal
      try {
        const lista = await firstValueFrom(this.enquetes$);
        const enq = lista.find(e => e.id === editar);
        if (enq) setTimeout(() => this.abrir(enq), 50);
      } catch { /* ignore */ }
    }
  }

  async novaEnquete(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EditarEnqueteModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId:  this.categoriaId,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ saved?: boolean }>();
    if (data?.saved) {
      const t = await this.toastCtrl.create({
        message: 'Enquete criada.', duration: 2000, position: 'top', color: 'success',
      });
      await t.present();
    }
  }

  async abrir(enq: Enquete): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EditarEnqueteModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId:  this.categoriaId,
        enquete:      enq,
      },
    });
    await modal.present();
  }

  trackById(_i: number, e: Enquete): string {
    return e.id ?? `${_i}`;
  }
}
