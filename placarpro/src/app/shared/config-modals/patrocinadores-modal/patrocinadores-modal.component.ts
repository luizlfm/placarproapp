import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { Patrocinador } from '../../../campeonatos/campeonato.model';
import { StorageService } from '../../../shared/storage.service';
import { AuthService } from '../../../auth/auth.service';

/** Modal CRUD de patrocinadores/apoiadores. */
@Component({
  selector: 'app-patrocinadores-modal',
  templateUrl: './patrocinadores-modal.component.html',
  styleUrls: ['./patrocinadores-modal.component.scss'],
  standalone: false,
})
export class PatrocinadoresModalComponent implements OnInit {
  @Input() campeonatoId = '';

  @ViewChild('logoPicker') logoPicker?: ElementRef<HTMLInputElement>;

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  patrocinadores: Patrocinador[] = [];
  salvando = false;
  /** Índice em edição para o upload de logo. */
  private uploadIdx = -1;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    const sub = this.campSrv.get$(this.campeonatoId).subscribe(c => {
      this.patrocinadores = [...(c?.patrocinadores ?? [])];
      setTimeout(() => sub.unsubscribe(), 0);
    });
  }

  adicionar(): void {
    this.patrocinadores.push({ nome: '', logoUrl: '', url: '' });
  }

  async remover(idx: number): Promise<void> {
    const p = this.patrocinadores[idx];
    if (!p) return;
    this.patrocinadores.splice(idx, 1);
    if (p.logoPath) {
      try { await this.storage.remove(p.logoPath); } catch { /* ignore */ }
    }
  }

  setNome(idx: number, valor: string): void {
    if (this.patrocinadores[idx]) {
      this.patrocinadores[idx] = { ...this.patrocinadores[idx], nome: valor };
    }
  }

  setUrl(idx: number, valor: string): void {
    if (this.patrocinadores[idx]) {
      this.patrocinadores[idx] = { ...this.patrocinadores[idx], url: valor };
    }
  }

  acionarUploadLogo(idx: number): void {
    this.uploadIdx = idx;
    this.logoPicker?.nativeElement.click();
  }

  async onLogoEscolhida(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file || this.uploadIdx < 0) return;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;
    const loader = await this.loadingCtrl.create({ message: 'Enviando logo...' });
    await loader.present();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `users/${uid}/campeonatos/${this.campeonatoId}/patrocinadores/${Date.now()}-${safe}`;
      const url = await this.storage.upload(path, file);
      // Remove o logo antigo do Storage se houver.
      const old = this.patrocinadores[this.uploadIdx];
      if (old?.logoPath) {
        try { await this.storage.remove(old.logoPath); } catch { /* ignore */ }
      }
      this.patrocinadores[this.uploadIdx] = {
        ...this.patrocinadores[this.uploadIdx],
        logoUrl: url,
        logoPath: path,
      };
    } catch (err) {
      console.error('[Patrocinadores] upload erro', err);
      await this.toast('Falha ao enviar logo.', 'danger');
    } finally {
      await loader.dismiss();
      input.value = '';
      this.uploadIdx = -1;
    }
  }

  async salvar(): Promise<void> {
    // Filtra patrocinadores sem nome (esqueletos de adicionar).
    const validos = this.patrocinadores.filter(p => p.nome?.trim());
    this.salvando = true;
    try {
      await this.campSrv.atualizar(this.campeonatoId, { patrocinadores: validos });
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Patrocinadores] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
