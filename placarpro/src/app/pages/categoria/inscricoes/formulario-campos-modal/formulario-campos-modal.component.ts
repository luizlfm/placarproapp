import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { CampoFormulario } from '../../../../campeonatos/categoria.model';

interface TipoOpt {
  value: CampoFormulario['tipo'];
  label: string;
}

const TIPOS: TipoOpt[] = [
  { value: 'texto', label: 'Texto curto' },
  { value: 'textarea', label: 'Texto longo' },
  { value: 'email', label: 'E-mail' },
  { value: 'telefone', label: 'Telefone' },
  { value: 'data', label: 'Data' },
  { value: 'numero', label: 'Número' },
  { value: 'select', label: 'Lista (select)' },
  { value: 'checkbox', label: 'Caixa de seleção' },
];

@Component({
  selector: 'app-formulario-campos-modal',
  templateUrl: './formulario-campos-modal.component.html',
  styleUrls: ['./formulario-campos-modal.component.scss'],
  standalone: false,
})
export class FormularioCamposModalComponent implements OnInit {
  @Input() titulo = 'Editar formulário';
  @Input() campos: CampoFormulario[] = [];

  readonly tipos = TIPOS;

  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);

  ngOnInit(): void {
    // Ordena por ordem ao abrir
    this.campos = [...this.campos].sort((a, b) => a.ordem - b.ordem);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  salvar(): Promise<boolean> {
    return this.modalCtrl.dismiss({ campos: this.reordenar(this.campos) });
  }

  private reordenar(arr: CampoFormulario[]): CampoFormulario[] {
    return arr.map((c, i) => ({ ...c, ordem: i }));
  }

  async adicionar(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Novo campo',
      inputs: [{ name: 'label', type: 'text', placeholder: 'Nome do campo (ex: CPF)' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          handler: (data: { label: string }) => {
            const lbl = (data.label || '').trim();
            if (!lbl) return false;
            this.campos = [
              ...this.campos,
              {
                id: 'c_' + Math.random().toString(36).slice(2, 8),
                label: lbl,
                tipo: 'texto',
                obrigatorio: false,
                ordem: this.campos.length,
              },
            ];
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  mover(i: number, delta: -1 | 1): void {
    const j = i + delta;
    if (j < 0 || j >= this.campos.length) return;
    const arr = [...this.campos];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.campos = arr;
  }

  remover(i: number): void {
    this.campos = this.campos.filter((_, idx) => idx !== i);
  }

  async renomear(c: CampoFormulario): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Renomear',
      inputs: [{ name: 'label', type: 'text', value: c.label }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: (data: { label: string }) => {
            const lbl = (data.label || '').trim();
            if (!lbl) return false;
            c.label = lbl;
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editarOpcoes(c: CampoFormulario): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Opções (uma por linha)',
      inputs: [
        {
          name: 'opcoes',
          type: 'textarea',
          value: (c.opcoes ?? []).join('\n'),
          placeholder: 'Opção 1\nOpção 2\nOpção 3',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: (data: { opcoes: string }) => {
            const lista = (data.opcoes || '')
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean);
            c.opcoes = lista;
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  trackByCampo(_i: number, c: CampoFormulario): string {
    return c.id;
  }
}
