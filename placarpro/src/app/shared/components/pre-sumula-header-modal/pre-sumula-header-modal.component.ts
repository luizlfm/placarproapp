import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import {
  LogoHeaderPreSumula,
  PRE_SUMULA_CONFIG_PADRAO,
  PreSumulaConfig,
} from '../../../campeonatos/categoria.model';
import { StorageService } from '../../storage.service';
import { AuthService } from '../../../auth/auth.service';

/**
 * Modal para configurar o header da Pré-Súmula:
 *  - Sobrescreve título/subtítulo (opcional)
 *  - Adiciona texto livre no cabeçalho (regras curtas, edição, etc.)
 *  - Adiciona até 4 logos extras (federação, patrocinador, etc.)
 *  - Toggle de mostrar fotos dos jogadores
 *
 * A config é salva em `categoria.preSumulaConfig` e reutilizada em todas as
 * pré-súmulas geradas dali pra frente.
 */
@Component({
  selector: 'app-pre-sumula-header-modal',
  templateUrl: './pre-sumula-header-modal.component.html',
  styleUrls: ['./pre-sumula-header-modal.component.scss'],
  standalone: false,
})
export class PreSumulaHeaderModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  @ViewChild('logoPicker') logoPicker?: ElementRef<HTMLInputElement>;

  private readonly modalCtrl = inject(ModalController);
  private readonly catSrv = inject(CategoriasService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  /** Estado local do form — espelha `PreSumulaConfig` da categoria. */
  config: PreSumulaConfig = { ...PRE_SUMULA_CONFIG_PADRAO };
  /** Limite de logos extras (federação, patrocinadores, etc.). */
  readonly MAX_LOGOS = 4;

  loading = true;
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;
    try {
      const cat = await firstValueFrom(this.catSrv.get$(this.campeonatoId, this.categoriaId));
      // Merge com defaults pra garantir todos os campos preenchidos.
      this.config = {
        ...PRE_SUMULA_CONFIG_PADRAO,
        ...(cat?.preSumulaConfig ?? {}),
        logosExtras: [...(cat?.preSumulaConfig?.logosExtras ?? [])],
      };
    } catch (err) {
      console.warn('[PreSumulaHeader] load erro', err);
    } finally {
      this.loading = false;
    }
  }

  // ─── Form helpers ───
  setTitulo(v: string): void { this.config.tituloCustom = v; }
  setSubtitulo(v: string): void { this.config.subtituloCustom = v; }
  setTextoCabecalho(v: string): void { this.config.textoCabecalho = v; }
  setIncluirFotos(v: boolean): void { this.config.incluirFotosJogadores = v; }
  setLinhasObs(v: number): void {
    // Clamp entre 0 e 20
    const n = Math.max(0, Math.min(20, Math.floor(v || 0)));
    this.config.linhasObservacoes = n;
  }
  setLegenda(idx: number, v: string): void {
    const logos = this.config.logosExtras ?? [];
    if (logos[idx]) logos[idx] = { ...logos[idx], legenda: v };
    this.config.logosExtras = logos;
  }

  // ─── Upload de logo extra ───
  acionarUploadLogo(): void {
    const logos = this.config.logosExtras ?? [];
    if (logos.length >= this.MAX_LOGOS) {
      void this.toast(`Limite de ${this.MAX_LOGOS} logos atingido.`, 'danger');
      return;
    }
    this.logoPicker?.nativeElement.click();
  }

  async onLogoEscolhido(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    const uid = this.auth.currentUser?.uid;
    if (!uid) return;

    const loader = await this.loadingCtrl.create({ message: 'Enviando logo...' });
    await loader.present();
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `users/${uid}/campeonatos/${this.campeonatoId}/categorias/${this.categoriaId}/pre-sumula/${Date.now()}-${safe}`;
      const url = await this.storage.upload(path, file);
      const novo: LogoHeaderPreSumula = { url, path };
      this.config.logosExtras = [...(this.config.logosExtras ?? []), novo];
    } catch (err) {
      console.error('[PreSumulaHeader] upload erro', err);
      await this.toast('Falha ao enviar a logo.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async removerLogo(idx: number): Promise<void> {
    const logos = this.config.logosExtras ?? [];
    const removido = logos[idx];
    if (!removido) return;
    this.config.logosExtras = logos.filter((_, i) => i !== idx);
    // Deleta o arquivo do Storage em background (não bloqueia o save).
    if (removido.path) {
      try { await this.storage.remove(removido.path); } catch { /* ignore */ }
    }
  }

  // ─── Submit ───
  async salvar(): Promise<void> {
    this.salvando = true;
    try {
      // Limpa campos vazios pra não poluir o Firestore com strings vazias.
      const limpo: PreSumulaConfig = {
        tituloCustom: this.config.tituloCustom?.trim() || undefined,
        subtituloCustom: this.config.subtituloCustom?.trim() || undefined,
        textoCabecalho: this.config.textoCabecalho?.trim() || undefined,
        logosExtras: (this.config.logosExtras ?? []).map(l => ({
          url: l.url,
          ...(l.path ? { path: l.path } : {}),
          ...(l.legenda?.trim() ? { legenda: l.legenda.trim() } : {}),
        })),
        incluirFotosJogadores: !!this.config.incluirFotosJogadores,
        linhasObservacoes: this.config.linhasObservacoes ?? 5,
      };
      await this.catSrv.atualizar(this.campeonatoId, this.categoriaId, {
        preSumulaConfig: limpo,
      });
      await this.modalCtrl.dismiss({ saved: true, config: limpo });
    } catch (err) {
      console.error('[PreSumulaHeader] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trackByIdx(i: number): number { return i; }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color });
    await t.present();
  }
}
