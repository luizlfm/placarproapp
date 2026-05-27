import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';

/**
 * Modal 3 do fluxo de impressão de carteirinhas: seleção das
 * equipes cujos jogadores serão impressos. Permite marcar várias.
 */
@Component({
  selector: 'app-carteirinhas-equipes-modal',
  templateUrl: './carteirinhas-equipes-modal.component.html',
  styleUrls: ['./carteirinhas-equipes-modal.component.scss'],
  standalone: false,
})
export class CarteirinhasEquipesModalComponent implements OnInit {
  @Input() equipes: Equipe[] = [];

  private readonly modalCtrl = inject(ModalController);

  /** Mapa equipeId → marcado/não. */
  marcadas = new Map<string, boolean>();
  lista: Equipe[] = [];

  ngOnInit(): void {
    this.lista = [...this.equipes].sort((a, b) =>
      (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
    );
    for (const eq of this.lista) {
      if (eq.id) this.marcadas.set(eq.id, false);
    }
  }

  toggle(eq: Equipe): void {
    if (!eq.id) return;
    this.marcadas.set(eq.id, !this.marcadas.get(eq.id));
  }

  isMarcada(eq: Equipe): boolean {
    return !!(eq.id && this.marcadas.get(eq.id));
  }

  selecionarTodas(): void {
    const todasJaSelecionadas = this.lista.every(e => this.isMarcada(e));
    for (const eq of this.lista) {
      if (eq.id) this.marcadas.set(eq.id, !todasJaSelecionadas);
    }
  }

  labelLocal(eq: Equipe): string {
    const cidade = (eq as { cidade?: string }).cidade ?? '';
    const uf = (eq as { uf?: string }).uf ?? '';
    if (cidade && uf) return ` - (${cidade}/${uf})`;
    if (cidade) return ` - (${cidade})`;
    return '';
  }

  get qtdMarcadas(): number {
    return Array.from(this.marcadas.values()).filter(v => v).length;
  }

  continuar(): Promise<boolean> {
    const ids = this.lista
      .filter(e => e.id && this.marcadas.get(e.id))
      .map(e => e.id!) as string[];
    return this.modalCtrl.dismiss({ equipeIds: ids });
  }

  cancelar(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackById(_i: number, e: Equipe): string {
    return e.id ?? '';
  }
}
