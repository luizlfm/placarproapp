import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Observable } from 'rxjs';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Grupo } from '../../../../campeonatos/models/grupo.model';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { GruposService } from '../../../../campeonatos/grupos.service';
import { StorageService } from '../../../../shared/storage.service';
import { ImageCropperModalComponent } from '../../../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { JogadorModalComponent } from '../jogador-modal/jogador-modal.component';
import { EquipeTecnicaModalComponent } from '../equipe-tecnica-modal/equipe-tecnica-modal.component';
import { ConvitesEquipeService } from '../../../../campeonatos/convites-equipe.service';

@Component({
  selector: 'app-equipe-modal',
  templateUrl: './equipe-modal.component.html',
  styleUrls: ['./equipe-modal.component.scss'],
  standalone: false,
})
export class EquipeModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() equipeExistente?: Equipe;

  private readonly fb = inject(FormBuilder);
  private readonly equipesSrv = inject(EquipesService);
  private readonly gruposSrv = inject(GruposService);
  private readonly storageSrv = inject(StorageService);
  private readonly convitesSrv = inject(ConvitesEquipeService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  loading = false;
  enviandoLogo = false;
  grupos$!: Observable<Grupo[]>;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    cidade: [''],
    tecnico: [''],
    grupoId: [''],
    logoUrl: [''],
    cor: [''],
  });

  /** Status do convite/ficha:
   *  - null  = não checado ainda OU sem token
   *  - true  = ficha ABERTA (representante pode editar)
   *  - false = ficha FECHADA (já preenchida e travada) */
  fichaAberta: boolean | null = null;

  ngOnInit(): void {
    this.grupos$ = this.gruposSrv.list$(this.campeonatoId, this.categoriaId);
    if (this.equipeExistente) {
      this.form.patchValue({
        nome: this.equipeExistente.nome,
        cidade: this.equipeExistente.cidade ?? '',
        tecnico: this.equipeExistente.tecnico ?? '',
        grupoId: this.equipeExistente.grupoId ?? '',
        logoUrl: this.equipeExistente.logoUrl ?? '',
        cor: this.equipeExistente.cor ?? '',
      });
      void this.atualizarStatusFicha();
    }
  }

  /** Carrega o status do convite (aberta/fechada) a partir do token. */
  private async atualizarStatusFicha(): Promise<void> {
    const token = this.equipeExistente?.inscricaoToken;
    if (!token) { this.fichaAberta = null; return; }
    try {
      const c = await this.convitesSrv.getByToken(token);
      // `usado=true` → fechada; `usado=false`/ausente → aberta
      this.fichaAberta = c ? !c.usado : null;
    } catch {
      this.fichaAberta = null;
    }
  }

  /** Fecha a ficha (impede o representante de editar pelo link). */
  async fecharFichaInscricao(): Promise<void> {
    const token = this.equipeExistente?.inscricaoToken;
    if (!token) return;
    const alert = await this.alertCtrl.create({
      header: 'Fechar ficha de inscrição?',
      message: 'O representante não poderá mais editar a ficha pelo link.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Fechar',
          role: 'confirm',
          handler: async () => {
            const loader = await this.loadingCtrl.create({ message: 'Fechando ficha...' });
            await loader.present();
            try {
              await this.convitesSrv.fecharConvite(token);
              await this.toast('Ficha fechada.', 'success');
              await this.atualizarStatusFicha();
            } catch (err) {
              console.error('[EquipeModal] fechar ficha erro', err);
              await this.toast('Erro ao fechar ficha.', 'danger');
            } finally {
              await loader.dismiss();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  get titulo(): string {
    return this.equipeExistente ? 'Editar equipe' : 'Nova equipe';
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    try {
      const payload = this.form.getRawValue();
      // Limpa strings vazias (para não persistir como "")
      const sanitized: Record<string, unknown> = {};
      Object.entries(payload).forEach(([k, v]) => {
        if (typeof v === 'string' && v.trim() === '') return;
        sanitized[k] = v;
      });
      if (this.equipeExistente?.id) {
        await this.equipesSrv.atualizar(
          this.campeonatoId,
          this.categoriaId,
          this.equipeExistente.id,
          sanitized as Partial<Equipe>,
        );
        await this.toast('Equipe atualizada.', 'success');
      } else {
        await this.equipesSrv.criar(this.campeonatoId, this.categoriaId, sanitized as { nome: string });
        await this.toast('Equipe criada.', 'success');
      }
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[EquipeModal] submit erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async remover(): Promise<void> {
    if (!this.equipeExistente?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover equipe?',
      message: `"${this.equipeExistente.nome}" e todos os jogadores vinculados serão apagados.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.equipesSrv.remover(
                this.campeonatoId,
                this.categoriaId,
                this.equipeExistente!.id!,
              );
              await this.modalCtrl.dismiss({ removed: true });
            } catch (err) {
              console.error('[EquipeModal] remover erro', err);
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Abre seletor de arquivo, abre cropper 1:1 e faz upload do logo. */
  async selecionarLogo(): Promise<void> {
    const file = await this.pickFile();
    if (!file) return;

    const modal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: {
        file,
        aspectRatio: 1,
        title: 'Ajustar escudo',
        roundCropper: true,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ blob?: Blob }>();
    if (!data?.blob) return;

    this.enviandoLogo = true;
    const loader = await this.loadingCtrl.create({ message: 'Enviando escudo...' });
    await loader.present();
    try {
      // Para upload precisamos do equipeId. Se está editando, usa o id existente;
      // se é uma nova equipe, cria primeiro e depois associa o logo.
      let equipeId = this.equipeExistente?.id;
      if (!equipeId) {
        const novoId = await this.equipesSrv.criar(this.campeonatoId, this.categoriaId, {
          nome: (this.form.value.nome as string)?.trim() || 'Nova equipe',
        });
        equipeId = novoId;
        // mantém referência para que o submit posterior só atualize.
        this.equipeExistente = {
          id: novoId,
          campeonatoId: this.campeonatoId,
          categoriaId: this.categoriaId,
          nome: this.form.value.nome,
        } as Equipe;
      }
      const url = await this.storageSrv.uploadEquipeLogo(
        this.campeonatoId,
        this.categoriaId,
        equipeId!,
        data.blob,
      );
      this.form.patchValue({ logoUrl: url });
      await this.equipesSrv.atualizar(this.campeonatoId, this.categoriaId, equipeId!, {
        logoUrl: url,
      });
      await this.toast('Escudo atualizado.', 'success');
    } catch (err) {
      console.error('[EquipeModal] upload erro', err);
      await this.toast('Erro ao enviar imagem. Verifique regras do Storage.', 'danger');
    } finally {
      this.enviandoLogo = false;
      await loader.dismiss();
    }
  }

  removerLogo(): void {
    this.form.patchValue({ logoUrl: '' });
  }

  async abrirJogadores(): Promise<void> {
    if (!this.equipeExistente?.id) {
      await this.toast('Salve a equipe primeiro pra cadastrar jogadores.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: JogadorModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipe: this.equipeExistente,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  /**
   * Reabre a ficha de inscrição da equipe (admin only).
   * Quando o representante já enviou a ficha, o convite fica `usado: true`
   * e a página `/inscricao/:token` mostra "Convite já utilizado". Esta
   * função reseta `usado: false` no convite, liberando edição.
   *
   * Requer que a equipe tenha `inscricaoToken` salvo (gerado pelo botão
   * "Gerar link de inscrição"). Se não tiver, instrui o admin a gerar antes.
   */
  async reabrirFichaInscricao(): Promise<void> {
    const token = this.equipeExistente?.inscricaoToken;
    if (!token) {
      await this.toast(
        'Esta equipe ainda não tem link de inscrição. Gere primeiro em "Gerar link".',
        'danger',
      );
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Reabrir ficha de inscrição?',
      message:
        'O representante poderá editar a ficha novamente usando o mesmo link. ' +
        'Os jogadores e dados já cadastrados serão pré-preenchidos.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Reabrir',
          role: 'confirm',
          handler: async () => {
            const loader = await this.loadingCtrl.create({ message: 'Reabrindo ficha...' });
            await loader.present();
            try {
              await this.convitesSrv.reabrirConvite(token);
              await this.toast('Ficha reaberta. O representante pode editar novamente.', 'success');
              await this.atualizarStatusFicha();
            } catch (err) {
              console.error('[EquipeModal] reabrir ficha erro', err);
              await this.toast('Erro ao reabrir ficha.', 'danger');
            } finally {
              await loader.dismiss();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async abrirEquipeTecnica(): Promise<void> {
    if (!this.equipeExistente?.id) {
      await this.toast('Salve a equipe primeiro pra cadastrar a equipe técnica.', 'danger');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: EquipeTecnicaModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipe: this.equipeExistente,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  selecionarCor(cor: string): void {
    this.form.patchValue({ cor });
  }

  readonly coresPreset: string[] = [
    '#000000', // navy
    '#7CC61D', // verde marca
    '#EB4747', // vermelho
    '#F5C518', // amarelo
    '#4DABF7', // azul
    '#9333EA', // roxo
    '#F97316', // laranja
    '#0EA5E9', // ciano
    '#EC4899', // rosa
    '#10B981', // verde-água
    '#6B7280', // cinza
    '#000000', // preto
  ];

  /**
   * Compartilha o link público da equipe via Web Share API (iOS Safari /
   * Android Chrome / desktop com suporte). Fallback: copia pro clipboard
   * e mostra toast.
   *
   * URL pública: `/p/:campeonatoId/categoria/:catId/equipe/:eqId`
   * (rota declarada em `publico-routing.module.ts`).
   */
  async compartilhar(): Promise<void> {
    const eq = this.equipeExistente;
    const nome = eq?.nome ?? this.form.value.nome ?? 'Equipe';

    if (!eq?.id || !this.campeonatoId || !this.categoriaId) {
      await this.toast('Salve a equipe antes de compartilhar.', 'warning');
      return;
    }

    const url = `${location.origin}/p/${this.campeonatoId}/categoria/${this.categoriaId}/equipe/${eq.id}`;
    const titulo = `${nome} • PlacarPro`;
    const texto = `Confira a equipe ${nome} no PlacarPro:`;

    // Web Share API — abre o sheet nativo de compartilhamento do SO.
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: titulo, text: texto, url });
        return;
      } catch (err) {
        // user cancelou (AbortError) — sem feedback negativo
        const code = (err as { name?: string })?.name;
        if (code === 'AbortError') return;
        console.warn('[compartilhar] share falhou, vai cair no fallback', err);
      }
    }

    // Fallback: clipboard
    try {
      await navigator.clipboard.writeText(url);
      await this.toast('Link copiado para a área de transferência.', 'success');
    } catch {
      await this.toast(url, 'success');
    }
  }

  private pickFile(): Promise<File | null> {
    return new Promise<File | null>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const f = input.files?.[0] ?? null;
        if (document.body.contains(input)) document.body.removeChild(input);
        resolve(f);
      };
      window.addEventListener(
        'focus',
        () =>
          setTimeout(() => {
            if (document.body.contains(input)) {
              document.body.removeChild(input);
              resolve(null);
            }
          }, 1000),
        { once: true },
      );
      input.click();
    });
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }
}
