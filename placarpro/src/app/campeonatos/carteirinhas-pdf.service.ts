import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { Equipe } from './models/equipe.model';
import { Jogador } from './models/jogador.model';

/** Opções pré-definidas de tamanho de carteirinha. */
export type TamanhoCarteirinhaId =
  | 'p1-86x59'
  | 'p2-86x59'
  | 'p3-cc'
  | 'p4-cc'
  | 'p5-cc';

export interface TamanhoCarteirinha {
  id: TamanhoCarteirinhaId;
  label: string;
  larguraMm: number;
  alturaMm: number;
  descricao: string;
}

export const TAMANHOS_CARTEIRINHA: TamanhoCarteirinha[] = [
  { id: 'p1-86x59', label: 'Opção 1', larguraMm: 86, alturaMm: 59, descricao: '86mm x 59mm' },
  { id: 'p2-86x59', label: 'Opção 2', larguraMm: 86, alturaMm: 59, descricao: '86mm x 59mm' },
  { id: 'p3-cc',    label: 'Opção 3', larguraMm: 85.6, alturaMm: 53.98, descricao: 'Tamanho Cartão de crédito' },
  { id: 'p4-cc',    label: 'Opção 4', larguraMm: 85.6, alturaMm: 53.98, descricao: 'Tamanho Cartão de crédito' },
  { id: 'p5-cc',    label: 'Opção 5', larguraMm: 85.6, alturaMm: 53.98, descricao: 'Tamanho Cartão de crédito' },
];

/** Mantido pra compat com a modal antiga — não é mais usado no layout fixo. */
export type EspacoCampo =
  | 'numero' | 'apelido' | 'documento' | 'posicao' | 'telefone' | 'vazio';

export interface EspacoOpcao { id: EspacoCampo; label: string; }

export const ESPACO_OPCOES: EspacoOpcao[] = [
  { id: 'numero',    label: 'Nº da camisa/registro' },
  { id: 'apelido',   label: 'Apelido' },
  { id: 'documento', label: 'Documento' },
  { id: 'posicao',   label: 'Posição do jogador' },
  { id: 'telefone',  label: 'Telefone' },
  { id: 'vazio',     label: 'vazio' },
];

export interface CarteirinhaConfig {
  tamanho: TamanhoCarteirinha;
  nomeCampeonato: string;
  /** Subtítulo do campeonato (linha 2 do header). */
  subtitulo: string;
  /** Cor primária — mantida pra compat, não é usada no layout fixo. */
  cor: string;
  /** Logo do campeonato (organização — canto superior esquerdo). */
  logoUrl?: string;
  /** Quando true, desenha também o escudo do evento à direita no header. */
  incluirEscudo: boolean;
  /** Quando true, gera páginas com o verso da carteirinha após as frentes. */
  incluirVerso?: boolean;
  /** Compat — não usado no layout fixo atual. */
  espacos: [EspacoCampo, EspacoCampo, EspacoCampo];
  /** Nome da organização — aparece no rodapé preto. */
  organizacao?: string;
  /** Dados do clube (verso): endereço, cidade, telefone. */
  endereco?: string;
  cidade?: string;
  telefone?: string;
}

/**
 * Gera PDF A4 retrato com carteirinhas em grid 2 colunas seguindo
 * o modelo "Credencial do Atleta":
 *
 *   ┌────────────────────────────────────────┐
 *   │ [logo org]   TÍTULO CAMPEONATO   [evt] │
 *   │              SUBTÍTULO                  │
 *   ├════════════════════════════════════════┤  ← faixa preta
 *   │           CREDENCIAL DO ATLETA          │
 *   ├──────────┬──────────────────────────────┤
 *   │          │ NOME:     ___________        │
 *   │   FOTO   │ CLUBE:    ___________        │
 *   │ (placeholder)│ CATEGORIA: _________     │
 *   │          │ MATRICULA: __________        │
 *   │          │ NASCIMENTO: _________        │
 *   │          │ RG:       ___________        │
 *   ├════════════════════════════════════════┤  ← faixa preta
 *   │           ORGANIZAÇÃO ...                │
 *   └────────────────────────────────────────┘
 */
