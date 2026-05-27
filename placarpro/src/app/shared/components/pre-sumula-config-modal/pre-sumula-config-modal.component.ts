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
 * Modal de configuração da Pré-Súmula. Estilo "modal único" igual ao
 * `CarteirinhasConfigModalComponent` — usuário define tudo num formulário
 * compacto e clica "Salvar" / "Salvar e imprimir".
 *
 * Retorno via `modalCtrl.dismiss({ saved, imprimir })`:
 *  - saved: true se o usuário salvou (não cancelou)
 *  - imprimir: true se também quer ir direto pra tela de impressão
 */
@Component({
  selector: 'app-pre-sumula-config-modal',
  templateUrl: './pre-sumula-config-modal.component.html',
  styleUrls: ['./pre-sumula-config-modal.component.scss'],
  standalone: false,
})
export class PreSumulaConfigModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  @ViewChild('logoPicker') logoPicker?: ElementRef<HTMLInputElement>;

  private readonly modalCtrl = inject(ModalController);
  private readonly catSrv = inject(CategoriasService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  /** Estado local — espelha `categoria.preSumulaConfig` enquanto edita. */
  config: PreSumulaConfig = {
    ...PRE_SUMULA_CONFIG_PADRAO,
    tituloLinhas: ['', '', ''],
  };

  readonly MAX_LOGOS = 4;
  loading = true;
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;
    try {
      const cat = await firstValueFrom(this.catSrv.get$(this.campeonatoId, this.categoriaId));
      const salvo = cat?.preSumulaConfig ?? {};
      // Garante 3 slots fixos pra o título (preenche com vazio se config tem menos).
      const tit = [...(salvo.tituloLinhas ?? [])];
      while (tit.length < 3) tit.push('');
      this.config = {
        ...PRE_SUMULA_CONFIG_PADRAO,
        ...salvo,
        tituloLinhas: tit.slice(0, 3),
        logosExtras: [...(salvo.logosExtras ?? [])],
      };
    } catch (err) {
      console.warn('[PreSumulaConfig] load erro', err);
    } finally {
      this.loading = false;
    }
  }

  // ─── Setters dos campos ───
  setLinha(idx: number, v: string): void {
    const linhas = [...(this.config.tituloLinhas ?? ['', '', ''])];
    linhas[idx] = v;
    this.config.tituloLinhas = linhas;
  }
  setLegenda(idx: number, v: string): void {
    const logos = [...(this.config.logosExtras ?? [])];
    if (logos[idx]) {
      logos[idx] = { ...logos[idx], legenda: v };
      this.config.logosExtras = logos;
    }
  }
  setUmaTabela(v: boolean): void { this.config.umaTabelaPorEquipe = v; }
  setIncluirFotos(v: boolean): void { this.config.incluirFotosJogadores = v; }
  setLinhasObs(v: number): void {
    this.config.linhasObservacoes = Math.max(0, Math.min(20, Math.floor(v || 0)));
  }

  // ─── Upload de logos ───
  acionarUploadLogo(): void {
    const total = this.config.logosExtras?.length ?? 0;
    if (total >= this.MAX_LOGOS) {
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
      console.error('[PreSumulaConfig] upload erro', err);
      await this.toast('Falha ao enviar a logo.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async removerLogo(idx: number): Promise<void> {
    const logos = [...(this.config.logosExtras ?? [])];
    const removido = logos[idx];
    if (!removido) return;
    logos.splice(idx, 1);
    this.config.logosExtras = logos;
    if (removido.path) {
      try { await this.storage.remove(removido.path); } catch { /* ignore */ }
    }
  }

  // ─── Submit ───
  /** Salva e fecha sem imprimir (volta pra tela anterior). */
  salvar(): Promise<void> { return this.persistir(false); }

  /** Salva e marca para abrir a tela de impressão em seguida. */
  salvarEImprimir(): Promise<void> { return this.persistir(true); }

  private async persistir(imprimir: boolean): Promise<void> {
    this.salvando = true;
    try {
      const linhas = (this.config.tituloLinhas ?? []).map(l => l.trim()).filter(l => l.length > 0);
      const limpo: PreSumulaConfig = {
        tituloLinhas: linhas,
        logosExtras: (this.config.logosExtras ?? []).map(l => ({
          url: l.url,
          ...(l.path ? { path: l.path } : {}),
          ...(l.legenda?.trim() ? { legenda: l.legenda.trim() } : {}),
        })),
        umaTabelaPorEquipe: this.config.umaTabelaPorEquipe ?? true,
        incluirFotosJogadores: !!this.config.incluirFotosJogadores,
        linhasObservacoes: this.config.linhasObservacoes ?? 0,
      };
      await this.catSrv.atualizar(this.campeonatoId, this.categoriaId, {
        preSumulaConfig: limpo,
      });
      await this.modalCtrl.dismiss({ saved: true, imprimir });
    } catch (err) {
      console.error('[PreSumulaConfig] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  cancelar(): Promise<boolean> { return this.modalCtrl.dismiss(); }

  trackByIdx(i: number): number { return i; }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color });
    await t.present();
  }
}
