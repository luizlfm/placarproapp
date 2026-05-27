import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { AnexoJogo, Jogo } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';

/**
 * Modal de anexos do jogo (links/arquivos externos).
 * Permite cadastrar URLs (PDF da súmula, ata, foto da chave...) com título e
 * tipo. Não faz upload aqui — apenas referência ao link externo.
 */
@Component({
  selector: 'app-anexos-jogo-modal',
  templateUrl: './anexos-jogo-modal.component.html',
  styleUrls: ['./anexos-jogo-modal.component.scss'],
  standalone: false,
})
export class AnexosJogoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogo!: Jogo;

  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  anexos: AnexoJogo[] = [];
  salvando = false;

  ngOnInit(): void {
    this.anexos = [...(this.jogo.anexos ?? [])];
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async adicionar(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Novo anexo',
      message: 'Cole a URL do anexo (link, PDF, imagem, etc.) e informe um título.',
      inputs: [
        { name: 'titulo', type: 'text', placeholder: 'Título (ex.: Súmula oficial)' },
        { name: 'url', type: 'url', placeholder: 'https://...' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          handler: (data: { titulo?: string; url?: string }) => {
            const titulo = (data.titulo ?? '').trim();
            const url = (data.url ?? '').trim();
            if (titulo.length < 2) {
              void this.toast('Título muito curto.', 'warning');
              return false;
            }
            if (!url.startsWith('http')) {
              void this.toast('URL inválida.', 'warning');
              return false;
            }
            this.anexos = [
              ...this.anexos,
              {
                id: this.gerarId(),
                titulo,
                url,
                tipo: this.detectarTipo(url),
                criadoEm: Date.now(),
              },
            ];
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editar(i: number): Promise<void> {
    const a = this.anexos[i];
    if (!a) return;
    const alert = await this.alertCtrl.create({
      header: 'Editar anexo',
      inputs: [
        { name: 'titulo', type: 'text', value: a.titulo, placeholder: 'Título' },
        { name: 'url', type: 'url', value: a.url, placeholder: 'https://...' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: (data: { titulo?: string; url?: string }) => {
            const titulo = (data.titulo ?? '').trim();
            const url = (data.url ?? '').trim();
            if (titulo.length < 2 || !url.startsWith('http')) return false;
            const novos = [...this.anexos];
            novos[i] = { ...a, titulo, url, tipo: this.detectarTipo(url) };
            this.anexos = novos;
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  remover(i: number): void {
    this.anexos = this.anexos.filter((_, idx) => idx !== i);
  }

  abrirLink(a: AnexoJogo): void {
    if (!a.url) return;
    window.open(a.url, '_blank', 'noopener');
  }

  iconeTipo(t: AnexoJogo['tipo']): string {
    switch (t) {
      case 'pdf': return 'document-text-outline';
      case 'imagem': return 'image-outline';
      case 'link': return 'link-outline';
      default: return 'attach-outline';
    }
  }

  private detectarTipo(url: string): AnexoJogo['tipo'] {
    const u = url.toLowerCase();
    if (u.endsWith('.pdf')) return 'pdf';
    if (/\.(jpe?g|png|gif|webp|bmp)(\?|$)/.test(u)) return 'imagem';
    return 'link';
  }

  private gerarId(): string {
    return 'anx_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  trackById(_i: number, a: AnexoJogo): string {
    return a.id;
  }

  async salvar(): Promise<void> {
    if (!this.jogo?.id) return;
    this.salvando = true;
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id, {
        anexos: this.anexos,
      });
      await this.toast('Anexos salvos.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[AnexosJogo] salvar', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
