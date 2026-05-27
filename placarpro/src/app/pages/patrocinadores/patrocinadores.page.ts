import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Patrocinador } from '../../users/models/patrocinador.model';
import { UsersService } from '../../users/users.service';
import { StorageService } from '../../shared/storage.service';
import { AuthService } from '../../auth/auth.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { ImageCropperModalComponent } from '../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { NavBackService } from '../../shared/nav-back.service';

type SlotImagem = 'logo' | 'bannerApp' | 'bannerAppMobile' | 'bannerSite' | 'bannerSiteMobile';

@Component({
  selector: 'app-patrocinadores',
  templateUrl: './patrocinadores.page.html',
  styleUrls: ['./patrocinadores.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class PatrocinadoresPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly usersSrv = inject(UsersService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly modalCtrl = inject(ModalController);
  private readonly navBack = inject(NavBackService);

  /** Quando aberto a partir de um campeonato (via menu lateral), recebe o id.
   *  Habilita filtro contextual + toggle "Vincular a este campeonato". */
  campeonatoCtxId: string | null = null;
  campeonatoCtx?: Campeonato;

  @ViewChild('logoPicker')             logoPicker?:             ElementRef<HTMLInputElement>;
  @ViewChild('bannerAppPicker')        bannerAppPicker?:        ElementRef<HTMLInputElement>;
  @ViewChild('bannerAppMobilePicker')  bannerAppMobilePicker?:  ElementRef<HTMLInputElement>;
  @ViewChild('bannerSitePicker')       bannerSitePicker?:       ElementRef<HTMLInputElement>;
  @ViewChild('bannerSiteMobilePicker') bannerSiteMobilePicker?: ElementRef<HTMLInputElement>;

  /** Stream principal — filtrado pelo `campeonatoCtxId` quando presente.
   *
   *  Cenários:
   *   - SEM contexto (?campeonatoId vazio): lista patrocinadores do
   *     próprio usuário logado (`users/{uid}/patrocinadores`). Comportamento
   *     padrão pra um organizador editar a lista global dele.
   *   - COM contexto (?campeonatoId=X): lista os do DONO do campeonato X
   *     (`users/{ownerId}/patrocinadores`). Isso permite que:
   *     * Moderador vinculado ao campeonato veja os patrocinadores do dono
   *       (antes via lista vazia porque buscava com o próprio uid).
   *     * Admin master também veja (lê de qualquer dono).
   *     * Organizador dono continua funcionando — `ownerId === user.uid`.
   *
   *  Em ambos os casos aplica o filtro `campeonatosVisivel` quando o
   *  contexto está presente — só mostra os que estão vinculados a este
   *  campeonato (ou que não têm escopo definido = todos). */
  readonly patrocinadores$: Observable<Patrocinador[]> = this.route.queryParamMap.pipe(
    switchMap(qp => {
      const campId = qp.get('campeonatoId');
      this.campeonatoCtxId = campId;

      if (!campId) {
        // Sem contexto — lista global do user logado (organizador editando
        // seus próprios patrocinadores).
        this.campeonatoCtx = undefined;
        return this.usersSrv.patrocinadores$();
      }

      // Com contexto — busca o campeonato pra descobrir o ownerId, e
      // lista os patrocinadores do DONO, não do user logado. Cobre o
      // caso do moderador ver patrocinadores do dono do campeonato.
      return this.campsSrv.get$(campId).pipe(
        switchMap(camp => {
          this.campeonatoCtx = camp;
          if (!camp?.ownerId) return of<Patrocinador[]>([]);
          return this.usersSrv.patrocinadoresDoOwner$(camp.ownerId).pipe(
            map(lista => lista.filter(p => {
              // Filtra os vinculados ao campeonato atual. Lista vazia =
              // "todos" (compat com patrocinadores legados sem escopo).
              const escopo = p.campeonatosVisivel ?? [];
              return escopo.length === 0 || escopo.includes(campId);
            })),
          );
        }),
      );
    }),
  );

  editandoId: string | null = null;
  abrirForm = false;
  salvando = false;
  enviandoImagem: SlotImagem | null = null;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    tipo: ['patrocinador' as 'patrocinador' | 'apoiador' | 'organizador'],
    logoUrl:        [''],
    logoPath:       [''],
    bannerAppUrl:   [''],
    bannerAppPath:  [''],
    bannerSiteUrl:        [''],
    bannerSitePath:       [''],
    bannerSiteMobileUrl:  [''],
    bannerSiteMobilePath: [''],
    bannerAppMobileUrl:   [''],
    bannerAppMobilePath:  [''],
    tempoBanner:          [5],
    site:                 [''],
    telefone:             [''],
    link:                 [''],
  });

  /** Toggle do form: alterna entre editar o banner WEB e o MOBILE
   *  nas seções "Banner do aplicativo" e "Banner dos jogos". */
  modoBannerApp:   'web' | 'mobile' = 'web';
  modoBannerJogos: 'web' | 'mobile' = 'web';

  ngOnInit(): void {
    // Snapshot inicial — necessário pra outras lógicas síncronas saberem
    // o contexto antes do stream patrocinadores$ emitir.
    this.campeonatoCtxId = this.route.snapshot.queryParamMap.get('campeonatoId');
  }

  /** Volta pra tela anterior real (campeonato de onde foi aberto).
   *  Fallback: `/app/meus-campeonatos` quando não há histórico. */
  voltar(): void {
    this.navBack.back('/app/meus-campeonatos');
  }

  /** Indica se o patrocinador está vinculado ao campeonato do contexto.
   *  Lista vazia em `campeonatosVisivel` = legado/"todos" → vinculado.
   *  Caso contrário, vinculado se o id está na lista. */
  vinculadoAoCampeonato(p: Patrocinador): boolean {
    if (!this.campeonatoCtxId) return false;
    const escopo = p.campeonatosVisivel ?? [];
    return escopo.length === 0 || escopo.includes(this.campeonatoCtxId);
  }

  /** Toggle do vínculo: liga ou desliga o patrocinador deste campeonato.
   *  Quando desvincula de um patrocinador "global" (escopo vazio), passa
   *  pra "específico" copiando os campeonatos do organizador que não são
   *  esse — pra preservar a visibilidade nos outros. */
  async alternarVinculo(p: Patrocinador, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!this.campeonatoCtxId || !p.id) return;
    const escopoAtual = p.campeonatosVisivel ?? [];
    const estaVinculado = this.vinculadoAoCampeonato(p);

    let novoEscopo: string[];
    if (estaVinculado) {
      // Desvincular: se era "global" (vazio), precisa converter pra lista
      // de campeonatos SEM o atual. Buscamos os outros do organizador.
      if (escopoAtual.length === 0) {
        try {
          const todos = await this.todosCampeonatosIds();
          novoEscopo = todos.filter(id => id !== this.campeonatoCtxId);
        } catch {
          novoEscopo = [];
        }
      } else {
        novoEscopo = escopoAtual.filter(id => id !== this.campeonatoCtxId);
      }
    } else {
      // Vincular: adiciona à lista (se era vazia, fica só com este id).
      novoEscopo = [...escopoAtual, this.campeonatoCtxId];
    }

    try {
      await this.usersSrv.atualizarPatrocinador(p.id, {
        campeonatosVisivel: novoEscopo,
      });
      await this.toast(
        estaVinculado ? 'Desvinculado deste campeonato.' : 'Vinculado a este campeonato.',
        'success',
      );
    } catch (err) {
      console.error('[Patrocinadores] alternar vínculo erro', err);
      await this.toast('Falha ao atualizar vínculo.', 'danger');
    }
  }

  /** Lista IDs de todos os campeonatos do usuário (cache simples).
   *  Usado quando precisamos "materializar" um escopo "global" antes de
   *  remover deste campeonato. */
  private async todosCampeonatosIds(): Promise<string[]> {
    return new Promise(resolve => {
      const sub = this.campsSrv.listMeus$().subscribe(camps => {
        resolve(camps.map(c => c.id!).filter(Boolean));
        setTimeout(() => sub.unsubscribe(), 0);
      });
    });
  }

  novo(): void {
    this.editandoId = null;
    this.modoBannerApp = 'web';
    this.modoBannerJogos = 'web';
    this.form.reset({
      nome: '',
      tipo: 'patrocinador',
      logoUrl: '', logoPath: '',
      bannerAppUrl: '', bannerAppPath: '',
      bannerAppMobileUrl: '', bannerAppMobilePath: '',
      bannerSiteUrl: '', bannerSitePath: '',
      bannerSiteMobileUrl: '', bannerSiteMobilePath: '',
      tempoBanner: 5,
      site: '', telefone: '', link: '',
    });
    this.abrirForm = true;
  }

  editar(p: Patrocinador): void {
    this.editandoId = p.id ?? null;
    this.modoBannerApp = 'web';
    this.modoBannerJogos = 'web';
    this.form.patchValue({
      nome: p.nome,
      tipo: p.tipo ?? 'patrocinador',
      logoUrl:              p.logoUrl              ?? '',
      logoPath:             p.logoPath             ?? '',
      bannerAppUrl:         p.bannerAppUrl         ?? '',
      bannerAppPath:        p.bannerAppPath        ?? '',
      bannerAppMobileUrl:   p.bannerAppMobileUrl   ?? '',
      bannerAppMobilePath:  p.bannerAppMobilePath  ?? '',
      bannerSiteUrl:        p.bannerSiteUrl        ?? '',
      bannerSitePath:       p.bannerSitePath       ?? '',
      bannerSiteMobileUrl:  p.bannerSiteMobileUrl  ?? '',
      bannerSiteMobilePath: p.bannerSiteMobilePath ?? '',
      tempoBanner:          p.tempoBanner          ?? 5,
      site:     p.site     ?? '',
      telefone: p.telefone ?? '',
      link:     p.link     ?? '',
    });
    this.abrirForm = true;
  }

  fechar(): void {
    this.abrirForm = false;
    this.editandoId = null;
  }

  // ============ Upload de imagens ============

  abrirPicker(slot: SlotImagem): void {
    const input = slot === 'logo'             ? this.logoPicker?.nativeElement
      : slot === 'bannerApp'        ? this.bannerAppPicker?.nativeElement
      : slot === 'bannerAppMobile'  ? this.bannerAppMobilePicker?.nativeElement
      : slot === 'bannerSiteMobile' ? this.bannerSiteMobilePicker?.nativeElement
      : this.bannerSitePicker?.nativeElement;
    input?.click();
  }

  async onArquivoEscolhido(ev: Event, slot: SlotImagem): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    // Aspect-ratio por slot:
    //  - bannerApp:        805/453 (landscape clássico, card desktop)
    //  - bannerAppMobile:  380/126 (~3:1, faixa wide pra mobile —
    //    usuário pediu esse tamanho específico pra otimizar área
    //    em telas estreitas)
    //  - bannerSite:       970/130 (faixa wide do banner dos jogos
    //    no web — aumentamos de 90 pra 130 pra dar mais espaço visual)
    //  - bannerSiteMobile: 640/200 (mais alto, jogos mobile)
    const aspect = slot === 'logo' ? 1
      : slot === 'bannerApp'        ? 805 / 453
      : slot === 'bannerAppMobile'  ? 380 / 126
      : slot === 'bannerSiteMobile' ? 640 / 200
      : 970 / 130;
    const title  = slot === 'logo' ? 'Ajustar logo'
      : slot === 'bannerApp'        ? 'Ajustar banner do aplicativo (web)'
      : slot === 'bannerAppMobile'  ? 'Ajustar banner do aplicativo (mobile)'
      : slot === 'bannerSiteMobile' ? 'Ajustar banner dos jogos (mobile)'
      : 'Ajustar banner dos jogos (web)';

    const modal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: { file, aspectRatio: aspect, title },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ blob?: Blob }>();
    if (!data?.blob) return;

    await this.uploadImagem(slot, data.blob);
  }

  private async uploadImagem(slot: SlotImagem, blob: Blob): Promise<void> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      await this.toast('Você precisa estar logado.', 'danger');
      return;
    }
    this.enviandoImagem = slot;
    const loader = await this.loadingCtrl.create({ message: 'Enviando imagem...' });
    await loader.present();
    try {
      const ext = blob.type.includes('png') ? 'png' : 'jpg';
      const patroSubpath = this.editandoId ?? `novo-${Date.now()}`;
      const path = `users/${uid}/patrocinadores/${patroSubpath}/${slot}.${ext}`;
      const url = await this.storage.upload(path, blob);

      // Se já havia uma imagem anterior, tenta apagar.
      const pathField = slot === 'logo' ? 'logoPath'
        : slot === 'bannerApp'        ? 'bannerAppPath'
        : slot === 'bannerAppMobile'  ? 'bannerAppMobilePath'
        : slot === 'bannerSiteMobile' ? 'bannerSiteMobilePath'
        : 'bannerSitePath';
      const pathAnterior = this.form.value[pathField] as string;
      if (pathAnterior && pathAnterior !== path) {
        try { await this.storage.remove(pathAnterior); } catch { /* ignore */ }
      }

      if (slot === 'logo') {
        this.form.patchValue({ logoUrl: url, logoPath: path });
      } else if (slot === 'bannerApp') {
        this.form.patchValue({ bannerAppUrl: url, bannerAppPath: path });
      } else if (slot === 'bannerAppMobile') {
        this.form.patchValue({ bannerAppMobileUrl: url, bannerAppMobilePath: path });
      } else if (slot === 'bannerSiteMobile') {
        this.form.patchValue({ bannerSiteMobileUrl: url, bannerSiteMobilePath: path });
      } else {
        this.form.patchValue({ bannerSiteUrl: url, bannerSitePath: path });
      }
      await this.toast('Imagem enviada.', 'success');
    } catch (err) {
      console.error('[Patrocinadores] upload erro', err);
      await this.toast('Falha no upload.', 'danger');
    } finally {
      this.enviandoImagem = null;
      await loader.dismiss();
    }
  }

  async removerImagem(slot: SlotImagem, ev: Event): Promise<void> {
    ev.stopPropagation();
    const pathField = slot === 'logo' ? 'logoPath'
      : slot === 'bannerApp'        ? 'bannerAppPath'
      : slot === 'bannerAppMobile'  ? 'bannerAppMobilePath'
      : slot === 'bannerSiteMobile' ? 'bannerSiteMobilePath'
      : 'bannerSitePath';
    const urlField  = slot === 'logo' ? 'logoUrl'
      : slot === 'bannerApp'        ? 'bannerAppUrl'
      : slot === 'bannerAppMobile'  ? 'bannerAppMobileUrl'
      : slot === 'bannerSiteMobile' ? 'bannerSiteMobileUrl'
      : 'bannerSiteUrl';
    const pathAtual = this.form.value[pathField] as string;
    if (pathAtual) {
      try { await this.storage.remove(pathAtual); } catch { /* ignore */ }
    }
    this.form.patchValue({ [urlField]: '', [pathField]: '' });
  }

  // ============ Salvar / remover ============

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Preencha o nome.', 'danger');
      return;
    }
    this.salvando = true;
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      const v = this.form.getRawValue();
      const payload: Record<string, unknown> = {
        nome: v.nome.trim(),
        tipo: v.tipo ?? 'patrocinador',
        tempoBanner: v.tempoBanner ? Number(v.tempoBanner) : 5,
      };
      const optKeys: (keyof Patrocinador)[] = [
        'logoUrl', 'logoPath',
        'bannerAppUrl', 'bannerAppPath',
        'bannerAppMobileUrl', 'bannerAppMobilePath',
        'bannerSiteUrl', 'bannerSitePath',
        'bannerSiteMobileUrl', 'bannerSiteMobilePath',
        'site', 'telefone', 'link',
      ];
      for (const k of optKeys) {
        const val = (v as Record<string, string>)[k];
        if (val && val.trim()) payload[k] = val.trim();
      }

      if (this.editandoId) {
        await this.usersSrv.atualizarPatrocinador(this.editandoId, payload as Partial<Patrocinador>);
        await this.toast('Atualizado.', 'success');
      } else {
        // Se aberto a partir de um campeonato (`?campeonatoId=XXX`), já
        // vincula o novo patrocinador APENAS a esse campeonato. Sem essa
        // linha, `campeonatosVisivel` ficaria vazio = aparecer em TODOS
        // os campeonatos (comportamento legado), que não é o esperado
        // quando o user está claramente em um contexto específico.
        if (this.campeonatoCtxId) {
          payload['campeonatosVisivel'] = [this.campeonatoCtxId];
        }
        await this.usersSrv.criarPatrocinador(payload as Omit<Patrocinador, 'id' | 'ownerId' | 'criadoEm'>);
        await this.toast(
          this.campeonatoCtxId
            ? 'Cadastrado e vinculado a este campeonato.'
            : 'Cadastrado.',
          'success',
        );
      }
      this.fechar();
    } catch (err) {
      console.error('[Patrocinadores] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
      await loader.dismiss();
    }
  }

  async remover(p: Patrocinador, ev: Event): Promise<void> {
    ev.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Remover?',
      message: `"${p.nome}" será removido. Os banners e logos também serão apagados.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              const paths = [p.logoPath, p.bannerAppPath, p.bannerSitePath].filter(Boolean) as string[];
              for (const path of paths) {
                try { await this.storage.remove(path); } catch { /* ignore */ }
              }
              await this.usersSrv.removerPatrocinador(p.id!);
              await this.toast('Removido.', 'success');
            } catch (err) {
              console.error('[Patrocinadores] remover erro', err);
              await this.toast('Falha ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  trackById(_i: number, p: Patrocinador): string {
    return p.id ?? '';
  }

  rotuloTipo(t?: string): string {
    if (t === 'apoiador') return 'Apoiador';
    if (t === 'organizador') return 'Organizador';
    return 'Patrocinador';
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
