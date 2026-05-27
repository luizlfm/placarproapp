import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { StorageService } from '../../../shared/storage.service';
import { NavBackService } from '../../../shared/nav-back.service';
import { CampeonatoThemeService } from '../../../shared/campeonato-theme.service';
import { ImageCropperModalComponent } from '../../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { ListaSimplesModalComponent, CampoListaStr } from '../../../shared/config-modals/lista-simples-modal/lista-simples-modal.component';
import { LocaisCadastradosModalComponent } from '../../../shared/config-modals/locais-cadastrados-modal/locais-cadastrados-modal.component';
import { ExibicaoModalComponent } from '../../../shared/config-modals/exibicao-modal/exibicao-modal.component';
import { InfoModalComponent, InfoTipo } from '../../../shared/config-modals/info-modal/info-modal.component';
import { AnexosModalComponent } from '../../../shared/config-modals/anexos-modal/anexos-modal.component';
import { PatrocinadoresModalComponent } from '../../../shared/config-modals/patrocinadores-modal/patrocinadores-modal.component';
import { ModeradoresModalComponent } from '../../../shared/config-modals/moderadores-modal/moderadores-modal.component';
import { MedalhasModalComponent } from '../../../shared/config-modals/medalhas-modal/medalhas-modal.component';
import { EnquetesModalComponent } from '../../../shared/config-modals/enquetes-modal/enquetes-modal.component';
import { SeguidoresModalComponent } from '../../../shared/components/seguidores-modal/seguidores-modal.component';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-camp-config',
  templateUrl: './config.page.html',
  styleUrls: ['./config.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ConfigPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly storageSrv = inject(StorageService);
  /** Navegação "voltar" — padrão UX após salvar (histórico do browser
   *  com fallback explícito quando histórico vazio). */
  private readonly navBack = inject(NavBackService);
  private readonly campTheme = inject(CampeonatoThemeService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  carregado = false;
  salvando = false;

  /** Modo de edição/preview de cada asset: 'web' (default) ou 'mobile'.
   *  Não é persistido — só dirige qual campo do form recebe upload e
   *  qual variante é mostrada no preview. */
  modoLogo: 'web' | 'mobile' = 'web';
  modoCapa: 'web' | 'mobile' = 'web';

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(3)]],
    subtitulo: [''],
    logoUrl: [''],
    logoMobileUrl: [''],
    capaUrl: [''],
    capaMobileUrl: [''],
    descricao: [''],
    dataInicio: [''],
    dataFim: [''],
    contatoTelefone: [''],
    contatoEmail: [''],
    contatoWhatsapp: [''],
    cor: ['#1C2E3D'],
    regras: [''],
    premiacoes: [''],
    localizacaoTipo: ['presencial'],
    localizacao: [''],
    slug: [''],
    publico: [true],
    permitirComentarios: [true],
    permitirMidiasUsuarios: [false],
  });

  ngOnInit(): void {
    if (!this.campeonatoId) return;
    this.campeonatosSrv.get$(this.campeonatoId).subscribe(camp => {
      if (this.carregado || !camp) return;
      this.shortCode = camp.shortCode ?? '';
      this.slugSalvoOriginal = camp.slug ?? '';

      // Migração: campeonatos criados antes do flag `publico` existir não
      // têm o campo gravado e, por isso, não apareciam na home pública
      // (`where publico == true`). Garante o default `true` retroativamente.
      if (camp.publico === undefined) {
        this.campeonatosSrv
          .atualizar(this.campeonatoId, { publico: true })
          .catch(err => console.error('[CampConfig] migração publico erro', err));
      }

      this.form.patchValue({
        titulo: camp.titulo ?? '',
        subtitulo: camp.subtitulo ?? '',
        logoUrl: camp.logoUrl ?? '',
        logoMobileUrl: camp.logoMobileUrl ?? '',
        capaUrl: camp.capaUrl ?? camp.bannerUrl ?? '',
        capaMobileUrl: camp.capaMobileUrl ?? '',
        descricao: camp.descricao ?? '',
        dataInicio: this.fmtDate(camp.dataInicio),
        dataFim: this.fmtDate(camp.dataFim),
        contatoTelefone: camp.contatoTelefone ?? '',
        contatoEmail: camp.contatoEmail ?? '',
        contatoWhatsapp: camp.contatoWhatsapp ?? '',
        cor: camp.cor ?? '#1C2E3D',
        regras: camp.regras ?? '',
        premiacoes: camp.premiacoes ?? '',
        localizacaoTipo: camp.localizacaoTipo ?? 'presencial',
        localizacao: camp.localizacao ?? '',
        slug: camp.slug ?? '',
        publico: camp.publico ?? true,
        permitirComentarios: camp.permitirComentarios ?? true,
        permitirMidiasUsuarios: camp.permitirMidiasUsuarios ?? false,
      });
      this.carregado = true;

      // Preview em tempo real: aplica a cor no tema assim que o campo é
      // carregado, sem precisar salvar. O valueChanges mantém sincronizado
      // enquanto o usuário interage com o color picker.
      this.campTheme.setCor(camp.cor ?? '#1C2E3D');
    });

    // Preview ao vivo do color picker — reflete instantaneamente na toolbar.
    this.form.controls['cor'].valueChanges.subscribe((cor: string) => {
      this.campTheme.setCor(cor);
    });

    // Auto-sugere slug a partir do título QUANDO o slug está vazio.
    // Se o usuário já digitou um slug custom, respeita — não sobrescreve.
    // O slug sugerido SÓ aparece no input; só vira "salvo" quando o
    // usuário clica em Salvar (ou Copiar / Ver agora, que disparam save).
    this.form.controls['titulo'].valueChanges.subscribe(async (titulo: string) => {
      if (!this.carregado) return;
      // Se já tem slug definido (digitado ou salvo), não mexe.
      if ((this.form.value.slug as string)?.trim()) return;
      if (!titulo || titulo.trim().length < 3) return;
      const slugUnico = await this.campeonatosSrv.gerarSlugUnico(
        titulo,
        this.campeonatoId,
      );
      // Pode ter mudado de novo no meio do await — re-checa antes de aplicar.
      if (!(this.form.value.slug as string)?.trim()) {
        this.form.patchValue({ slug: slugUnico }, { emitEvent: false });
      }
    });
  }

  /**
   * Valida o slug digitado: se está em uso por OUTRO campeonato, sugere
   * uma alternativa com sufixo numérico (ex: "interclubes" duplicado →
   * "interclubes-2"). Chamado no blur do input ou antes de salvar.
   */
  async validarESugerirSlug(): Promise<boolean> {
    const slug = (this.form.value.slug as string)?.trim();
    if (!slug) return true; // vazio é permitido (usa shortCode/id)

    const normalizado = this.campeonatosSrv.slugify(slug);
    if (normalizado !== slug) {
      // Normaliza no input — ex: "Minha Copa!" → "minha-copa"
      this.form.patchValue({ slug: normalizado }, { emitEvent: false });
    }

    const emUso = await this.campeonatosSrv.slugEmUso(
      normalizado,
      this.campeonatoId,
    );
    if (!emUso) return true;

    // Slug em uso → gera alternativa e mostra alerta com a sugestão.
    const sugestao = await this.campeonatosSrv.gerarSlugUnico(
      normalizado,
      this.campeonatoId,
    );
    const alert = await this.alertCtrl.create({
      header: 'Esse link já está em uso',
      message: `O slug "${normalizado}" pertence a outro campeonato. ` +
               `Sugerimos: <strong>${sugestao}</strong>`,
      buttons: [
        { text: 'Editar manualmente', role: 'cancel' },
        {
          text: 'Usar sugestão',
          handler: () => {
            this.form.patchValue({ slug: sugestao });
          },
        },
      ],
    });
    await alert.present();
    await alert.onDidDismiss();
    return false; // bloqueia o save até resolver
  }

  private fmtDate(t: unknown): string {
    if (!t) return '';
    const d = (t as any)?.toDate?.() ?? (t instanceof Date ? t : null);
    if (!d) return '';
    return d.toISOString().slice(0, 10);
  }

  async selecionarImagem(
    campo: 'logoUrl' | 'logoMobileUrl' | 'capaUrl' | 'capaMobileUrl',
    aspectRatio: number,
    titulo: string,
  ): Promise<void> {
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

    const modal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: { file, aspectRatio, title: titulo, roundCropper: false },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ blob?: Blob }>();
    if (!data?.blob) return;

    const loader = await this.loadingCtrl.create({ message: 'Enviando imagem...' });
    await loader.present();
    try {
      // Diretório no Storage por variante — evita sobrescrever a versão web
      // quando o user sobe a mobile (ou vice-versa).
      const tipo =
        campo === 'logoUrl'        ? 'logo'
        : campo === 'logoMobileUrl' ? 'logo-mobile'
        : campo === 'capaUrl'       ? 'capa'
        : /* capaMobileUrl */         'capa-mobile';
      const url = await this.storageSrv.uploadCampeonatoAsset(
        this.campeonatoId,
        tipo,
        data.blob,
      );
      this.form.patchValue({ [campo]: url });
      // Persiste imediatamente — não exige clicar em "Salvar" pra a imagem
      // aparecer na página pública.
      await this.campeonatosSrv.atualizar(this.campeonatoId, { [campo]: url });
      await this.toast('Imagem salva!', 'success');
    } catch (err) {
      console.error(err);
      await this.toast('Erro ao enviar imagem. Confira as Storage Rules.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // Valida slug antes de salvar — se duplicado, abre alert com sugestão
    // e bloqueia o save até o usuário escolher uma alternativa.
    const slugOk = await this.validarESugerirSlug();
    if (!slugOk) return;
    const v = this.form.getRawValue();
    const patch: Partial<Campeonato> = {
      titulo: v.titulo,
      subtitulo: v.subtitulo,
      logoUrl: v.logoUrl,
      logoMobileUrl: v.logoMobileUrl,
      capaUrl: v.capaUrl,
      capaMobileUrl: v.capaMobileUrl,
      descricao: v.descricao,
      contatoTelefone: v.contatoTelefone,
      contatoEmail: v.contatoEmail,
      contatoWhatsapp: v.contatoWhatsapp,
      cor: v.cor,
      regras: v.regras,
      premiacoes: v.premiacoes,
      localizacaoTipo: v.localizacaoTipo,
      localizacao: v.localizacao,
      slug: v.slug,
      publico: v.publico,
      permitirComentarios: v.permitirComentarios,
      permitirMidiasUsuarios: v.permitirMidiasUsuarios,
    };

    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    this.salvando = true;
    try {
      await this.campeonatosSrv.atualizar(this.campeonatoId, patch);
      await this.toast('Campeonato atualizado!', 'success');
      // Padrão UX do sistema: salvou → volta pra tela anterior. Fallback
      // explícito leva pra Início do campeonato (acesso direto via URL).
      this.navBack.back(`/app/campeonato/${this.campeonatoId}/inicio`);
    } catch {
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
      await loader.dismiss();
    }
  }

  /** Shortcode do campeonato (auto-gerado ao criar). Cacheado quando carrega o doc. */
  shortCode = '';

  /** Slug efetivamente salvo no Firestore — usado pra detectar mudança no input
   *  e disparar auto-save no Copiar / Ver agora. */
  slugSalvoOriginal = '';

  /** Slug efetivo da URL pública. Ordem de prioridade:
   *  1) slug custom digitado pelo dono
   *  2) shortCode aleatório auto-gerado
   *  3) ID do Firestore como fallback final
   */
  private slugEfetivo(): string {
    return (
      (this.form.value.slug as string)?.trim() ||
      this.shortCode ||
      this.campeonatoId
    );
  }

  /** URL pública absoluta na origin atual (dev → localhost:4200/<slug>). */
  linkPublicoAtual(): string {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/${this.slugEfetivo()}`;
  }

  /** Prefixo do link visível no input (ex: "localhost:4200/" em dev). */
  get linkPrefix(): string {
    if (typeof window === 'undefined') return '';
    // location.origin = "http://localhost:4200" → tira o protocolo p/ ficar limpo
    return window.location.origin.replace(/^https?:\/\//, '') + '/';
  }

  /**
   * Toggle "Campeonato Privado" — persiste imediatamente no Firestore.
   * Privado ligado → `publico = false` (some da home pública).
   * Privado desligado → `publico = true` (aparece na home pública).
   */
  async onTogglePrivado(privadoLigado: boolean): Promise<void> {
    const novoPublico = !privadoLigado;
    this.form.controls['publico'].setValue(novoPublico);
    if (!this.campeonatoId) return;
    try {
      await this.campeonatosSrv.atualizar(this.campeonatoId, { publico: novoPublico });
      await this.toast(
        novoPublico
          ? 'Campeonato público — aparece na lista pública.'
          : 'Campeonato privado — acessível apenas com o link.',
        'success',
      );
    } catch (err) {
      console.error('[CampConfig] toggle privado erro', err);
      await this.toast('Não foi possível atualizar.', 'danger');
    }
  }

  /** Toggle simples (mídia/comentários) — persiste no Firestore. */
  async onToggleSimples(
    campo: 'permitirMidiasUsuarios' | 'permitirComentarios',
    valor: boolean,
  ): Promise<void> {
    this.form.controls[campo].setValue(valor);
    if (!this.campeonatoId) return;
    try {
      await this.campeonatosSrv.atualizar(this.campeonatoId, { [campo]: valor });
    } catch (err) {
      console.error('[CampConfig] toggle simples erro', err);
      await this.toast('Não foi possível atualizar.', 'danger');
    }
  }

  /**
   * Se o slug digitado no input ainda não foi gravado no Firestore,
   * salva antes — sem isso, abrir `/<slug>` em outra aba resulta em
   * "Campeonato não encontrado".
   */
  private async garantirSlugSalvo(): Promise<void> {
    const slugAtual = (this.form.value.slug as string)?.trim() ?? '';
    const slugSalvo = this.slugSalvoOriginal ?? '';
    if (slugAtual === slugSalvo) return;
    try {
      await this.campeonatosSrv.atualizar(this.campeonatoId, { slug: slugAtual || undefined });
      this.slugSalvoOriginal = slugAtual;
    } catch (err) {
      console.error('[CampConfig] garantirSlugSalvo erro', err);
      throw err;
    }
  }

  async copiarLink(): Promise<void> {
    try {
      await this.garantirSlugSalvo();
    } catch {
      await this.toast('Não consegui salvar o link. Verifique sua conexão.', 'danger');
      return;
    }
    const url = this.linkPublicoAtual();
    try {
      await navigator.clipboard.writeText(url);
      await this.toast('Link copiado!', 'success');
    } catch {
      await this.toast(url, 'success');
    }
  }

  async abrirPublico(): Promise<void> {
    try {
      await this.garantirSlugSalvo();
    } catch {
      await this.toast('Não consegui salvar o link. Verifique sua conexão.', 'danger');
      return;
    }
    const url = `/${this.slugEfetivo()}`;
    window.open(url, '_blank', 'noopener');
  }

  async removerCampeonato(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover campeonato?',
      message:
        'Esta ação não pode ser desfeita. Todas as categorias, equipes e jogos serão apagados.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            await this.campeonatosSrv.remover(this.campeonatoId);
            await this.router.navigateByUrl('/app/meus-campeonatos');
          },
        },
      ],
    });
    await alert.present();
  }

  async emBreve(label: string): Promise<void> {
    await this.toast(`"${label}" em desenvolvimento.`, 'medium');
  }

  // ═══════════════════════ Modais de configuração ═══════════════════════

  /**
   * Abre o modal de lista simples (arbitros) ou o modal especializado de
   * Locais (com geolocalização). Mantido o mesmo nome de método pra não
   * quebrar o template HTML existente.
   */
  async abrirListaSimples(campo: CampoListaStr): Promise<void> {
    if (campo === 'locaisCadastrados') {
      const modal = await this.modalCtrl.create({
        component: LocaisCadastradosModalComponent,
        componentProps: { campeonatoId: this.campeonatoId },
      });
      await modal.present();
      return;
    }
    // Árbitros (string[] simples)
    const meta = { titulo: 'Arbitragem', singular: 'árbitro', icone: 'person-outline' };
    const modal = await this.modalCtrl.create({
      component: ListaSimplesModalComponent,
      componentProps: { campeonatoId: this.campeonatoId, campo, ...meta },
    });
    await modal.present();
  }

  /** Modal de toggles "Exibir nomes / datas". */
  async abrirExibicao(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ExibicaoModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Modal de Anexos (uploads). */
  async abrirAnexos(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: AnexosModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Modal de Patrocinadores. */
  async abrirPatrocinadores(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: PatrocinadoresModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Modal de Moderadores. */
  async abrirModeradores(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ModeradoresModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Modal do Quadro de Medalhas. */
  async abrirMedalhas(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: MedalhasModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Modal de Enquetes (CRUD por categoria). */
  async abrirEnquetes(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: EnquetesModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Modais de informação (HTML embed, API JSON, Visualizações). */
  async abrirInfo(tipo: InfoTipo): Promise<void> {
    // Pega snapshot atual pra mostrar slug e visualizações no modal.
    const camp = await firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId));
    const modal = await this.modalCtrl.create({
      component: InfoModalComponent,
      componentProps: {
        tipo,
        campeonatoId: this.campeonatoId,
        slug: camp?.slug ?? '',
        shortCode: camp?.shortCode ?? '',
        visualizacoes: camp?.visualizacoes ?? 0,
      },
    });
    await modal.present();
  }

  /** Modal de Seguidores (já existia — só precisa ser conectado). */
  async abrirSeguidores(): Promise<void> {
    const camp = await firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId));
    const modal = await this.modalCtrl.create({
      component: SeguidoresModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        total: camp?.seguidores ?? 0,
      },
    });
    await modal.present();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'top', color });
    await t.present();
  }
}
