import { Component, Input, inject } from '@angular/core';
import { AlertController, ModalController } from '@ionic/angular';
import { EnqueteAlternativa } from '../../../../campeonatos/models/enquete.model';

/**
 * Modal interno do editor de Enquete — gerencia a lista de alternativas.
 * Recebe um array `alternativas` (cópia) e devolve via dismiss o array editado.
 */
@Component({
  selector: 'app-alternativas-modal',
  templateUrl: './alternativas-modal.component.html',
  styleUrls: ['./alternativas-modal.component.scss'],
  standalone: false,
})
export class AlternativasModalComponent {
  @Input() alternativas: EnqueteAlternativa[] = [];

  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);

  /** Cópia local pra não mutar o input antes de confirmar. */
  lista: EnqueteAlternativa[] = [];

  ngOnInit(): void {
    this.lista = (this.alternativas ?? []).map(a => ({ ...a }));
  }

  async adicionar(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Nova alternativa',
      inputs: [{ name: 'texto', type: 'text', placeholder: 'Texto da alternativa' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          handler: (data: { texto: string }) => {
            const t = (data.texto ?? '').trim();
            if (!t) return false;
            this.lista.push({
              id: this.gerarId(),
              texto: t,
              votos: 0,
            });
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editar(alt: EnqueteAlternativa): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Editar alternativa',
      inputs: [{ name: 'texto', type: 'text', value: alt.texto }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: (data: { texto: string }) => {
            const t = (data.texto ?? '').trim();
            if (!t) return false;
            alt.texto = t;
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async remover(alt: EnqueteAlternativa): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover alternativa?',
      message: `"${alt.texto}" será removida${(alt.votos ?? 0) > 0 ? ` (${alt.votos} voto(s) serão perdidos)` : ''}.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: () => {
            this.lista = this.lista.filter(x => x.id !== alt.id);
          },
        },
      ],
    });
    await alert.present();
  }

  subir(idx: number): void {
    if (idx <= 0) return;
    const tmp = this.lista[idx - 1];
    this.lista[idx - 1] = this.lista[idx];
    this.lista[idx] = tmp;
  }
  descer(idx: number): void {
    if (idx >= this.lista.length - 1) return;
    const tmp = this.lista[idx + 1];
    this.lista[idx + 1] = this.lista[idx];
    this.lista[idx] = tmp;
  }

  /** Salva e fecha o modal devolvendo a lista. */
  salvar(): Promise<boolean> {
    return this.modalCtrl.dismiss({ alternativas: this.lista, saved: true });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackById(_i: number, a: EnqueteAlternativa): string {
    return a.id;
  }

  private gerarId(): string {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
}
