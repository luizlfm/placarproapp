import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';

/** IDs das colunas configuráveis da tabela de jogadores. */
export type ColunaJogadorId =
  | 'foto'
  | 'camisa'
  | 'nome'
  | 'apelido'
  | 'posicao'
  | 'nascimento'
  | 'documento'
  | 'telefone';

export interface ColunaJogador {
  id: ColunaJogadorId;
  label: string;
  selecionado: boolean;
}

/**
 * Conjunto padrão de colunas pra impressão de jogadores. Apenas as colunas
 * essenciais vêm marcadas; o restante o usuário liga sob demanda.
 */
export const COLUNAS_JOGADORES_PADRAO: ColunaJogador[] = [
  { id: 'foto',       label: 'Foto',           selecionado: false },
  { id: 'camisa',     label: 'Camisa',         selecionado: true },
  { id: 'nome',       label: 'Nome',           selecionado: true },
  { id: 'apelido',    label: 'Apelido',        selecionado: true },
  { id: 'posicao',    label: 'Posição',        selecionado: true },
  { id: 'nascimento', label: 'Nascimento',     selecionado: true },
  { id: 'documento',  label: 'Documento',      selecionado: true },
  { id: 'telefone',   label: 'Telefone',       selecionado: false },
];

/**
 * Modal de seleção de colunas para o relatório "Relação de Jogadores".
 * Retorna `{ colunas }` via dismiss('save').
 */
@Component({
  selector: 'app-colunas-jogadores-modal',
  templateUrl: './colunas-jogadores-modal.component.html',
  styleUrls: ['./colunas-jogadores-modal.component.scss'],
  standalone: false,
})
export class ColunasJogadoresModalComponent implements OnInit {
  private readonly modalCtrl = inject(ModalController);

  /** Estado inicial vindo da página (pode estar vazio na primeira vez). */
  @Input() colunas: ColunaJogador[] = [];

  ngOnInit(): void {
    if (this.colunas.length === 0) {
      this.colunas = COLUNAS_JOGADORES_PADRAO.map(c => ({ ...c }));
    } else {
      // Clona pra não mutar a referência da página até clicar em Salvar.
      this.colunas = this.colunas.map(c => ({ ...c }));
    }
  }

  toggle(c: ColunaJogador): void {
    c.selecionado = !c.selecionado;
  }

  /** Marca todas as colunas. */
  marcarTodas(): void {
    this.colunas = this.colunas.map(c => ({ ...c, selecionado: true }));
  }

  /** Desmarca todas (mantém pelo menos Nome — sem ele a tabela perde sentido). */
  desmarcarTodas(): void {
    this.colunas = this.colunas.map(c => ({
      ...c,
      selecionado: c.id === 'nome',
    }));
  }

  /** Volta para o conjunto padrão (camisa + nome + apelido + posição + nascimento + documento). */
  restaurarPadrao(): void {
    this.colunas = COLUNAS_JOGADORES_PADRAO.map(c => ({ ...c }));
  }

  qtdMarcadas(): number {
    return this.colunas.filter(c => c.selecionado).length;
  }

  salvar(): void {
    void this.modalCtrl.dismiss({ colunas: this.colunas }, 'save');
  }

  fechar(): void {
    void this.modalCtrl.dismiss();
  }

  trackById(_i: number, c: ColunaJogador): string {
    return c.id;
  }
}
