import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

/** Representa uma equipe selecionável no modal. */
export interface EquipeSelecaoJog {
  id: string;
  nome: string;
  logoUrl?: string;
  qtd: number;          // qtd de jogadores cadastrados
  selecionado: boolean;
}

/**
 * Modal de seleção de equipes para o relatório "Relação de Jogadores".
 * Substitui os chips inline na barra de controles — fica mais limpo em
 * mobile e dá mais espaço pra mostrar logos + contagem por equipe.
 *
 * Retorna `{ equipes }` via dismiss('save'). Inclui também atalhos de
 * "Marcar todas" / "Limpar".
 */
@Component({
  selector: 'app-equipes-jogadores-modal',
  templateUrl: './equipes-jogadores-modal.component.html',
  styleUrls: ['./equipes-jogadores-modal.component.scss'],
  standalone: false,
})
export class EquipesJogadoresModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Lista inicial vinda da página — copiada localmente pra não mutar. */
  @Input() equipes: EquipeSelecaoJog[] = [];

  ngOnInit(): void {
    this.equipes = this.equipes.map(e => ({ ...e }));
  }

  toggle(e: EquipeSelecaoJog): void {
    e.selecionado = !e.selecionado;
  }

  marcarTodas(): void {
    this.equipes = this.equipes.map(e => ({ ...e, selecionado: true }));
  }

  limpar(): void {
    this.equipes = this.equipes.map(e => ({ ...e, selecionado: false }));
  }

  qtdMarcadas(): number {
    return this.equipes.filter(e => e.selecionado).length;
  }

  salvar(): void {
    void this.modalCtrl.dismiss({ equipes: this.equipes }, 'save');
  }

  fechar(): void {
    void this.modalCtrl.dismiss();
  }

  trackById(_i: number, e: EquipeSelecaoJog): string {
    return e.id;
  }
}
