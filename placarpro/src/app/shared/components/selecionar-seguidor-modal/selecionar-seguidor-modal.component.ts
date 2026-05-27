import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Seguidor } from '../../../campeonatos/models/seguidor.model';
import { SeguidoresService } from '../../../campeonatos/seguidores.service';

/**
 * Picker: lista os seguidores do campeonato e devolve o escolhido
 * pra ser promovido a moderador. Filtra os que já são moderadores.
 */
@Component({
  selector: 'app-selecionar-seguidor-modal',
  templateUrl: './selecionar-seguidor-modal.component.html',
  styleUrls: ['./selecionar-seguidor-modal.component.scss'],
  standalone: false,
})
export class SelecionarSeguidorModalComponent implements OnInit {
  @Input() campeonatoId = '';
  /** UIDs dos moderadores já cadastrados (pra esconder da lista). */
  @Input() jaModeradores: string[] = [];

  private readonly seguidoresSrv = inject(SeguidoresService);
  private readonly modalCtrl = inject(ModalController);

  private readonly buscaSubject = new BehaviorSubject<string>('');
  set busca(v: string) {
    this.buscaSubject.next(v ?? '');
  }
  get busca(): string {
    return this.buscaSubject.value;
  }

  candidatos$!: Observable<Seguidor[]>;

  ngOnInit(): void {
    const base$ = this.seguidoresSrv.list$(this.campeonatoId).pipe(
      startWith<Seguidor[]>([]),
      catchError(() => of<Seguidor[]>([])),
    );

    this.candidatos$ = combineLatest([
      base$,
      this.buscaSubject.pipe(startWith('')),
    ]).pipe(
      map(([list, busca]) => {
        const moderadores = new Set(this.jaModeradores);
        const t = busca.trim().toLowerCase();
        let arr = list.filter(s => !moderadores.has(s.uid));
        if (t) {
          arr = arr.filter(
            s =>
              s.nome.toLowerCase().includes(t) ||
              (s.email ?? '').toLowerCase().includes(t),
          );
        }
        return arr;
      }),
    );
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  escolher(s: Seguidor): Promise<boolean> {
    return this.modalCtrl.dismiss({ seguidor: s });
  }

  trackByUid(_i: number, s: Seguidor): string {
    return s.uid;
  }
}
