import { Component, Input, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { jsPDF } from 'jspdf';
import domtoimage from 'dom-to-image-more';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { NavBackService } from '../../../../shared/nav-back.service';
import { salvarPdf } from '../../../../shared/pdf-download.helper';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import {
  ClassificacaoGrupo,
  ClassificacaoService,
} from '../../../../campeonatos/classificacao.service';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';

interface ImprimirClassifView {
  campeonato?: Campeonato;
  categoria?: Categoria;
  grupos: ClassificacaoGrupo[];
  totalEquipes: number;
  totalJogos: number;
}

/**
 * Página de impressão da CLASSIFICAÇÃO da categoria.
 *
 * Layout A4 portrait com cabeçalho + uma tabela por grupo (ou única se sem
 * agrupamento). Inclui legendas de critérios (P/J/V/E/D/GP/GC/SG/%).
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/classificacao/imprimir`
 */
@Component({
  selector: 'app-imprimir-classificacao',
  templateUrl: './imprimir-classificacao.page.html',
  styleUrls: ['./imprimir-classificacao.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ImprimirClassificacaoPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly classifSrv = inject(ClassificacaoService);
  private readonly navBack = inject(NavBackService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  /** Quando usado como modal, o caller passa os IDs por @Input.
   *  Quando usado como rota, fallback pro route param. */
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  /** Flag setada pelo caller que abre como modal — usada pra trocar
   *  comportamento do botão Voltar (dismiss vs navigate). */
  @Input() modoModal = false;

  view$: Observable<ImprimirClassifView | undefined> = of(undefined);

  ngOnInit(): void {
    // Fallback pra route params quando não veio por @Input (uso como rota).
    if (!this.campeonatoId) this.campeonatoId = this.lerParam('id');
    if (!this.categoriaId) this.categoriaId = this.lerParam('catId');
    if (!this.campeonatoId || !this.categoriaId) {
      console.error('[ImprimirClassif] params ausentes');
      return;
    }
    this.view$ = this.montarView();
  }

  voltar(): void {
    if (this.modoModal) {
      void this.modalCtrl.dismiss();
      return;
    }
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'classificacao',
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
   * pra container offscreen de 210mm (evita corte no viewport mobile),
   * monta PDF A4 retrato com paginação automática e ou imprime ou baixa.
   *
   * Vantagem sobre `window.print()`: o PDF é UMA imagem grande paginada
   * matematicamente — não depende do navegador "tentar adivinhar" onde
   * quebrar tabela. Resultado: nunca corta linhas de tabela ao meio.
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
      clone.style.setProperty('border-width', '0.5px', 'important');
      clone.querySelectorAll<HTMLElement>('*').forEach(el => {
        el.style.setProperty('border-width', '0.5px', 'important');
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

      // 4) Captura PNG via dom-to-image-more
      const dataUrl = await domtoimage.toPng(clone, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scale: 3,
        cacheBust: false,
      });

      // 5) Mede o PNG
      const tmpImg = new Image();
      await new Promise<void>((resolve, reject) => {
        tmpImg.onload = () => resolve();
        tmpImg.onerror = () => reject(new Error('falha ao carregar PNG'));
        tmpImg.src = dataUrl;
      });

      // 6) Monta PDF A4 retrato com paginação automática
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (tmpImg.naturalHeight * imgW) / tmpImg.naturalWidth;
      if (imgH <= pageH) {
        pdf.addImage(dataUrl, 'PNG', 0, 0, imgW, imgH);
      } else {
        let restante = imgH;
        let offsetY = 0;
        while (restante > 0) {
          pdf.addImage(dataUrl, 'PNG', 0, -offsetY, imgW, imgH);
          restante -= pageH;
          if (restante > 0) {
            pdf.addPage();
            offsetY += pageH;
          }
        }
      }

      if (destino === 'print') {
        pdf.autoPrint();
        const blobUrl = pdf.output('bloburl');
        window.open(blobUrl, '_blank');
      } else {
        // iOS Safari abre PDF inline — salvarPdf usa Web Share API no iOS.
        await salvarPdf(pdf, 'classificacao.pdf');
      }
    } catch (err) {
      console.error(`[ImprimirClassif/${destino}] erro`, err);
      const t = await this.toastCtrl.create({
        message: 'Erro ao gerar PDF.',
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
    const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.all(
      imgs.map(async imgEl => {
        const src = imgEl.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) return;
        try {
          const dataUrl = await this.urlParaDataUrl(src);
          if (dataUrl) {
            imgEl.src = dataUrl;
            if (imgEl.decode) await imgEl.decode().catch(() => undefined);
          }
        } catch { /* ignore */ }
      }),
    );
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

  private montarView(): Observable<ImprimirClassifView | undefined> {
    const campeonato$ = this.campsSrv.get$(this.campeonatoId).pipe(catchError(() => of(undefined)));
    const categoria$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));
    // Passa fase=null (todas) + manual=false (ordenação por critério)
    const classif$ = this.classifSrv
      .classificacao$(this.campeonatoId, this.categoriaId, null, false)
      .pipe(
        startWith<ClassificacaoGrupo[]>([]),
        catchError(() => of<ClassificacaoGrupo[]>([])),
      );

    return combineLatest([campeonato$, categoria$, classif$]).pipe(
      map(([camp, cat, grupos]) => {
        const totalEquipes = grupos.reduce((s, g) => s + g.linhas.length, 0);
        const totalJogos = grupos.reduce(
          (s, g) => s + g.linhas.reduce((sj, l) => sj + l.jogos, 0),
          0,
        ) / 2; // cada jogo conta duas vezes (uma por equipe)
        return {
          campeonato: camp,
          categoria: cat,
          grupos,
          totalEquipes,
          totalJogos: Math.round(totalJogos),
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

  trackByGrupo(_i: number, g: ClassificacaoGrupo): string {
    return g.grupo?.id ?? '__all';
  }

  trackByLinha(_i: number, l: { equipe: { id?: string } }): string {
    return l.equipe.id ?? '';
  }

  today(): string {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  }
}
