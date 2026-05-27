import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { AnexoCampeonato } from '../../../campeonatos/campeonato.model';
import { StorageService } from '../../../shared/storage.service';
import { AuthService } from '../../../auth/auth.service';

/**
 * Modal de CRUD de anexos (regulamento, fichas, etc.) do campeonato.
 * Cada anexo tem título + URL do arquivo no Storage. Upload em batch.
 */
@Component({
  selector: 'app-anexos-modal',
  templateUrl: './anexos-modal.component.html',
  styleUrls: ['./anexos-modal.component.scss'],
  standalone: false,
})
export class AnexosModalComponent implements OnInit {
  @Input() campeonatoId = '';

  @ViewChild('filePicker') filePicker?: ElementRef<HTMLInputElement>;

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  anexos: AnexoCampeonato[] = [];
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    const sub = this.campSrv.get$(this.campeonatoId).subscribe(c => {
      this.anexos = [...(c?.anexos ?? [])];
      setTimeout(() => sub.unsubscribe(), 0);
    });
  }

  acionarUpload(): void {
    this.filePicker?.nativeElement.click();
  }

  /** Sobe os arquivos pro Storage e adiciona à lista (não persiste ainda). */
  async onFilesEscolhidos(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const loader = await this.loadingCtrl.create({ message: `Enviando ${files.length} arquivo(s)...` });
    await loader.present();
    let okCount = 0;
    try {
      for (const file of files) {
        try {
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `users/${uid}/campeonatos/${this.campeonatoId}/anexos/${Date.now()}-${safe}`;
          const url = await this.storage.upload(path, file);
          this.anexos.push({
            titulo: file.name,
            url,
            path,
            bytes: file.size,
            mime: file.type,
          });
          okCount++;
        } catch (err) {
          console.error('[Anexos] falha em', file.name, err);
        }
      }
      await this.toast(`${okCount} de ${files.length} anexo(s) enviado(s).`, okCount ? 'success' : 'danger');
    } finally {
      await loader.dismiss();
      input.value = '';
    }
  }

  /** Remove um anexo da lista (também apaga o arquivo do Storage). */
  async remover(idx: number): Promise<void> {
    const a = this.anexos[idx];
    if (!a) return;
    this.anexos.splice(idx, 1);
    if (a.path) {
      try { await this.storage.remove(a.path); } catch { /* ignore */ }
    }
  }

  /** Renomeia o título exibido (não muda o arquivo). */
  renomear(idx: number, novo: string): void {
    if (this.anexos[idx]) {
      this.anexos[idx] = { ...this.anexos[idx], titulo: novo };
    }
  }

  /** Salva a lista atual no documento do campeonato. */
  async salvar(): Promise<void> {
    this.salvando = true;
    try {
      await this.campSrv.atualizar(this.campeonatoId, { anexos: this.anexos });
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Anexos] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** Formata bytes como "1.2 MB" / "342 KB". */
  formatBytes(b?: number): string {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  /** Ícone baseado no mime type. */
  iconeFor(mime?: string): string {
    if (!mime) return 'document-outline';
    if (mime.startsWith('image/')) return 'image-outline';
    if (mime.startsWith('video/')) return 'film-outline';
    if (mime === 'application/pdf') return 'document-text-outline';
    if (mime.includes('sheet') || mime.includes('excel')) return 'grid-outline';
    if (mime.includes('word')) return 'document-text-outline';
    return 'document-outline';
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
