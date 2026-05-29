import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { NavBackService } from '../../../../shared/nav-back.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { dataHoraIsoParaBr } from '../../../../shared/directives/mask.directive';
import { imprimirPdf, salvarPdf } from '../../../../shared/pdf-download.helper';

interface JogoLinha {
  jogo: Jogo;
  mandante?: Equipe;
  visitante?: Equipe;
  dataBr: string;
}

interface GrupoRodada {
  fase: string;
  rodada: number;
  jogos: JogoLinha[];
}

interface ImprimirView {
  campeonato?: Campeonato;
  categoria?: Categoria;
  totalJogos: number;
  totalEncerrados: number;
  totalAgendados: number;
  grupos: GrupoRodada[];
}

/**
 * Página de impressão da TABELA DE JOGOS (todas as partidas da categoria).
 *
 * Layout A4 portrait: cabeçalho com identificação + lista agrupada por
 * fase/rodada, cada grupo com tabela compacta de partidas. Use o botão
 * "Imprimir" no toolbar pra gerar o PDF.
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/jogos/imprimir`
 */
@Component({
  selector: 'app-imprimir-jogos',
  templateUrl: './imprimir-jogos.page.html',
  styleUrls: ['./imprimir-jogos.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ImprimirJogosPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly navBack = inject(NavBackService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly modalCtrl = inject(ModalController);

  readonly campeonatoId = this.lerParam('id');
  readonly categoriaId = this.lerParam('catId');

  view$: Observable<ImprimirView | undefined> = of(undefined);

  ngOnInit(): void {
    if (!this.campeonatoId || !this.categoriaId) {
      console.error('[ImprimirJogos] params ausentes');
      return;
    }
    this.view$ = this.montarView();
  }

  voltar(): void {
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogos',
    ]);
  }

  /** Imprime — gera PDF via dom-to-image-more + jsPDF e abre em nova aba
   *  com `autoPrint()` (diálogo de impressão aparece automático). */
  async imprimir(): Promise<void> {
    return this.gerarPdf('print');
  }

  /** Baixar PDF — mesma pipeline mas faz `pdf.save()` direto. */
  async baixarPdf(): Promise<void> {
    return this.gerarPdf('download');
  }

  /**
   * Núcleo compartilhado: captura `.folha` via dom-to-image-more clonando
   * pra container offscreen de 210mm (resolve corte no viewport mobile),
   * monta PDF A4 retrato com paginação e ou imprime ou baixa.
   */
  private async gerarPdf(destino: 'print' | 'download'): Promise<void> {
    const folha = document.querySelector('.folha') as HTMLElement | null;
    if (!folha) {
      const t = await this.toastCtrl.create({
        message: 'Conteúdo ainda não está pronto.',
        duration: 1800,
        color: 'warning',
        position: 'top',
      });
      await t.present();
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: destino === 'print' ? 'Preparando impressão...' : 'Gerando PDF...',
      spinner: 'crescent',
    });
    await loading.present();

    const offscreen = document.createElement('div');
    offscreen.style.cssText = `
      position: fixed;
      top: -10000px;
      left: 0;
      width: 210mm;
      background: #ffffff;
      pointer-events: none;
      z-index: -1;
    `;

    try {
      // 1) Inline imgs originais como data URL (CORS-safe)
      await this.inlineImagens(folha);

      // 2) Clone profundo + bordas finas
      const clone = folha.cloneNode(true) as HTMLElement;
      clone.style.transform = 'none';
      clone.style.position = 'static';
      clone.style.margin = '0';
      clone.style.boxShadow = 'none';
      clone.style.setProperty('width', '210mm', 'important');
      clone.style.setProperty('max-width', '210mm', 'important');
      clone.style.setProperty('border-width', '0.5px', 'important');
      clone.querySelectorAll<HTMLElement>('*').forEach(el => {
        el.style.setProperty('border-width', '0.5px', 'important');
      });

      // Força layout DESKTOP no clone (mandante × placar × visitante numa
      // linha). No mobile, @media (≤640px) faz `.mc-body` virar 1 coluna
      // empilhada — html2canvas captura esse layout. Sobrescrevemos inline
      // pra que o PDF saia sempre com layout horizontal.
      clone.querySelectorAll<HTMLElement>('.mc-body').forEach(el => {
        el.style.setProperty('display', 'flex', 'important');
        el.style.setProperty('flex-direction', 'row', 'important');
        el.style.setProperty('align-items', 'center', 'important');
        el.style.setProperty('gap', '14px', 'important');
        el.style.setProperty('text-align', 'initial', 'important');
      });
      clone.querySelectorAll<HTMLElement>('.mc-mandante').forEach(el => {
        el.style.setProperty('flex', '1 1 0', 'important');
        el.style.setProperty('flex-direction', 'row', 'important');
        el.style.setProperty('justify-content', 'flex-end', 'important');
        el.style.setProperty('text-align', 'right', 'important');
      });
      clone.querySelectorAll<HTMLElement>('.mc-visitante').forEach(el => {
        el.style.setProperty('flex', '1 1 0', 'important');
        el.style.setProperty('flex-direction', 'row', 'important');
        el.style.setProperty('justify-content', 'flex-start', 'important');
        el.style.setProperty('text-align', 'left', 'important');
      });
      clone.querySelectorAll<HTMLElement>('.mc-placar').forEach(el => {
        el.style.setProperty('flex', '0 0 auto', 'important');
        el.style.setProperty('margin', '0', 'important');
      });
      clone.querySelectorAll<HTMLElement>('.mc-mandante .mc-time-info').forEach(el => {
        el.style.setProperty('align-items', 'flex-end', 'important');
      });
      clone.querySelectorAll<HTMLElement>('.mc-visitante .mc-time-info').forEach(el => {
        el.style.setProperty('align-items', 'flex-start', 'important');
      });

      offscreen.appendChild(clone);
      document.body.appendChild(offscreen);

      // 3) Aguarda layout + imgs do clone decodificarem
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      const imgsClone = Array.from(clone.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgsClone.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const fin = (): void => resolve();
            img.addEventListener('load', fin, { once: true });
            img.addEventListener('error', fin, { once: true });
            setTimeout(fin, 2000);
          });
        }),
      );

      const rect = clone.getBoundingClientRect();

      // 4) Captura PNG via html2canvas
      const canvas = await html2canvas(clone, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        imageTimeout: 0,
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      });
      // JPEG 0.92 em vez de PNG: ~5x menor, evita Safari iOS rejeitar
      // data URLs gigantes. Usa canvas.width/height direto (sem tmpImg).
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      // 5) Monta PDF A4 retrato com paginação automática
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      if (imgH <= pageH) {
        pdf.addImage(dataUrl, 'JPEG', 0, 0, imgW, imgH);
      } else {
        let restante = imgH;
        let offsetY = 0;
        while (restante > 0) {
          pdf.addImage(dataUrl, 'JPEG', 0, -offsetY, imgW, imgH);
          restante -= pageH;
          if (restante > 0) {
            pdf.addPage();
            offsetY += pageH;
          }
        }
      }

      if (destino === 'print') {
        await imprimirPdf(pdf, 'tabela-partidas.pdf', this.toastCtrl, this.modalCtrl);
      } else {
        // iOS Safari abre PDF inline — salvarPdf usa Web Share API no iOS.
        await salvarPdf(pdf, 'tabela-partidas.pdf', this.toastCtrl, this.modalCtrl);
      }
    } catch (err) {
      console.error(`[ImprimirJogos/${destino}] erro`, err);
      const msg = err instanceof Error ? err.message : String(err);
      const t = await this.toastCtrl.create({
        message: `Erro ao gerar PDF: ${msg}`,
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      try {
        if (offscreen.parentNode) offscreen.parentNode.removeChild(offscreen);
      } catch { /* ignore */ }
      await loading.dismiss();
    }
  }

  /** Converte `<img>` do container em data URL (base64) — evita CORS no
   *  Firebase Storage durante captura. Mesma lógica usada em outras pages. */
  private async inlineImagens(container: HTMLElement): Promise<void> {
    const FALLBACK_TRANSPARENT =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(
      imgs.map(async imgEl => {
        const src = imgEl.getAttribute('src') || '';
        if (!src) return;
        if (src.startsWith('data:image/png') || src.startsWith('data:image/jpeg')) return;
        let dataUrl: string | null = null;
        try {
          dataUrl = await this.urlParaDataUrl(src);
        } catch {
          dataUrl = null;
        }
        if (dataUrl && dataUrl.startsWith('data:image/svg+xml')) {
          try { dataUrl = await this.svgParaPng(dataUrl); } catch { dataUrl = null; }
        }
        imgEl.src = dataUrl || FALLBACK_TRANSPARENT;
        if (imgEl.decode) await imgEl.decode().catch(() => undefined);
      }),
    );
  }

  private svgParaPng(svgDataUrl: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 512;
          c.height = img.naturalHeight || 512;
          const ctx = c.getContext('2d');
          if (!ctx) return reject(new Error('no-ctx'));
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('svg-load-fail'));
      img.src = svgDataUrl;
    });
  }

  private async urlParaDataUrl(src: string): Promise<string | null> {
    try {
      const res = await fetch(src, { mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        return await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      }
    } catch { /* fallback */ }
    return await new Promise<string | null>(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  formatarDataBr(iso?: string | null): string {
    if (!iso) return 'A definir';
    return dataHoraIsoParaBr(iso) || iso;
  }

  rotuloStatus(s: Jogo['status']): string {
    switch (s) {
      case 'encerrado': return 'Encerrado';
      case 'em-andamento': return 'Ao vivo';
      case 'agendado': return 'Agendado';
      case 'cancelado': return 'Cancelado';
      case 'wo': return 'W.O.';
      default: return s;
    }
  }

  private montarView(): Observable<ImprimirView | undefined> {
    const campeonato$ = this.campsSrv.get$(this.campeonatoId).pipe(catchError(() => of(undefined)));
    const categoria$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));
    const jogos$ = this.jogosSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Jogo[]>([]), catchError(() => of<Jogo[]>([])));
    const equipes$ = this.equipesSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Equipe[]>([]), catchError(() => of<Equipe[]>([])));

    return combineLatest([campeonato$, categoria$, jogos$, equipes$]).pipe(
      map(([camp, cat, jogos, equipes]) => {
        const linhas: JogoLinha[] = jogos.map(j => ({
          jogo: j,
          mandante: equipes.find(e => e.id === j.mandanteId),
          visitante: equipes.find(e => e.id === j.visitanteId),
          dataBr: this.formatarDataBr(j.dataHora),
        }));

        // Agrupa por fase + rodada
        const mapa = new Map<string, GrupoRodada>();
        for (const l of linhas) {
          const fase = (l.jogo.fase || '').trim() || 'Geral';
          const rodada = l.jogo.rodada ?? 0;
          const chave = `${fase}__${rodada}`;
          if (!mapa.has(chave)) {
            mapa.set(chave, { fase, rodada, jogos: [] });
          }
          mapa.get(chave)!.jogos.push(l);
        }

        // Ordena os grupos por fase (alfabético) + rodada (numérico)
        const grupos = Array.from(mapa.values()).sort((a, b) => {
          if (a.fase !== b.fase) return a.fase.localeCompare(b.fase, 'pt-BR');
          return a.rodada - b.rodada;
        });

        // Ordena partidas dentro de cada grupo pela data
        for (const g of grupos) {
          g.jogos.sort((a, b) => {
            const da = a.jogo.dataHora ?? '';
            const db = b.jogo.dataHora ?? '';
            return da.localeCompare(db);
          });
        }

        return {
          campeonato: camp,
          categoria: cat,
          totalJogos: jogos.length,
          totalEncerrados: jogos.filter(j => j.status === 'encerrado').length,
          totalAgendados: jogos.filter(j => j.status === 'agendado').length,
          grupos,
        };
      }),
    );
  }

  private lerParam(name: string): string {
    let cursor: ActivatedRoute | null = this.route;
    while (cursor) {
      const v = cursor.snapshot.paramMap.get(name);
      if (v) return v;
      cursor = cursor.parent;
    }
    return '';
  }

  trackByGrupo(_i: number, g: GrupoRodada): string {
    return `${g.fase}__${g.rodada}`;
  }

  trackByJogo(_i: number, l: JogoLinha): string {
    return l.jogo.id ?? '';
  }
}