@Injectable({ providedIn: 'root' })
export class CarteirinhasPdfService {
  async gerar(
    jogadores: Jogador[],
    equipes: Equipe[],
    cfg: CarteirinhaConfig,
  ): Promise<void> {
    if (jogadores.length === 0) {
      throw new Error('Nenhum jogador selecionado.');
    }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const marginX = 10;
    const marginY = 12;
    const gapX = 4;
    const gapY = 5;

    const cardW = (pageW - marginX * 2 - gapX) / 2;
    const cardRatio = cfg.tamanho.alturaMm / cfg.tamanho.larguraMm;
    const cardH = cardW * cardRatio;

    const colsPerRow = 2;
    const rowsPerPage = Math.max(1, Math.floor((pageH - marginY * 2 + gapY) / (cardH + gapY)));
    const perPage = colsPerRow * rowsPerPage;

    // Pré-carrega imagens
    const logoData = cfg.logoUrl ? await this.toDataUrl(cfg.logoUrl) : null;
    const equipeLogoMap = new Map<string, string | null>();
    for (const eq of equipes) {
      if (eq.id && eq.logoUrl) {
        equipeLogoMap.set(eq.id, await this.toDataUrl(eq.logoUrl));
      }
    }
    const fotoMap = new Map<string, string | null>();
    for (const j of jogadores) {
      if (j.id && j.fotoUrl) {
        fotoMap.set(j.id, await this.toDataUrl(j.fotoUrl));
      }
    }

    // ───── Páginas com FRENTES ─────
    this.desenharLote(
      pdf, jogadores, equipes,
      cardW, cardH, marginX, marginY, gapX, gapY, perPage, colsPerRow,
      cfg, logoData, equipeLogoMap, fotoMap,
      'frente',
    );

    // ───── Páginas com VERSOS (se solicitado) ─────
    if (cfg.incluirVerso) {
      pdf.addPage();
      this.desenharLote(
        pdf, jogadores, equipes,
        cardW, cardH, marginX, marginY, gapX, gapY, perPage, colsPerRow,
        cfg, logoData, equipeLogoMap, fotoMap,
        'verso',
      );
    }

    const fileName = `carteirinhas-${this.slugify(cfg.subtitulo || cfg.nomeCampeonato)}.pdf`;
    pdf.save(fileName);
  }

  private desenharLote(
    pdf: jsPDF,
    jogadores: Jogador[],
    equipes: Equipe[],
    cardW: number, cardH: number,
    marginX: number, marginY: number,
    gapX: number, gapY: number,
    perPage: number, colsPerRow: number,
    cfg: CarteirinhaConfig,
    logoData: string | null,
    equipeLogoMap: Map<string, string | null>,
    fotoMap: Map<string, string | null>,
    lado: 'frente' | 'verso',
  ): void {
    for (let i = 0; i < jogadores.length; i++) {
      const inPage = i % perPage;
      const row = Math.floor(inPage / colsPerRow);
      // Para o verso, espelha a ordem das colunas (duplex flip horizontal).
      const col = lado === 'verso'
        ? (colsPerRow - 1 - (inPage % colsPerRow))
        : (inPage % colsPerRow);

      if (i > 0 && inPage === 0) {
        pdf.addPage();
      }

      const x = marginX + col * (cardW + gapX);
      const y = marginY + row * (cardH + gapY);
      const eq = equipes.find(e => e.id === jogadores[i].equipeId);
      const escudoData = eq?.id ? equipeLogoMap.get(eq.id) ?? null : null;
      const fotoData = jogadores[i].id ? fotoMap.get(jogadores[i].id!) ?? null : null;

      if (lado === 'frente') {
        this.desenharFrente(pdf, x, y, cardW, cardH, jogadores[i], eq, cfg, logoData, escudoData, fotoData);
      } else {
        this.desenharVerso(pdf, x, y, cardW, cardH, eq, cfg, logoData, escudoData);
      }
    }
  }

