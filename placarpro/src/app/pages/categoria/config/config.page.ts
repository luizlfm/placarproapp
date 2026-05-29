import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Observable, combineLatest, firstValueFrom, map, of, switchMap } from 'rxjs';
import {
  CONFIG_ESPORTE_PADRAO,
  CartaoTipo,
  Categoria,
  ConfigEsporte,
  Contato,
  LocalizacaoTipo,
} from '../../../campeonatos/categoria.model';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { GruposService } from '../../../campeonatos/grupos.service';
import { FasesService } from '../../../campeonatos/fases.service';
import { GruposModalComponent } from '../../../shared/components/grupos-modal/grupos-modal.component';
import { ImageCropperModalComponent } from '../../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { ModeradoresModalComponent } from '../../../shared/components/moderadores-modal/moderadores-modal.component';
import { SeguidoresModalComponent } from '../../../shared/components/seguidores-modal/seguidores-modal.component';
import { SeguidoresService } from '../../../campeonatos/seguidores.service';
import { StorageService } from '../../../shared/storage.service';
import { AuthService } from '../../../auth/auth.service';
import { ResultadoModalComponent } from '../../../shared/config-modals/resultado-modal/resultado-modal.component';

@Component({
  selector: 'app-cat-config',
  templateUrl: './config.page.html',
  styleUrls: ['./config.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ConfigPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly gruposSrv = inject(GruposService);
  private readonly fasesSrv = inject(FasesService);
  private readonly seguidoresSrv = inject(SeguidoresService);
  private readonly storage = inject(StorageService);
  private readonly auth = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  @ViewChild('anexoPicker')  anexoPicker?:  ElementRef<HTMLInputElement>;

  readonly campeonatoId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly categoriaId  = this.route.snapshot.paramMap.get('catId') ?? '';

  /** Modo de edição/preview de cada asset: 'web' (default) ou 'mobile'.
   *  Não é persistido — só dirige qual campo da categoria recebe upload e
   *  qual variante é mostrada no preview. Mesma lógica do campeonato/config. */
  modoLogo: 'web' | 'mobile' = 'web';
  modoCapa: 'web' | 'mobile' = 'web';

  readonly pontosOpcoes = [0, 1, 2, 3, 4, 5];
  readonly suspensaoOpcoes: (number | 'Não')[] = ['Não', 2, 3, 4, 5, 6, 7, 8];
  readonly contagemJogosOpcoes = [
    { value: 'apenas-titulares', label: 'Apenas titulares' },
    { value: 'titulares-e-reservas', label: 'Jogadores titulares e reservas' },
  ];

  readonly categoria$: Observable<Categoria | undefined> = this.route.paramMap.pipe(
    switchMap(p => {
      const cId = p.get('id');
      const catId = p.get('catId');
      return cId && catId ? this.categoriasSrv.get$(cId, catId) : of(undefined);
    }),
  );

  readonly counters$ = this.campeonatoId && this.categoriaId
    ? combineLatest([
        this.equipesSrv.list$(this.campeonatoId, this.categoriaId),
        this.jogadoresSrv.list$(this.campeonatoId, this.categoriaId),
        this.gruposSrv.list$(this.campeonatoId, this.categoriaId),
        this.fasesSrv.list$(this.campeonatoId, this.categoriaId),
      ]).pipe(
        map(([eqs, jgs, grs, fs]) => ({
          equipes: eqs.length,
          jogadores: jgs.length,
          grupos: grs.length,
          fases: fs.length,
        })),
      )
    : of({ equipes: 0, jogadores: 0, grupos: 0, fases: 0 });

  /** Contagem real-time de seguidores (lê da subcoleção em vez do contador denormalizado). */
  readonly seguidoresCount$ = this.campeonatoId
    ? this.seguidoresSrv.list$(this.campeonatoId).pipe(
        map(arr => arr.length),
      )
    : of(0);

  // ============ Helpers ============
  private async salvar(patch: Partial<Categoria>, msgOk = 'Salvo.'): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;
    try {
      await this.categoriasSrv.atualizar(this.campeonatoId, this.categoriaId, patch);
      await this.toast(msgOk, 'success');
    } catch (err) {
      console.error(err);
      await this.toast('Não foi possível salvar.', 'danger');
    }
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }

  private uid(): string {
    return this.auth.currentUser?.uid ?? 'anon';
  }

  /** Prefixo do link público (dev: localhost:4200/, prod: domínio real). */
  get linkPrefix(): string {
    if (typeof window === 'undefined') return '';
    return window.location.origin + '/';
  }

  configAtual(cat: Categoria): ConfigEsporte {
    return { ...CONFIG_ESPORTE_PADRAO, ...(cat.configEsporte ?? {}) };
  }

  // ============ Link externo ============
  async editarLinkExterno(cat: Categoria): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Link do site',
      message: 'Link público para divulgação (ex: placarproapp.com/meu-campeonato).',
      inputs: [{ name: 'link', type: 'url', value: cat.linkExterno ?? '', placeholder: 'https://...' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { link: string }) => {
            const link = (data.link || '').trim();
            await this.salvar({ linkExterno: link }, link ? 'Link atualizado.' : 'Link removido.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async removerLinkExterno(): Promise<void> {
    await this.salvar({ linkExterno: '' }, 'Link removido.');
  }

  // ============ Dados básicos ============
  async editarTitulo(cat: Categoria): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Editar título',
      inputs: [
        { name: 'titulo', type: 'text', value: cat.titulo, placeholder: 'Título' },
        { name: 'subtitulo', type: 'text', value: cat.subtitulo ?? '', placeholder: 'Subtítulo (opcional)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { titulo: string; subtitulo: string }) => {
            const t = (data.titulo || '').trim();
            if (t.length < 2) {
              await this.toast('Título muito curto.', 'danger');
              return false;
            }
            await this.salvar(
              { titulo: t, subtitulo: (data.subtitulo || '').trim() },
              'Título atualizado.',
            );
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  abrirAnexoPicker(): void { this.anexoPicker?.nativeElement?.click(); }

  /**
   * Abre file picker → cropper → upload → salva o campo correspondente da
   * categoria. Mesma assinatura do `campeonato/config.page.ts` pra dar
   * paridade visual e de fluxo entre as duas telas.
   *
   * Cada `campo` aponta pra uma das 4 variantes (web/mobile × logo/capa):
   *  - logoUrl       → tipo "logo"        (200×240, aspect 5/6 = 0.833)
   *  - logoMobileUrl → tipo "logo-mobile" (200×240, mesmo aspect)
   *  - capaUrl       → tipo "capa"        (1600×400, aspect 4:1)
   *  - capaMobileUrl → tipo "capa-mobile" (1600×533, aspect 3:1)
   */
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
      // Fallback: se o user cancelar o picker (no diálogo nativo), o
      // evento `change` não dispara. Limpa o input no próximo focus pra
      // não vazar nó solto no DOM.
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
      // Mapeia o campo → tipo de path no Storage (separado pra cada variante
      // não sobrescrever a outra).
      const tipo =
        campo === 'logoUrl'        ? 'logo'
        : campo === 'logoMobileUrl' ? 'logo-mobile'
        : campo === 'capaUrl'       ? 'capa'
        : /* capaMobileUrl */         'capa-mobile';
      const url = await this.storage.uploadCategoriaAsset(
        this.campeonatoId,
        this.categoriaId,
        tipo,
        data.blob,
      );
      // Salva direto no Firestore — sem form, sem botão "Salvar" externo.
      // Mantém o padrão da tela (cada ação é persistida na hora).
      const patch: Partial<Categoria> = { [campo]: url };
      await this.salvar(patch, 'Imagem enviada.');
    } catch (err) {
      console.error('[CatConfig] upload imagem erro', err);
      await this.toast('Erro ao enviar imagem. Confira as Storage Rules.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async editarDescricao(cat: Categoria): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Descrição',
      inputs: [{ name: 'descricao', type: 'textarea', value: cat.descricao ?? '', placeholder: 'Descrição livre' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { descricao: string }) => {
            await this.salvar({ descricao: (data.descricao || '').trim() }, 'Descrição atualizada.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editarDataInicio(cat: Categoria): Promise<void> {
    await this.promptData('Data de início', cat.dataInicio, v => ({ dataInicio: v }));
  }
  async editarDataFim(cat: Categoria): Promise<void> {
    await this.promptData('Data de término', cat.dataFim, v => ({ dataFim: v }));
  }

  private async promptData(
    header: string,
    valor: string | undefined,
    toPatch: (v: string) => Partial<Categoria>,
  ): Promise<void> {
    const alert = await this.alertCtrl.create({
      header,
      inputs: [{ name: 'd', type: 'date', value: valor ?? '' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { d: string }) => {
            await this.salvar(toPatch(data.d || ''), 'Data atualizada.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editarContatos(cat: Categoria): Promise<void> {
    const atual = cat.contatos?.[0] ?? {};
    const alert = await this.alertCtrl.create({
      header: 'Contato do organizador',
      inputs: [
        { name: 'nome', type: 'text', value: atual.nome ?? '', placeholder: 'Nome' },
        { name: 'telefone', type: 'tel', value: atual.telefone ?? '', placeholder: 'Telefone / WhatsApp' },
        { name: 'email', type: 'email', value: atual.email ?? '', placeholder: 'E-mail' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: Contato) => {
            const limpo: Contato = {};
            if (data.nome?.trim()) limpo.nome = data.nome.trim();
            if (data.telefone?.trim()) limpo.telefone = data.telefone.trim();
            if (data.email?.trim()) limpo.email = data.email.trim();
            const lista = Object.keys(limpo).length > 0 ? [limpo] : [];
            await this.salvar({ contatos: lista }, 'Contato atualizado.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editarCor(cat: Categoria): Promise<void> {
    const cores = ['#000000', '#7CC61D', '#4DABF7', '#E89132', '#6B47C9', '#E55353', '#F1B500', '#1A1A1A'];
    const alert = await this.alertCtrl.create({
      header: 'Cor da categoria',
      inputs: cores.map(c => ({
        type: 'radio',
        label: c,
        value: c,
        checked: (cat.cor ?? '#000000') === c,
      })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (cor: string) => {
            if (!cor) return false;
            await this.salvar({ cor }, 'Cor atualizada.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editarRegras(cat: Categoria): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Regras do campeonato',
      inputs: [{ name: 'regras', type: 'textarea', value: cat.regras ?? '', placeholder: 'Regras esportivas e disciplinares' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { regras: string }) => {
            await this.salvar({ regras: (data.regras || '').trim() }, 'Regras atualizadas.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async editarPremiacoes(cat: Categoria): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Premiações',
      inputs: [{ name: 'premiacoes', type: 'textarea', value: cat.premiacoes ?? '', placeholder: '1º lugar — ...\n2º lugar — ...' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { premiacoes: string }) => {
            await this.salvar({ premiacoes: (data.premiacoes || '').trim() }, 'Premiações atualizadas.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async onAnexoEscolhido(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (file.size > 25 * 1024 * 1024) {
      await this.toast('Anexo excede 25MB.', 'danger');
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Enviando anexo...' });
    await loader.present();
    try {
      const safe = file.name.replace(/[^a-z0-9._-]/gi, '_');
      const path = `users/${this.uid()}/campeonatos/${this.campeonatoId}/categorias/${this.categoriaId}/anexos/${Date.now()}-${safe}`;
      const url = await this.storage.upload(path, file);
      const cat = await firstValueFrom(this.categoria$);
      const atuais = cat?.anexosUrls ?? [];
      await this.salvar({ anexosUrls: [...atuais, url] }, 'Anexo enviado.');
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao enviar anexo.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async removerAnexo(cat: Categoria, idx: number): Promise<void> {
    const atuais = cat.anexosUrls ?? [];
    const novos = atuais.filter((_, i) => i !== idx);
    await this.salvar({ anexosUrls: novos }, 'Anexo removido.');
  }

  async editarLocalizacao(cat: Categoria): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Localização',
      inputs: [{ name: 'loc', type: 'text', value: cat.localizacao ?? '', placeholder: 'Cidade, estado, endereço' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (data: { loc: string }) => {
            await this.salvar({ localizacao: (data.loc || '').trim() }, 'Localização atualizada.');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async alterarLocalizacaoTipo(tipo: LocalizacaoTipo): Promise<void> {
    await this.salvar({ localizacaoTipo: tipo }, 'Atualizado.');
  }

  // ============ Campeonato (navegação) ============
  async abrirGrupos(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: GruposModalComponent,
      componentProps: { campeonatoId: this.campeonatoId, categoriaId: this.categoriaId },
    });
    await modal.present();
  }

  irPara(rota: string, queryParams?: Record<string, string>): void {
    this.router.navigate(
      ['/app/campeonato', this.campeonatoId, 'categoria', this.categoriaId, rota],
      queryParams ? { queryParams } : undefined,
    );
  }
  irParaJogadoresGlobal(): void { this.router.navigate(['/app/jogadores']); }
  irParaArbitragem(): void { this.router.navigate(['/app/arbitragem']); }
  irParaLocais(): void { this.router.navigate(['/app/locais']); }
  irParaPatrocinadores(): void { this.router.navigate(['/app/patrocinadores']); }

  // ============ Divulgação ============
  async togglePublico(cat: Categoria): Promise<void> {
    await this.salvar({ publico: !(cat.publico ?? true) }, 'Atualizado.');
  }
  async toggleMidiasUsuarios(cat: Categoria): Promise<void> {
    await this.salvar({ permiteMidiasUsuarios: !(cat.permiteMidiasUsuarios ?? false) }, 'Atualizado.');
  }
  async toggleComentarios(cat: Categoria): Promise<void> {
    await this.salvar({ permiteComentarios: !(cat.permiteComentarios ?? true) }, 'Atualizado.');
  }
  async toggleExibirNomes(cat: Categoria): Promise<void> {
    await this.salvar({ exibirNomes: !(cat.exibirNomes ?? true) }, 'Atualizado.');
  }
  async toggleExibirDatas(cat: Categoria): Promise<void> {
    await this.salvar({ exibirDatas: !(cat.exibirDatas ?? true) }, 'Atualizado.');
  }

  async editarModeradores(cat: Categoria): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ModeradoresModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        categoria: cat,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  async abrirSeguidores(cat: Categoria): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: SeguidoresModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        total: cat.seguidores ?? 0,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  qtdModeradores(cat: Categoria): number {
    return (cat.moderadores ?? []).length;
  }

  // ============ Configurações do esporte ============
  async alterarPontos(
    campo: 'pontosVitoria' | 'pontosEmpate' | 'pontosDerrota',
    valor: number,
    cat: Categoria,
  ): Promise<void> {
    const cur = this.configAtual(cat);
    await this.salvar({ configEsporte: { ...cur, [campo]: valor } }, 'Pontuação atualizada.');
  }

  async alterarSuspensao(
    cartao: CartaoTipo,
    raw: string,
    cat: Categoria,
  ): Promise<void> {
    const valor = raw === 'Não' ? 0 : parseInt(raw, 10) || 0;
    const cur = this.configAtual(cat);
    const campo: keyof ConfigEsporte =
      cartao === 'amarelo' ? 'suspensaoAmarelos'
      : cartao === 'vermelho' ? 'suspensaoVermelhos'
      : 'suspensaoAzuis';
    await this.salvar({ configEsporte: { ...cur, [campo]: valor } }, 'Suspensão atualizada.');
  }

  suspensaoValor(n: number): string {
    return n > 0 ? String(n) : 'Não';
  }

  async alterarSepararCartoes(valor: boolean, cat: Categoria): Promise<void> {
    const cur = this.configAtual(cat);
    await this.salvar({ configEsporte: { ...cur, separarCartoesPorFase: valor } }, 'Atualizado.');
  }

  async alterarContagemJogos(
    valor: string,
    cat: Categoria,
  ): Promise<void> {
    const cur = this.configAtual(cat);
    await this.salvar(
      { configEsporte: { ...cur, contagemJogos: valor as ConfigEsporte['contagemJogos'] } },
      'Atualizado.',
    );
  }

  async toggleIncluirAzuis(cat: Categoria): Promise<void> {
    const cur = this.configAtual(cat);
    await this.salvar(
      { configEsporte: { ...cur, incluirCartoesAzuis: !cur.incluirCartoesAzuis } },
      'Atualizado.',
    );
  }

  // ============ Resultado ============
  /**
   * Abre o modal pra organizador declarar a classificação final
   * (campeão, vice, 3º, ...). Salva em `categoria.resultadoFinal`.
   */
  async editarResultado(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ResultadoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ saved?: boolean }>();
    if (data?.saved) {
      await this.toast('Resultado salvo.', 'success');
    }
  }

  trackByIndex(i: number): number {
    return i;
  }
}
