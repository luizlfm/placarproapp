import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular';
import {
  ESPACO_OPCOES,
  EspacoCampo,
  TamanhoCarteirinha,
} from '../../../campeonatos/carteirinhas-pdf.service';

export interface CarteirinhasConfigResult {
  nomeCampeonato: string;
  subtitulo: string;
  cor: string;
  incluirEscudo: boolean;
  incluirVerso: boolean;
  espacos: [EspacoCampo, EspacoCampo, EspacoCampo];
  organizacao?: string;
  endereco?: string;
  cidade?: string;
  telefone?: string;
}

/**
 * Modal 2 do fluxo de impressão de carteirinhas — ajustes do cartão:
 * nome/subtítulo do campeonato, organização (rodapé preto),
 * toggles de escudo + verso, e dados do clube usados no verso
 * (endereço, cidade, telefone — opcionais).
 */
@Component({
  selector: 'app-carteirinhas-config-modal',
  templateUrl: './carteirinhas-config-modal.component.html',
  styleUrls: ['./carteirinhas-config-modal.component.scss'],
  standalone: false,
})
export class CarteirinhasConfigModalComponent implements OnInit {
  @Input() tamanho!: TamanhoCarteirinha;
  @Input() nomeCampeonatoDefault = '';
  @Input() subtituloDefault = '';
  @Input() corDefault = '#000000';
  @Input() organizacaoDefault = '';

  private readonly modalCtrl = inject(ModalController);

  readonly opcoesEspaco = ESPACO_OPCOES;

  nomeCampeonato = '';
  subtitulo = '';
  cor = '#000000';
  organizacao = '';
  incluirEscudo = true;
  incluirVerso = false;

  // Dados opcionais usados no verso
  endereco = '';
  cidade = '';
  telefone = '';

  // Compat — não usados no layout fixo atual
  espaco1: EspacoCampo = 'numero';
  espaco2: EspacoCampo = 'documento';
  espaco3: EspacoCampo = 'posicao';

  /** Mostra/oculta o input nativo de cor. */
  editandoCor = false;

  ngOnInit(): void {
    this.nomeCampeonato = this.nomeCampeonatoDefault;
    this.subtitulo = this.subtituloDefault;
    this.cor = this.corDefault || '#000000';
    this.organizacao = this.organizacaoDefault;
  }

  toggleCor(): void {
    this.editandoCor = !this.editandoCor;
  }

  cancelar(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  imprimir(): Promise<boolean> {
    const result: CarteirinhasConfigResult = {
      nomeCampeonato: this.nomeCampeonato.trim(),
      subtitulo: this.subtitulo.trim(),
      cor: this.cor,
      incluirEscudo: this.incluirEscudo,
      incluirVerso: this.incluirVerso,
      espacos: [this.espaco1, this.espaco2, this.espaco3],
      organizacao: this.organizacao.trim() || undefined,
      endereco: this.endereco.trim() || undefined,
      cidade: this.cidade.trim() || undefined,
      telefone: this.telefone.trim() || undefined,
    };
    return this.modalCtrl.dismiss(result);
  }
}
