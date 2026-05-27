import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Seguidor } from '../../../campeonatos/models/seguidor.model';
import { SeguidoresService } from '../../../campeonatos/seguidores.service';

@Component({
  selector: 'app-seguidores-modal',
  templateUrl: './seguidores-modal.component.html',
  styleUrls: ['./seguidores-modal.component.scss'],
  standalone: false,
})
export class SeguidoresModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() total = 0;

  private readonly seguidoresSrv = inject(SeguidoresService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);

  private readonly buscaSubject = new BehaviorSubject<string>('');
  set busca(v: string) {
    this.buscaSubject.next(v ?? '');
  }
  get busca(): string {
    return this.buscaSubject.value;
  }

  seguidores$!: Observable<Seguidor[]>;
  filtrados$!: Observable<Seguidor[]>;

  ngOnInit(): void {
    this.seguidores$ = this.campeonatoId
      ? this.seguidoresSrv.list$(this.campeonatoId).pipe(
          startWith<Seguidor[]>([]),
          catchError(err => {
            console.error('[Seguidores] list$ erro', err);
            return of<Seguidor[]>([]);
          }),
        )
      : of<Seguidor[]>([]);

    this.filtrados$ = combineLatest([
      this.seguidores$,
      this.buscaSubject.pipe(startWith('')),
    ]).pipe(
      map(([list, busca]) => {
        const t = busca.trim().toLowerCase();
        if (!t) return list;
        return list.filter(
          s =>
            s.nome.toLowerCase().includes(t) ||
            (s.email ?? '').toLowerCase().includes(t),
        );
      }),
    );
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async copiarLink(): Promise<void> {
    const url = `${window.location.origin}/c/${this.campeonatoId}${this.categoriaId ? '/' + this.categoriaId : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      const t = await this.toastCtrl.create({
        message: 'Link copiado!',
        duration: 1800,
        position: 'top',
        color: 'success',
      });
      await t.present();
    } catch {
      const alert = await this.alertCtrl.create({
        header: 'Link público',
        message: url,
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  async removerSeguidor(s: Seguidor): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover seguidor?',
      message: `${s.nome} deixará de seguir esta categoria.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.seguidoresSrv.removerSeguidor(this.campeonatoId, s.uid);
              const t = await this.toastCtrl.create({
                message: 'Seguidor removido.',
                duration: 1800,
                position: 'top',
                color: 'success',
              });
              await t.present();
            } catch {
              const t = await this.toastCtrl.create({
                message: 'Erro ao remover.',
                duration: 1800,
                position: 'top',
                color: 'danger',
              });
              await t.present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  trackByUid(_i: number, s: Seguidor): string {
    return s.uid;
  }

  /** Recupera seguidores antigos (que estavam só em users/{uid}/seguindo). */
  async sincronizar(): Promise<void> {
    const loader = await this.loadingCtrl.create({
      message: 'Sincronizando seguidores...',
    });
    await loader.present();
    try {
      const total = await this.seguidoresSrv.sincronizarDeUsers(this.campeonatoId);
      const t = await this.toastCtrl.create({
        message: total > 0
          ? `${total} seguidor(es) recuperado(s)!`
          : 'Nenhum seguidor antigo encontrado.',
        duration: 2400,
        position: 'top',
        color: total > 0 ? 'success' : 'medium',
      });
      await t.present();
    } finally {
      await loader.dismiss();
    }
  }
}
