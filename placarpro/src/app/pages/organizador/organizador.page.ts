import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, map } from 'rxjs';
import { User } from '@angular/fire/auth';
import { AuthService } from '../../auth/auth.service';
import { UsersService } from '../../users/users.service';
import { UserProfile } from '../../users/models/user-profile.model';
import { StorageService } from '../../shared/storage.service';
import { NavBackService } from '../../shared/nav-back.service';
import { ImageCropperModalComponent } from '../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { CampeonatoThemeService } from '../../shared/campeonato-theme.service';

@Component({
  selector: 'app-organizador',
  templateUrl: './organizador.page.html',
  styleUrls: ['./organizador.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class OrganizadorPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly usersSrv = inject(UsersService);
  private readonly storageSrv = inject(StorageService);
  private readonly router = inject(Router);
  private readonly campeonatoTheme = inject(CampeonatoThemeService);
  /** Navegação "voltar" — padrão UX após salvar (histórico + fallback). */
  private readonly navBack = inject(NavBackService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  /** Prefixo do link público (dev: localhost:4200/, prod: domínio real). */
  get linkPrefix(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin.replace(/^https?:\/\//, '') + '/';
  }

  readonly user$: Observable<User | null> = this.auth.user$;

  /** Identidade vinda das configurações (Dados Pessoais): nome + foto.
   *  Combina o `user` do Firebase Auth (sempre presente quando logado)
   *  com o `profile` do Firestore (pode estar null se o user nunca
   *  abriu Configurações). Prioridade: profile → user (fallback). */
  readonly identidade$ = combineLatest([
    this.auth.user$,
    this.usersSrv.profile$(),
  ]).pipe(
    map(([u, p]) => ({
      nome: p?.nome || u?.displayName || u?.email?.split('@')[0] || 'Sem nome',
      fotoUrl: p?.fotoUrl || u?.photoURL || null,
      email: u?.email || '',
    })),
  );

  /** Navega pra tela de configurações (onde nome e foto são editados).
   *  Passa `from=organizador` pra a tela exibir um botão "voltar" no header
   *  e esconder o hamburger — fluxo focado no edit dos dados pessoais. */
  abrirConfiguracoes(): void {
    void this.router.navigate(['/app/configuracoes'], {
      queryParams: { from: 'organizador' },
    });
  }

  /** URL pública do organizador montada com o slug atual.
   *  Aponta pra `/org/{slug}` — página estilo copafacil.com/{slug} que
   *  mostra perfil do organizador + grid de campeonatos públicos dele. */
  private urlPaginaPublica(): string | null {
    const slug = (this.form.value.slug ?? '').trim();
    if (!slug) return null;
    return `${window.location.origin}/org/${slug}`;
  }

  /** Abre a página pública do organizador em uma nova aba (preview de
   *  como visitantes veem). Estilo copafacil.com/{slug}/gallery. */
  abrirPaginaPublica(): void {
    const url = this.urlPaginaPublica();
    if (!url) return;
    window.open(url, '_blank', 'noopener');
  }

  /** Compartilha o link público via Web Share API (iOS/Android nativo)
   *  com fallback pra clipboard. */
  async compartilharLink(): Promise<void> {
    const url = this.urlPaginaPublica();
    if (!url) return;
    const titulo = `${this.form.value.nome || 'PlacarPro'} • Página pública`;
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: titulo, text: 'Acompanhe meus campeonatos no PlacarPro:', url });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      const t = await this.toastCtrl.create({
        message: 'Link copiado para a área de transferência.',
        duration: 2200,
        color: 'success',
        position: 'top',
      });
      await t.present();
    } catch {
      /* ignore */
    }
  }

  carregado = false;
  salvando = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    logoUrl: [''],
    bannerAppUrl: [''],
    bannerSiteUrl: [''],
    corPrimaria: ['#000000'],
    texto1: ['', [Validators.maxLength(70)]],
    texto2: ['', [Validators.maxLength(180)]],
    sobre: [''],
    slug: [''],
    visibilidade: ['privado'],
    tipoEvento: ['presencial'],
    idioma: ['pt-BR'],
    sede: ['Brasil'],
    regiao: [''],
    localizacao: [''],
    email: [''],
    telefone: [''],
    chatAtivo: [true],
    facebook: [''],
    instagram: [''],
    youtube: [''],
    twitch: [''],
    twitter: [''],
    whatsapp: [''],
    telegram: [''],
    site: [''],
  });

  ngOnInit(): void {
    // Live preview da cor da página: aplica nas CSS vars do app
    // assim que o user mexe no color picker — sem precisar salvar.
    this.form.get('corPrimaria')?.valueChanges.subscribe((cor: string) => {
      if (cor && cor.startsWith('#')) this.campeonatoTheme.setCor(cor);
    });

    this.usersSrv.profile$().subscribe(p => {
      if (this.carregado) return;
      const u = this.auth.currentUser;
      if (p) {
        this.form.patchValue({
          nome: p.nome ?? '',
          logoUrl: p.logoUrl ?? p.fotoUrl ?? '',
          bannerAppUrl: p.bannerAppUrl ?? '',
          bannerSiteUrl: p.bannerSiteUrl ?? '',
          corPrimaria: p.corPrimaria ?? '#000000',
          texto1: p.texto1 ?? '',
          texto2: p.texto2 ?? '',
          sobre: p.sobre ?? p.bio ?? '',
          slug: p.slug ?? '',
          visibilidade: p.visibilidade ?? 'privado',
          tipoEvento: p.tipoEvento ?? 'presencial',
          idioma: p.idioma ?? 'pt-BR',
          sede: p.sede ?? 'Brasil',
          regiao: p.regiao ?? '',
          localizacao: p.localizacao ?? '',
          email: p.email ?? u?.email ?? '',
          telefone: p.telefone ?? '',
          chatAtivo: p.chatAtivo ?? true,
          facebook: p.redes?.facebook ?? '',
          instagram: p.redes?.instagram ?? '',
          youtube: p.redes?.youtube ?? '',
          twitch: p.redes?.twitch ?? '',
          twitter: p.redes?.twitter ?? '',
          whatsapp: p.redes?.whatsapp ?? '',
          telegram: p.redes?.telegram ?? '',
          site: p.redes?.site ?? '',
        });
      } else if (u) {
        this.form.patchValue({
          nome: u.displayName ?? '',
          email: u.email ?? '',
        });
      }
      this.carregado = true;
    });
  }

  contador(controlName: string, max: number): string {
    return `${(this.form.get(controlName)?.value as string ?? '').length}/${max}`;
  }

  /**
   * Abre o file picker, depois um modal de crop e finalmente faz upload
   * para o Firebase Storage. Retorna a URL pública pronta pra setar no form.
   */
  async selecionarImagem(
    campo: 'logoUrl' | 'bannerAppUrl' | 'bannerSiteUrl',
    aspectRatio: number,
    titulo: string,
  ): Promise<void> {
    // 1) Cria input file dinamicamente
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    const file = await new Promise<File | null>(resolve => {
      input.onchange = () => {
        const f = input.files?.[0] ?? null;
        document.body.removeChild(input);
        resolve(f);
      };
      // Se o user cancelar o file dialog, removemos o input depois de um delay
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

    if (!file) return;

    // 2) Abre modal de crop
    const modal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: {
        file,
        aspectRatio,
        title: titulo,
        roundCropper: campo === 'logoUrl',
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ blob?: Blob }>();
    if (!data?.blob) return;

    // 3) Upload
    const loader = await this.loadingCtrl.create({ message: 'Enviando imagem...' });
    await loader.present();
    try {
      const tipo: 'avatar' | 'banner-app' | 'banner-site' =
        campo === 'logoUrl' ? 'avatar'
        : campo === 'bannerAppUrl' ? 'banner-app'
        : 'banner-site';
      const url = await this.storageSrv.uploadUserAsset(tipo, data.blob);
      this.form.patchValue({ [campo]: url });
      const t = await this.toastCtrl.create({
        message: 'Imagem enviada! Não esqueça de salvar.',
        duration: 2200,
        color: 'success',
        position: 'top',
      });
      await t.present();
    } catch (err) {
      const t = await this.toastCtrl.create({
        message: 'Erro ao enviar imagem. Verifique as regras do Storage.',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      await loader.dismiss();
    }
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const profile: Partial<UserProfile> = {
      nome: v.nome,
      logoUrl: v.logoUrl,
      bannerAppUrl: v.bannerAppUrl,
      bannerSiteUrl: v.bannerSiteUrl,
      corPrimaria: v.corPrimaria,
      texto1: v.texto1,
      texto2: v.texto2,
      sobre: v.sobre,
      slug: v.slug,
      visibilidade: v.visibilidade,
      tipoEvento: v.tipoEvento,
      idioma: v.idioma,
      sede: v.sede,
      regiao: v.regiao,
      localizacao: v.localizacao,
      email: v.email,
      telefone: v.telefone,
      chatAtivo: v.chatAtivo,
      redes: {
        facebook: v.facebook,
        instagram: v.instagram,
        youtube: v.youtube,
        twitch: v.twitch,
        twitter: v.twitter,
        whatsapp: v.whatsapp,
        telegram: v.telegram,
        site: v.site,
      },
    };
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    this.salvando = true;
    try {
      await this.usersSrv.saveProfile(profile);
      const t = await this.toastCtrl.create({
        message: 'Perfil atualizado!',
        duration: 2200,
        color: 'success',
        position: 'top',
      });
      await t.present();
      // Padrão UX do sistema: salvou → volta. Fallback explícito leva pra
      // /app/meus-campeonatos quando o user veio direto via URL/refresh.
      this.navBack.back('/app/meus-campeonatos');
    } catch {
      const t = await this.toastCtrl.create({
        message: 'Erro ao salvar perfil.',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      this.salvando = false;
      await loader.dismiss();
    }
  }
}
