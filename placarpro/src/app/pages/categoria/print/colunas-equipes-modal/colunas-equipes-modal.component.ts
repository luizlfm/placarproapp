import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

export type ColunaEquipeId =
  | 'nome'
  | 'escudo'
  | 'tecnico'
  | 'link'
  | 'pontos'
  | 'jogos'
  | 'vitorias'
  | 'empates'
  | 'derrotas'
  | 'golsPro'
  | 'golsContra'
  | 'saldoGols'
  | 'golsAverage'
  | 'aproveitamento';

export interface ColunaEquipe {
  id: ColunaEquipeId;
  label: string;
  selecionado: boolean;
}

/**
 * Lista padrão de colunas — replica o modelo do copafacil exibido no screenshot.
 * Por padrão vêm marcadas: Nome, Escudo, Técnico.
 */
export const COLUNAS_EQUIPES_PADRAO: ColunaEquipe[] = [
  { id: 'nome', label: 'Nome', selecionado: true },
  { id: 'escudo', label: 'Escudo', selecionado: true },
  { id: 'tecnico', label: 'Técnico', selecionado: true },
  { id: 'pontos', label: 'Pontos', selecionado: false },
  { id: 'jogos', label: 'Jogos', selecionado: false },
  { id: 'vitorias', label: 'Vitórias', selecionado: false },
  { id: 'empates', label: 'Empate', selecionado: false },
  { id: 'derrotas', label: 'Derrotas', selecionado: false },
  { id: 'golsPro', label: 'Gols Pró', selecionado: false },
  { id: 'golsContra', label: 'Gols Contra', selecionado: false },
  { id: 'saldoGols', label: 'Saldo de Gols', selecionado: false },
  { id: 'golsAverage', label: 'Gols Average', selecionado: false },
  { id: 'aproveitamento', label: 'Aproveitamento', selecionado: false },
];

/**
 * Modal "Lista das equipes" — seleção de colunas a exibir na impressão/exportação.
 * Replica o screenshot fornecido pelo usuário.
 */
@Component({
  selector: 'app-colunas-equipes-modal',
  templateUrl: './colunas-equipes-modal.component.html',
  styleUrls: ['./colunas-equipes-modal.component.scss'],
  standalone: false,
})
export class ColunasEquipesModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Estado inicial vindo da página. */
  @Input() colunas: ColunaEquipe[] = [];

  ngOnInit(): void {
    if (this.colunas.length === 0) {
      this.colunas = COLUNAS_EQUIPES_PADRAO.map(c => ({ ...c }));
    } else {
      // Clona pra não mutar fora antes de salvar.
      this.colunas = this.colunas.map(c => ({ ...c }));
    }
  }

  toggle(c: ColunaEquipe): void {
    c.selecionado = !c.selecionado;
  }

  marcarTodas(): void {
    this.colunas = this.colunas.map(c => ({ ...c, selecionado: true }));
  }

  limpar(): void {
    this.colunas = this.colunas.map(c => ({ ...c, selecionado: false }));
  }

  qtdMarcadas(): number {
    return this.colunas.filter(c => c.selecionado).length;
  }

  salvar(): void {
    void this.modalCtrl.dismiss({ colunas: this.colunas }, 'save');
  }

  fechar(): void {
    void this.modalCtrl.dismiss(undefined, 'cancel');
  }

  trackByColuna(_i: number, c: ColunaEquipe): string {
    return c.id;
  }
}
