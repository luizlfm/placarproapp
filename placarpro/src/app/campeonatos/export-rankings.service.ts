import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import type { ModalController, ToastController } from '@ionic/angular';
import { LinhaRanking, TipoRanking } from './rankings.service';
import { Campeonato } from './campeonato.model';
import { Categoria } from './categoria.model';
import { salvarPdf } from '../shared/pdf-download.helper';

interface ExportContext {
  campeonato?: Campeonato;
  categoria?: Categoria;
  tipo: TipoRanking;
  tipoLabel: string;
  tipoCor: string;
  linhas: LinhaRanking[];
}

const TIPO_LABEL: Record<TipoRanking, string> = {
  artilharia: 'Artilharia',
  assistencia: 'Assistências',
  amarelos: 'Cartões Amarelos',
  vermelhos: 'Cartões Vermelhos',
};

const TIPO_COR: Record<TipoRanking, string> = {
  artilharia: '#1C2E3D',
  assistencia: '#4DABF7',
  amarelos: '#F1B500',
  vermelhos: '#E55353',
};

@Injectable({ providedIn: 'root' })
export class ExportRankingsService {
  buildContext(
    tipo: TipoRanking,
    linhas: LinhaRanking[],
    campeonato?: Campeonato,
    categoria?: Categoria,
  ): ExportContext {
    return {
      campeonato,
      categoria,
      tipo,
      tipoLabel: TIPO_LABEL[tipo],
      tipoCor: TIPO_COR[tipo],
      linhas,
    };
  }