  private desenharFrente(
    pdf: jsPDF,
    x: number, y: number, w: number, h: number,
    jog: Jogador,
    eq: Equipe | undefined,
    cfg: CarteirinhaConfig,
    logoData: string | null,
    escudoData: string | null,
    fotoData: string | null,
  ): void {
    // ─── Borda externa ───
    pdf.setDrawColor(20, 20, 20);
    pdf.setLineWidth(0.3);
    pdf.rect(x, y, w, h, 'S');

    // ─── Proporções ───
    const headerH    = h * 0.22;   // Logos + título
    const faixaH     = h * 0.11;   // CREDENCIAL DO ATLETA (preta)
    const rodapeH    = h * 0.08;   // ORGANIZAÇÃO (preta)
    const corpoY     = y + headerH + faixaH;
    const corpoH     = h - headerH - faixaH - rodapeH;

    // ═══════════════════════════════════════════════════════
    // HEADER (logos + título)
    // ═══════════════════════════════════════════════════════
    const headerY = y;
    const logoSize = Math.min(headerH - 2, w * 0.16);

    // Logo organizadora (esquerda)
    if (logoData) {
      try {
        pdf.addImage(
          logoData, 'PNG',
          x + 2, headerY + (headerH - logoSize) / 2,
          logoSize, logoSize,
          undefined, 'FAST',
        );
      } catch { /* ignora */ }
    }

    // Logo evento (direita)
    if (cfg.incluirEscudo && escudoData) {
      try {
        pdf.addImage(
          escudoData, 'PNG',
          x + w - logoSize - 2, headerY + (headerH - logoSize) / 2,
          logoSize, logoSize,
          undefined, 'FAST',
        );
      } catch { /* ignora */ }
    }

    // Título central
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    const titleX = x + w / 2;
    const titleMaxW = w - (logoSize * 2 + 8);
    pdf.text(
      (cfg.nomeCampeonato || '').toUpperCase(),
      titleX,
      headerY + headerH / 2 - 0.5,
      { align: 'center', maxWidth: titleMaxW },
    );
    pdf.setFontSize(6);
    pdf.setFont('helvetica', 'normal');
    if (cfg.subtitulo) {
      pdf.text(
        (cfg.subtitulo).toUpperCase(),
        titleX,
        headerY + headerH / 2 + 2.5,
        { align: 'center', maxWidth: titleMaxW },
      );
    }

    // ═══════════════════════════════════════════════════════
    // FAIXA PRETA: CREDENCIAL DO ATLETA
    // ═══════════════════════════════════════════════════════
    const faixaY = y + headerH;
    pdf.setFillColor(0, 0, 0);
    pdf.rect(x, faixaY, w, faixaH, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.text(
      'CREDENCIAL DO ATLETA',
      x + w / 2,
      faixaY + faixaH / 2 + 1.3,
      { align: 'center' },
    );

    // ═══════════════════════════════════════════════════════
    // CORPO: FOTO (esquerda) + TABELA (direita)
    // ═══════════════════════════════════════════════════════
    const fotoW = w * 0.32;
    const tabelaX = x + fotoW;
    const tabelaW = w - fotoW;

    // Linha vertical divisória entre foto e tabela
    pdf.setDrawColor(20, 20, 20);
    pdf.setLineWidth(0.3);
    pdf.line(x + fotoW, corpoY, x + fotoW, corpoY + corpoH);

    // ─── FOTO (placeholder ou imagem real) ───
    if (fotoData) {
      try {
        pdf.addImage(
          fotoData, 'JPEG',
          x + 1, corpoY + 1,
          fotoW - 2, corpoH - 2,
          undefined, 'FAST',
        );
      } catch {
        this.desenharPlaceholderFoto(pdf, x + 1, corpoY + 1, fotoW - 2, corpoH - 2);
      }
    } else {
      this.desenharPlaceholderFoto(pdf, x + 1, corpoY + 1, fotoW - 2, corpoH - 2);
    }

    // ─── TABELA 6 linhas: NOME / CLUBE / CATEGORIA / MATRICULA / NASCIMENTO / RG ───
    const linhas: Array<{ label: string; valor: string }> = [
      { label: 'NOME:',       valor: (jog.nome ?? '').toUpperCase() },
      { label: 'CLUBE:',      valor: (eq?.nome ?? '').toUpperCase() },
      { label: 'CATEGORIA:',  valor: (cfg.subtitulo ?? '').toUpperCase() },
      { label: 'MATRICULA:',  valor: jog.numeroCamisa ?? '' },
      { label: 'NASCIMENTO:', valor: formatarData(jog.dataNascimento) },
      { label: 'RG:',         valor: jog.documento ?? '' },
    ];
    const linhaH = corpoH / linhas.length;
    pdf.setTextColor(0, 0, 0);
    for (let i = 0; i < linhas.length; i++) {
      const ly = corpoY + linhaH * i;
      // Divisória horizontal (exceto na primeira linha)
      if (i > 0) {
        pdf.setDrawColor(80, 80, 80);
        pdf.setLineWidth(0.15);
        pdf.line(tabelaX, ly, tabelaX + tabelaW, ly);
      }
      // Label
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.2);
      pdf.text(linhas[i].label, tabelaX + 1.2, ly + linhaH / 2 + 1.2);
      // Valor
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      const labelW = pdf.getTextWidth(linhas[i].label) + 2;
      pdf.text(
        linhas[i].valor,
        tabelaX + labelW + 1,
        ly + linhaH / 2 + 1.2,
        { maxWidth: tabelaW - labelW - 2 },
      );
    }

    // ═══════════════════════════════════════════════════════
    // RODAPÉ PRETO: ORGANIZAÇÃO
    // ═══════════════════════════════════════════════════════
    this.desenharRodape(pdf, x, y + h - rodapeH, w, rodapeH, cfg.organizacao);
  }

