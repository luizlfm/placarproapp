import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of, switchMap } from 'rxjs';
import { map } from 'rxjs/operators';
import { MidiasService } from '../../../campeonatos/midias.service';
import { Midia, MidiaTipo, NovaMidiaInput } from '../../../campeonatos/models/midia.model';
import { AdicionarLinkModalComponent } from '../../../shared/midia/adicionar-link/adicionar-link.modal';
import { CriarNoticiaModalComponent } from '../../../shared/midia/criar-noticia/criar-noticia.modal';
import { YoutubeModalComponent } from '../../../shared/midia/youtube/youtube.modal';
import { ViewerModalComponent } from '../../../shared/midia/viewer/viewer.modal';
import { MidiaAcao, MidiaAcoesModalComponent } from '../../../shared/midia/midia-acoes/midia-acoes.modal';
import { EditarMidiaModalComponent } from '../../../shared/midia/editar-midia/editar-midia.modal';

type GaleriaModo = 'foto' | 'video';
type FiltroMidia = 'todas' | MidiaTipo;
interface FiltroOpcao { id: FiltroMidia; label: string; icon: string; }

@Component({
  selector: 'app-camp-midia',
  templateUrl: './midia.page.html',
  styleUrls: ['./midia.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class MidiaPage {
  private readonly route = inject(ActivatedRoute);
  private readonly midias = inject(MidiasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  @ViewChild('filePicker') filePicker?: ElementRef<HTMLInputElement>;

  readonly campeonatoId = this.route.parent?.snapshot.paramMap.get('id')
    ?? this.route.snapshot.paramMap.get('id')
    ?? '';

  readonly midias$: Observable<Midia[]> = this.route.paramMap.pipe(
    switchMap(() => this.campeonatoId ? this.midias.list$(this.campeonatoId) : of([])),
  );

  // Filtros do grid (chip-bar acima dos cards).
  readonly filtroMidia$ = new BehaviorSubject<FiltroMidia>('todas');
  readonly filtros: FiltroOpcao[] = [
    { id: 'todas',   label: 'Todas',    icon: 'apps-outline' },
    { id: 'foto',    label: 'Fotos',    icon: 'image-outline' },
    { id: 'video',   label: 'Vídeos',   icon: 'film-outline' },
    { id: 'youtube', label: 'YouTube',  icon: 'logo-youtube' },
    { id: 'noticia', label: 'Notícias', icon: 'newspaper-outline' },
    { id: 'link',    label: 'Links',    icon: 'globe-outline' },
  ];

  /** Contadores por tipo — usados nos chips. */
  readonly contadores$: Observable<Record<FiltroMidia, number>> = this.midias$.pipe(
    map(mds => this.calcularContadores(mds)),
  );
  /** Lista filtrada com base no chip selecionado. */
  readonly midiasFiltradas$: Observable<Midia[]> = combineLatest([
    this.midias$, this.filtroMidia$,
  ]).pipe(
    map(([mds, f]) => (f === 'todas' ? mds : mds.filter(m => m.tipo === f))),
  );

  private galeriaModo: GaleriaModo = 'foto';

  selecionarFiltro(f: FiltroMidia): void {
    this.filtroMidia$.next(f);
  }

  private calcularContadores(mds: Midia[]): Record<FiltroMidia, number> {
    const c: Record<FiltroMidia, number> = {
      todas: mds.length, foto: 0, video: 0, youtube: 0, noticia: 0, link: 0,
    };
    for (const m of mds) c[m.tipo]++;
    return c;
  }

  trackByFiltro(_i: number, f: FiltroOpcao): string { return f.id; }

  /**
   * Abre o menu de ações como modal (em vez de ActionSheet). O modal devolve
   * via dismiss o id da ação escolhida, e roteamos pra cá. Esse mapping em um
   * lugar só evita duplicação de strings entre o template e o handler.
   */
  async abrirMenu(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: MidiaAcoesModalComponent,
      cssClass: 'midia-acoes-modal',
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ acao?: MidiaAcao }>();
    if (!data?.acao) return;
    this.dispatchAcao(data.acao);
  }

  private dispatchAcao(acao: MidiaAcao): void {
    switch (acao) {
      case 'galeria':       this.acionarUpload('foto'); break;
      case 'video':         this.acionarUpload('video'); break;
      case 'link':          void this.abrirModalLink(); break;
      case 'noticia':       void this.abrirModalNoticia(); break;
      case 'youtube':       void this.abrirModalYoutube(); break;
      case 'baixar-todas':  void this.baixarTodas(); break;
      case 'exportar':      void this.exportar(); break;
    }
  }

  /** Dispara o file picker. */
  private acionarUpload(modo: GaleriaModo): void {
    this.galeriaModo = modo;
    const input = this.filePicker?.nativeElement;
    if (!input) return;
    input.accept = modo === 'foto' ? 'image/*' : 'video/*';
    input.value = '';
    input.click();
  }

  /** Quando o usuário escolhe um/mais arquivos. */
  async onFilesEscolhidos(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    const loader = await this.loadingCtrl.create({ message: `Enviando ${files.length} arquivo(s)...` });
    await loader.present();
    let okCount = 0;
    try {
      for (const file of files) {
        try {
          const { url, path } = await this.midias.uploadArquivo(this.campeonatoId, file);
          const input: NovaMidiaInput = {
            campeonatoId: this.campeonatoId,
            tipo: this.galeriaModo === 'foto' ? 'foto' : 'video',
            titulo: file.name,
            arquivoUrl: url,
            arquivoPath: path,
            arquivoBytes: file.size,
            arquivoMime: file.type,
          };
          await this.midias.criar(this.campeonatoId, input);
          okCount++;
        } catch (err) {
          console.error('Falha ao enviar', file.name, err);
        }
      }
      await this.toast(`${okCount} de ${files.length} mídia(s) enviada(s).`, okCount ? 'success' : 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  async abrirModalLink(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: AdicionarLinkModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  async abrirModalNoticia(midia?: Midia): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: CriarNoticiaModalComponent,
      componentProps: { campeonatoId: this.campeonatoId, midia },
    });
    await modal.present();
  }

  async abrirModalYoutube(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: YoutubeModalComponent,
      componentProps: { campeonatoId: this.campeonatoId },
    });
    await modal.present();
  }

  /** Clique no card: abre o viewer apropriado. */
  async abrir(midia: Midia): Promise<void> {
    if (midia.tipo === 'noticia') {
      return this.abrirModalNoticia(midia);
    }
    if (midia.tipo === 'link' && midia.url) {
      window.open(midia.url, '_blank', 'noopener');
      return;
    }
    const modal = await this.modalCtrl.create({
      component: ViewerModalComponent,
      componentProps: { midia },
      cssClass: 'midia-viewer-modal',
    });
    await modal.present();
  }

  /**
   * Abre o modal de edição apropriado conforme o tipo da mídia.
   * Cada modal específico já entende o modo edição via `@Input() midia`.
   */
  async editar(ev: Event, midia: Midia): Promise<void> {
    ev.stopPropagation();
    const componentMap = {
      noticia: CriarNoticiaModalComponent,
      youtube: YoutubeModalComponent,
      link:    AdicionarLinkModalComponent,
      // foto/video usam o modal genérico (só edita título/descrição)
      foto:    EditarMidiaModalComponent,
      video:   EditarMidiaModalComponent,
    } as const;
    const component = componentMap[midia.tipo];
    if (!component) return;
    const modal = await this.modalCtrl.create({
      component,
      componentProps: { campeonatoId: this.campeonatoId, midia },
    });
    await modal.present();
  }

  async confirmarRemover(ev: Event, midia: Midia): Promise<void> {
    ev.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Remover mídia?',
      message: midia.titulo ?? 'Esta mídia será removida.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.midias.remover(this.campeonatoId, midia);
              await this.toast('Mídia removida.', 'success');
            } catch (err) {
              console.error(err);
              await this.toast('Não foi possível remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Gera um arquivo .json com a lista de mídias e dispara o download. */
  async exportar(): Promise<void> {
    try {
      const items = await firstValueFrom(this.midias.list$(this.campeonatoId));
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `midias-campeonato-${this.campeonatoId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await this.toast(`${items.length} mídia(s) exportada(s).`, 'success');
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao exportar.', 'danger');
    }
  }

  /** Baixa o arquivo de uma foto/vídeo. Para link/youtube: abre em nova aba. */
  async baixarMidia(ev: Event, m: Midia): Promise<void> {
    ev.stopPropagation();
    if (m.tipo === 'link' && m.url) {
      window.open(m.url, '_blank', 'noopener');
      return;
    }
    if (m.tipo === 'youtube' && m.youtubeId) {
      window.open(`https://youtube.com/watch?v=${m.youtubeId}`, '_blank', 'noopener');
      return;
    }
    if (m.tipo === 'noticia') {
      await this.toast('Notícias não são baixáveis. Exporte como JSON.', 'danger');
      return;
    }
    if (!m.arquivoUrl) {
      await this.toast('Sem arquivo para baixar.', 'danger');
      return;
    }
    const loader = await this.loadingCtrl.create({ message: 'Baixando...' });
    await loader.present();
    try {
      const resp = await fetch(m.arquivoUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const ext = this.extensaoDaMidia(m, blob.type);
      const nomeBase = (m.titulo || `midia-${m.id ?? 'sem-id'}`)
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^a-z0-9_\-. ]/gi, '_')
        .trim() || 'midia';
      this.downloadBlob(blob, `${nomeBase}.${ext}`);
      await this.toast('Download iniciado.', 'success');
    } catch (err) {
      console.error('[Midia] download erro', err);
      await this.toast('Erro ao baixar (CORS ou rede).', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  /** Baixa todas as fotos/vídeos do campeonato em sequência. */
  async baixarTodas(): Promise<void> {
    const items = await firstValueFrom(this.midias.list$(this.campeonatoId));
    const baixaveis = items.filter(
      m => (m.tipo === 'foto' || m.tipo === 'video') && m.arquivoUrl,
    );
    if (baixaveis.length === 0) {
      await this.toast('Nenhuma foto ou vídeo para baixar.', 'danger');
      return;
    }
    const confirm = await this.alertCtrl.create({
      header: 'Baixar todas?',
      message: `${baixaveis.length} arquivo(s) serão baixados em sequência. O navegador pode pedir confirmação para múltiplos downloads.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Baixar',
          handler: async () => {
            const loader = await this.loadingCtrl.create({
              message: `Baixando 0 de ${baixaveis.length}...`,
            });
            await loader.present();
            let ok = 0;
            let falhas = 0;
            for (let i = 0; i < baixaveis.length; i++) {
              const m = baixaveis[i];
              loader.message = `Baixando ${i + 1} de ${baixaveis.length}...`;
              try {
                const resp = await fetch(m.arquivoUrl!);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const blob = await resp.blob();
                const ext = this.extensaoDaMidia(m, blob.type);
                const nomeBase = (m.titulo || `midia-${m.id ?? i}`)
                  .replace(/\.[a-z0-9]+$/i, '')
                  .replace(/[^a-z0-9_\-. ]/gi, '_')
                  .trim() || `midia-${i + 1}`;
                this.downloadBlob(blob, `${nomeBase}.${ext}`);
                ok++;
                await new Promise(r => setTimeout(r, 250));
              } catch (err) {
                console.error('[Midia] baixarTodas erro', err);
                falhas++;
              }
            }
            await loader.dismiss();
            const msg = falhas === 0
              ? `${ok} mídia(s) baixada(s) com sucesso.`
              : `${ok} baixadas, ${falhas} com erro.`;
            await this.toast(msg, falhas === 0 ? 'success' : 'danger');
          },
        },
      ],
    });
    await confirm.present();
  }

  baixavel(m: Midia): boolean {
    return (m.tipo === 'foto' || m.tipo === 'video') && !!m.arquivoUrl;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  private extensaoDaMidia(m: Midia, mime: string): string {
    const match = (m.titulo ?? '').match(/\.([a-z0-9]+)$/i);
    if (match) return match[1].toLowerCase();
    if (mime.includes('jpeg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('quicktime')) return 'mov';
    return m.tipo === 'video' ? 'mp4' : 'jpg';
  }

  /** Thumbnail mostrado no card. */
  thumb(m: Midia): string | null {
    if (m.tipo === 'foto') return m.arquivoUrl ?? null;
    if (m.tipo === 'noticia') return m.capaUrl ?? null;
    if (m.tipo === 'youtube' && m.youtubeId) {
      return `https://i.ytimg.com/vi/${m.youtubeId}/hqdefault.jpg`;
    }
    return null;
  }

  iconePorTipo(tipo: Midia['tipo']): string {
    switch (tipo) {
      case 'foto':    return 'image-outline';
      case 'video':   return 'film-outline';
      case 'youtube': return 'logo-youtube';
      case 'link':    return 'globe-outline';
      case 'noticia': return 'newspaper-outline';
    }
  }

  labelTipo(tipo: Midia['tipo']): string {
    switch (tipo) {
      case 'foto':    return 'Foto';
      case 'video':   return 'Vídeo';
      case 'youtube': return 'YouTube';
      case 'link':    return 'Link';
      case 'noticia': return 'Notícia';
    }
  }

  trackById(_i: number, m: Midia): string {
    return m.id ?? `${m.tipo}-${_i}`;
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'top',
      color,
    });
    await t.present();
  }
}