  /** Gera e baixa um PDF A4 com layout limpo. */
  async exportarPdf(
    ctx: ExportContext,
    toastCtrl?: ToastController,
    modalCtrl?: ModalController,
  ): Promise<void> {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // ── Header navy ─────────────────────────────────────
    pdf.setFillColor(28, 46, 61); // primary navy
    pdf.rect(0, 0, pageW, 36, 'F');

    // Logo do campeonato (opcional)
    let leftCursor = 12;
    if (ctx.campeonato?.logoUrl) {
      try {
        const dataUrl = await this.loadAsDataUrl(ctx.campeonato.logoUrl);
        pdf.addImage(dataUrl, 'PNG', leftCursor, 8, 20, 20);
        leftCursor += 26;
      } catch {
        /* ignora */
      }
    }

    // Título: nome do campeonato + categoria
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text((ctx.campeonato?.titulo ?? 'PlacarPro').toUpperCase(), leftCursor, 16);

    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text((ctx.categoria?.titulo ?? '').toUpperCase(), leftCursor, 22);

    pdf.setFontSize(8);
    pdf.text(this.dataAtual(), pageW - 12, 16, { align: 'right' });

    // ── Faixa colorida com tipo ─────────────────────────
    const cor = this.hexToRgb(ctx.tipoCor);
    pdf.setFillColor(cor.r, cor.g, cor.b);
    pdf.rect(0, 36, pageW, 16, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`RANKING — ${ctx.tipoLabel.toUpperCase()}`, pageW / 2, 47, { align: 'center' });

    // ── Tabela ─────────────────────────────────────────
    const rows = ctx.linhas.map(l => [
      String(l.pos),
      l.jogador.apelido || l.jogador.nome,
      l.equipe?.nome ?? '—',
      String(l.total),
    ]);

    autoTable(pdf, {
      startY: 60,
      head: [['#', 'Jogador', 'Equipe', 'Total']],
      body: rows,
      theme: 'grid',
      headStyles: {
        fillColor: [28, 46, 61],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 10,
        halign: 'left',
      },
      bodyStyles: {
        fontSize: 11,
        cellPadding: 4,
        textColor: 30,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 60 },
        3: {
          halign: 'right',
          cellWidth: 22,
          fontStyle: 'bold',
          textColor: [28, 46, 61],
        },
      },
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 0) {
          const pos = parseInt(data.cell.raw as string, 10);
          if (pos === 1) data.cell.styles.fillColor = [255, 212, 59];
          else if (pos === 2) data.cell.styles.fillColor = [206, 212, 218];
          else if (pos === 3) data.cell.styles.fillColor = [232, 168, 124];
          if (pos <= 3) data.cell.styles.textColor = [31, 31, 31];
        }
      },
    });

    // ── Footer ──────────────────────────────────────────
    pdf.setFontSize(8);
    pdf.setTextColor(150);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Gerado por PlacarPro · placarpro.app', pageW / 2, pageH - 8, { align: 'center' });

    const fname = this.fileName(ctx, 'pdf');
    // iOS Safari abre PDF inline — salvarPdf usa Web Share API no iOS.
    await salvarPdf(pdf, fname, toastCtrl, modalCtrl);
  }

  /** Gera imagem PNG estilo poster (canva-like) renderizando um template off-screen. */
  async exportarImagem(ctx: ExportContext): Promise<void> {
    // PRÉ-CARREGAMENTO: converte TODAS as imagens (logo do campeonato, fotos
    // de jogadores, escudos de equipes) em data URLs antes de renderizar.
    // Sem isso, o Firebase Storage rejeita o CORS e o html2canvas desenha
    // os círculos vazios (taints o canvas).
    const cache = await this.precarregarImagens(ctx);
    const container = this.renderPoster(ctx, cache);
    document.body.appendChild(container);

    try {
      const canvas = await html2canvas(container, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
      });
      const blob: Blob = await new Promise(res =>
        canvas.toBlob(b => res(b!), 'image/png', 0.95),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName(ctx, 'png');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      document.body.removeChild(container);
    }
  }

  /**
   * Coleta todas as URLs de imagens usadas no poster (logo do campeonato,
   * fotos dos jogadores, escudos das equipes) e devolve um Map
   * URL → dataUrl. URLs que falharem em carregar viram `undefined` no
   * map, e o caller usa o placeholder.
   */
  private async precarregarImagens(ctx: ExportContext): Promise<Map<string, string>> {
    const urls = new Set<string>();
    if (ctx.campeonato?.logoUrl) urls.add(ctx.campeonato.logoUrl);
    for (const l of ctx.linhas.slice(0, 10)) {
      if (l.jogador.fotoUrl) urls.add(l.jogador.fotoUrl);
      if (l.equipe?.logoUrl) urls.add(l.equipe.logoUrl);
    }
    const cache = new Map<string, string>();
    await Promise.all(
      Array.from(urls).map(async u => {
        try {
          const dataUrl = await this.loadAsDataUrl(u);
          cache.set(u, dataUrl);
        } catch (err) {
          console.warn('[Export] falha ao pré-carregar imagem', u, err);
        }
      }),
    );
    return cache;
  }

  // ─────────────────────────────────────────────────────
  private renderPoster(ctx: ExportContext, cache: Map<string, string>): HTMLDivElement {
    const top = ctx.linhas.slice(0, 10);
    const corHex = ctx.tipoCor;

    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      width: 720px;
      background: linear-gradient(160deg, #1C2E3D 0%, #2a4258 60%, ${corHex} 140%);
      color: #fff;
      padding: 48px 36px 32px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-sizing: border-box;
    `;

    const tituloCamp = (ctx.campeonato?.titulo ?? 'PlacarPro').toUpperCase();
    const tituloCat = (ctx.categoria?.titulo ?? '').toUpperCase();
    const logoCampSrc = ctx.campeonato?.logoUrl
      ? cache.get(ctx.campeonato.logoUrl)
      : undefined;

    div.innerHTML = `
      <header style="display:flex; align-items:center; gap:18px; margin-bottom:32px;">
        ${
          logoCampSrc
            ? `<div style="width:72px; height:72px; border-radius:50%; background:#fff; padding:6px; box-shadow:0 4px 14px rgba(0,0,0,0.25); flex:0 0 auto;">
                 <img src="${logoCampSrc}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;" />
               </div>`
            : `<div style="width:72px; height:72px; border-radius:50%; background:rgba(255,255,255,.14); display:flex; align-items:center; justify-content:center; font-size:34px; flex:0 0 auto; box-shadow:0 4px 14px rgba(0,0,0,0.25);">🏆</div>`
        }
        <div style="min-width:0; flex:1;">
          <div style="font-size:22px; font-weight:800; letter-spacing:0.5px; line-height:1.15;">${this.escape(tituloCamp)}</div>
          <div style="font-size:13px; opacity:0.75; letter-spacing:0.8px; margin-top:3px;">${this.escape(tituloCat)}</div>
        </div>
        <div style="text-align:right; font-size:11px; opacity:0.65; letter-spacing:0.4px; flex:0 0 auto;">
          ${this.dataAtual()}
        </div>
      </header>

      <div style="
        display:inline-block;
        background:${corHex};
        color:#fff;
        font-size:13px;
        font-weight:700;
        letter-spacing:1.5px;
        text-transform:uppercase;
        padding:6px 14px;
        border-radius:999px;
        margin-bottom:10px;
        box-shadow:0 2px 8px rgba(0,0,0,0.25);
      ">RANKING</div>

      <h1 style="
        margin:0 0 32px;
        font-size:54px;
        font-weight:900;
        letter-spacing:-1px;
        line-height:1;
        text-transform:uppercase;
      ">${this.escape(ctx.tipoLabel)}</h1>

      <ol style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px;">
        ${top.map(l => this.renderLinhaPoster(l, cache)).join('')}
      </ol>

      ${
        top.length === 0
          ? `<div style="text-align:center; padding:60px 20px; opacity:0.6; font-size:16px;">Sem dados ainda nesse ranking.</div>`
          : ''
      }

      <footer style="
        margin-top:36px;
        padding-top:18px;
        border-top:1px solid rgba(255,255,255,0.15);
        display:flex;
        align-items:center;
        justify-content:space-between;
        font-size:11px;
        opacity:0.7;
        letter-spacing:0.5px;
      ">
        <span>Gerado por <strong>PlacarPro</strong></span>
        <span>placarpro.app</span>
      </footer>
    `;
    return div;
  }

  private renderLinhaPoster(l: LinhaRanking, cache: Map<string, string>): string {
    const medalha =
      l.pos === 1
        ? '#FFD43B'
        : l.pos === 2
          ? '#CED4DA'
          : l.pos === 3
            ? '#E8A87C'
            : null;
    const bg = medalha ? medalha : 'rgba(255,255,255,0.1)';
    const cor = medalha ? '#1f1f1f' : '#fff';

    const fotoSrc = l.jogador.fotoUrl ? cache.get(l.jogador.fotoUrl) : undefined;
    const foto = fotoSrc
      ? `<img src="${fotoSrc}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; background:#fff; display:block;" />`
      : `<div style="width:48px; height:48px; border-radius:50%; background:rgba(255,255,255,.18); display:flex; align-items:center; justify-content:center; font-size:24px;">👤</div>`;

    const equipeLogoSrc = l.equipe?.logoUrl ? cache.get(l.equipe.logoUrl) : undefined;
    const equipeLogo = equipeLogoSrc
      ? `<img src="${equipeLogoSrc}" style="width:22px; height:22px; border-radius:50%; object-fit:cover; background:#fff; display:block;" />`
      : '';

    return `
      <li style="
        display:grid;
        grid-template-columns:48px 48px 1fr auto;
        align-items:center;
        gap:14px;
        background:rgba(255,255,255,${l.pos <= 3 ? 0.14 : 0.08});
        border-radius:14px;
        padding:10px 16px;
        box-shadow:${l.pos <= 3 ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'};
      ">
        <div style="
          width:40px;
          height:40px;
          border-radius:50%;
          background:${bg};
          color:${cor};
          display:flex;
          align-items:center;
          justify-content:center;
          font-size:18px;
          font-weight:800;
          box-shadow:${medalha ? '0 2px 6px rgba(0,0,0,0.25)' : 'none'};
        ">${l.pos}</div>
        ${foto}
        <div style="min-width:0;">
          <div style="font-size:17px; font-weight:700; line-height:1.2; text-transform:uppercase; letter-spacing:0.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${this.escape(l.jogador.apelido || l.jogador.nome)}
          </div>
          <div style="font-size:12px; opacity:0.75; margin-top:2px; display:inline-flex; align-items:center; gap:6px;">
            ${equipeLogo}
            <span>${this.escape(l.equipe?.nome ?? '—')}</span>
          </div>
        </div>
        <div style="
          font-size:30px;
          font-weight:900;
          line-height:1;
          color:${medalha || '#fff'};
        ">${l.total}</div>
      </li>
    `;
  }

  private aguardarImagens(root: HTMLElement): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img'));
    return Promise.all(
      imgs.map(
        img =>
          new Promise<void>(res => {
            if (img.complete && img.naturalHeight !== 0) res();
            else {
              img.onload = () => res();
              img.onerror = () => res();
            }
          }),
      ),
    ).then(() => undefined);
  }

  private loadAsDataUrl(url: string): Promise<string> {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        res(canvas.toDataURL('image/png'));
      };
      img.onerror = () => rej(new Error('Falha ao carregar logo'));
      img.src = url;
    });
  }

  private fileName(ctx: ExportContext, ext: 'pdf' | 'png'): string {
    const slug = (s?: string) =>
      (s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const partes = [
      slug(ctx.campeonato?.titulo),
      slug(ctx.categoria?.titulo),
      slug(ctx.tipoLabel),
    ].filter(Boolean);
    return `ranking-${partes.join('-')}.${ext}`;
  }

  private dataAtual(): string {
    return new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16),
    };
  }

  private escape(s: string): string {
    return (s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