  private desenharVerso(
    pdf: jsPDF,
    x: number, y: number, w: number, h: number,
    eq: Equipe | undefined,
    cfg: CarteirinhaConfig,
    logoData: string | null,
    escudoData: string | null,
  ): void {
    // ─── Borda externa ───
    pdf.setDrawColor(20, 20, 20);
    pdf.setLineWidth(0.3);
    pdf.rect(x, y, w, h, 'S');

    const headerH    = h * 0.20;
    const rodapeH    = h * 0.08;
    const corpoY     = y + headerH;
    const corpoH     = h - headerH - rodapeH;

    // ─── HEADER idêntico à frente ───
    const logoSize = Math.min(headerH - 2, w * 0.16);
    if (logoData) {
      try {
        pdf.addImage(
          logoData, 'PNG',
          x + 2, y + (headerH - logoSize) / 2,
          logoSize, logoSize,
          undefined, 'FAST',
        );
      } catch { /* */ }
    }
    if (cfg.incluirEscudo && escudoData) {
      try {
        pdf.addImage(
          escudoData, 'PNG',
          x + w - logoSize - 2, y + (headerH - logoSize) / 2,
          logoSize, logoSize,
          undefined, 'FAST',
        );
      } catch { /* */ }
    }
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(
      (cfg.nomeCampeonato || '').toUpperCase(),
      x + w / 2,
      y + headerH / 2 - 0.5,
      { align: 'center', maxWidth: w - (logoSize * 2 + 8) },
    );
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    if (cfg.subtitulo) {
      pdf.text(
        cfg.subtitulo.toUpperCase(),
        x + w / 2,
        y + headerH / 2 + 2.5,
        { align: 'center', maxWidth: w - (logoSize * 2 + 8) },
      );
    }

    // Linha separadora do header
    pdf.setDrawColor(20, 20, 20);
    pdf.setLineWidth(0.3);
    pdf.line(x, y + headerH, x + w, y + headerH);

    // ─── CORPO ─── 4 rows centralizados + bloco de assinaturas
    const blocoH = corpoH * 0.65;
    const assinH = corpoH * 0.35;

    const linhas: Array<{ label: string; valor: string }> = [
      { label: 'NOME DO CLUBE', valor: (eq?.nome ?? '').toUpperCase() },
      { label: 'ENDEREÇO',      valor: (cfg.endereco ?? '').toUpperCase() },
      { label: 'CIDADE',        valor: (cfg.cidade ?? eq?.cidade ?? '').toUpperCase() },
      { label: 'TELEFONE',      valor: cfg.telefone ?? '' },
    ];
    const rowH = blocoH / linhas.length;
    for (let i = 0; i < linhas.length; i++) {
      const ry = corpoY + rowH * i;
      // Label pequeno em cima
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6);
      pdf.setTextColor(0, 0, 0);
      pdf.text(linhas[i].label, x + w / 2, ry + rowH * 0.35, { align: 'center' });
      // Valor
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.text(linhas[i].valor, x + w / 2, ry + rowH * 0.78, {
        align: 'center', maxWidth: w - 4,
      });
      // Divisória entre linhas
      pdf.setDrawColor(120, 120, 120);
      pdf.setLineWidth(0.15);
      pdf.line(x + 2, ry + rowH, x + w - 2, ry + rowH);
    }

    // ─── ASSINATURAS ───
    const assinY = corpoY + blocoH;
    const colW = w / 2;
    // Linhas pra assinar
    pdf.setDrawColor(20, 20, 20);
    pdf.setLineWidth(0.3);
    const linhaY = assinY + assinH * 0.55;
    pdf.line(x + 4,          linhaY, x + colW - 4,      linhaY);
    pdf.line(x + colW + 4,   linhaY, x + w - 4,         linhaY);
    // Labels abaixo
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(5.5);
    pdf.setTextColor(0, 0, 0);
    pdf.text('ASS. PRESIDENTE',     x + colW / 2,         linhaY + 2.5, { align: 'center' });
    pdf.text('ASS. ORGANIZAÇÃO',    x + colW + colW / 2,  linhaY + 2.5, { align: 'center' });

    // ─── RODAPÉ ───
    this.desenharRodape(pdf, x, y + h - rodapeH, w, rodapeH, cfg.organizacao);
  }

  private desenharRodape(
    pdf: jsPDF,
    x: number, y: number, w: number, h: number,
    organizacao?: string,
  ): void {
    pdf.setFillColor(0, 0, 0);
    pdf.rect(x, y, w, h, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    const texto = `ORGANIZAÇÃO ${organizacao ?? 'PLACARPRO'}`.toUpperCase();
    pdf.text(texto, x + w / 2, y + h / 2 + 1.2, { align: 'center' });
  }

  private desenharPlaceholderFoto(
    pdf: jsPDF, x: number, y: number, w: number, h: number,
  ): void {
    pdf.setTextColor(120, 120, 120);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(5.5);
    pdf.text('COLOQUE A FOTO AQUI', x + w / 2, y + h / 2, {
      align: 'center', maxWidth: w - 2,
    });
  }

  private async toDataUrl(url: string): Promise<string | null> {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  private slugify(s: string): string {
    return (s || 'carteirinhas')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'carteirinhas';
  }
}

function formatarData(iso?: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
