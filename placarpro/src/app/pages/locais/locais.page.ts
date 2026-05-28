import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, LoadingController, ModalController, ToastController } from '@ionic/angular';
import { StorageService } from '../../shared/storage.service';
import { ImageCropperModalComponent } from '../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { AddressAutocompleteService, SugestaoEndereco } from '../../shared/address-autocomplete.service';
import { Observable, Subject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { Local } from '../../users/models/local.model';
import { UsersService } from '../../users/users.service';

@Component({
  selector: 'app-locais',
  templateUrl: './locais.page.html',
  styleUrls: ['./locais.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class LocaisPage {
  private readonly fb = inject(FormBuilder);
  private readonly usersSrv = inject(UsersService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly storageSrv = inject(StorageService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly addressSrv = inject(AddressAutocompleteService);

  enviandoFoto = false;

  readonly locais$: Observable<Local[]> = this.usersSrv.locais$();

  editandoId: string | null = null;
  abrirForm = false;
  salvando = false;

  // ─── Autocomplete de endereço (Nominatim/OSM) ───
  /** Sugestões exibidas no dropdown. */
  sugestoes: SugestaoEndereco[] = [];
  /** Indica busca em andamento (mostra spinner). */
  buscandoEndereco = false;
  /** Indica que o user já tocou no campo (mostra dropdown). */
  enderecoFocado = false;
  /** Subject pra debounce do input. */
  private readonly buscaEndereco$ = new Subject<string>();
  /** Trava a busca quando o user clica em uma sugestão. */
  private ignorarProximaBusca = false;

  constructor() {
    // Pipeline de busca: debounce 350ms + distinct + chamada à API.
    this.buscaEndereco$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap(termo => {
          if (this.ignorarProximaBusca) {
            this.ignorarProximaBusca = false;
            return of([] as SugestaoEndereco[]);
          }
          if (!termo || termo.length < 4) {
            this.buscandoEndereco = false;
            return of([] as SugestaoEndereco[]);
          }
          this.buscandoEndereco = true;
          return this.addressSrv.search(termo);
        }),
      )
      .subscribe(arr => {
        this.buscandoEndereco = false;
        this.sugestoes = arr;
      });
  }

  /** Dispara busca quando o user digita no campo de endereço. */
  onDigitarEndereco(termo: string | null | undefined): void {
    this.enderecoFocado = true;
    this.buscaEndereco$.next(termo ?? '');
  }

  /** User clicou numa sugestão: preenche endereço + número + cidade. */
  selecionarSugestao(s: SugestaoEndereco): void {
    this.ignorarProximaBusca = true;
    this.form.patchValue({
      endereco: s.endereco,
      numero: s.numero,
      cidade: s.cidade,
    });
    this.sugestoes = [];
    this.enderecoFocado = false;
  }

  /** Esconde dropdown ao perder foco (com delay pra permitir o click na sugestão). */
  onBlurEndereco(): void {
    setTimeout(() => { this.enderecoFocado = false; }, 200);
  }


  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    endereco: [''],
    numero: [''],
    cidade: [''],
    capacidade: [null as number | null],
    observacoes: [''],
    fotoUrl: [''],
  });

  /** Blob da foto pendente — quando o local ainda não foi salvo (sem id).
   *  Após salvar, faz o upload e atualiza o doc com a URL. */
  private fotoPendenteBlob?: Blob;
  /** Preview local (data URL) da foto pendente enquanto o local não tem id. */
  private fotoPendenteUrl?: string;

  novo(): void {
    this.editandoId = null;
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;
    this.form.reset({
      nome: '', endereco: '', numero: '', cidade: '',
      capacidade: null, observacoes: '', fotoUrl: '',
    });
    this.abrirForm = true;
  }

  editar(l: Local): void {
    this.editandoId = l.id ?? null;
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;
    this.form.patchValue({
      nome: l.nome,
      endereco: l.endereco ?? '',
      numero: l.numero ?? '',
      cidade: l.cidade ?? '',
      capacidade: l.capacidade ?? null,
      observacoes: l.observacoes ?? '',
      fotoUrl: l.fotoUrl ?? '',
    });
    this.abrirForm = true;
  }

  /**
   * Abre file picker, depois o ImageCropperModalComponent (aspect 16:9),
   * faz upload via StorageService e seta o `fotoUrl` no form.
   * Quando o local ainda não tem id (criação), guarda o blob pra fazer
   * upload depois do save (no método `salvar()`).
   */
  async selecionarFoto(): Promise<void> {
    const file = await this.pickFile();
    if (!file) return;

    const modal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: {
        file,
        aspectRatio: 16 / 9,
        title: 'Ajustar foto do local',
        roundCropper: false,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ blob?: Blob; dataUrl?: string }>();
    if (!data?.blob) return;

    if (!this.editandoId) {
      // Local ainda não foi salvo — guarda o blob, mostra preview local.
      this.fotoPendenteBlob = data.blob;
      this.fotoPendenteUrl = data.dataUrl;
      this.form.patchValue({ fotoUrl: data.dataUrl ?? '' });
      return;
    }

    // Local já existe — upload imediato + persiste fotoUrl.
    await this.uploadFotoLocal(this.editandoId, data.blob);
  }

  removerFoto(): void {
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;
    this.form.patchValue({ fotoUrl: '' });
  }

  private async uploadFotoLocal(localId: string, blob: Blob): Promise<void> {
    this.enviandoFoto = true;
    const loader = await this.loadingCtrl.create({ message: 'Enviando foto...' });
    await loader.present();
    try {
      const url = await this.storageSrv.uploadLocalFoto(localId, blob);
      this.form.patchValue({ fotoUrl: url });
      await this.usersSrv.atualizarLocal(localId, { fotoUrl: url });
    } catch (err) {
      console.error('[Locais] upload foto erro', err);
      await this.toast('Erro ao enviar foto.', 'danger');
    } finally {
      this.enviandoFoto = false;
      await loader.dismiss();
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
        () => setTimeout(() => {
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

  fechar(): void {
    this.abrirForm = false;
    this.editandoId = null;
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.salvando = true;
    try {
      const v = this.form.getRawValue();
      // Em criação com foto pendente: salva SEM fotoUrl (data URL local),
      // pega o id criado, faz upload e atualiza o doc com a URL real.
      const payload: Partial<Local> = {
        ...v,
        capacidade: v.capacidade ? Number(v.capacidade) : undefined,
      };
      if (this.fotoPendenteBlob && !this.editandoId) {
        payload.fotoUrl = '';
      }

      let id = this.editandoId;
      if (id) {
        await this.usersSrv.atualizarLocal(id, payload);
      } else {
        // Form já foi validado (nome required), então o cast é seguro.
        id = await this.usersSrv.criarLocal(
          payload as Omit<Local, 'id' | 'ownerId' | 'criadoEm'>,
        );
      }

      if (this.fotoPendenteBlob && id) {
        await this.uploadFotoLocal(id, this.fotoPendenteBlob);
        this.fotoPendenteBlob = undefined;
        this.fotoPendenteUrl = undefined;
      }

      this.fechar();
    } catch {
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  async remover(l: Local, ev: Event): Promise<void> {
    ev.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Remover local?',
      message: `"${l.nome}" será removido.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: () => this.usersSrv.removerLocal(l.id!),
        },
      ],
    });
    await alert.present();
  }

  trackById(_i: number, l: Local): string {
    return l.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'top', color });
    await t.present();
  }
}
