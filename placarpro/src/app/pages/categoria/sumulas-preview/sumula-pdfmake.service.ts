import { Injectable } from '@angular/core';

interface PdfMakeGlobal {
  createPdf(docDef: unknown): {
    getBlob(cb: (blob: Blob) => void): void;
    download(filename?: string): void;
    print(): void;
  };
  vfs?: Record<string, string>;
}

declare global {
  interface Window {
    pdfMake?: PdfMakeGlobal;
  }
}

/** Cor primary navy do app. */
const COR_PRIMARY = '#000000';
const COR_CINZA_BG = '#e8edf2';
const COR_BORDA = '#222';

/**
 * Gera PDFs de súmulas via pdfmake — replica o modelo padrão (futebol)
 * com estrutura próxima à visual: header + meta-grid + 2 tabelas
 * de jogadores (A/B) com FALTAS/AM/VM/ACUMULATIVAS + grade numerada.
 */
@Injectable({ providedIn: 'root' })
export class SumulaPdfmakeService {
  private carregando: Promise<void> | null = null;

  async carregar(): Promise<void> {
    if (window.pdfMake) return;
    if (this.carregando) return this.carregando;
    this.carregando = (async () => {
      await this.injetarScript('https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js');
      await this.injetarScript('https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js');
    })();
    return this.carregando;
  }

  private injetarScript(src: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(s);
    });
  }

  montarDocDefinition(sumulas: SumulaSimples[]): unknown {
    const content: unknown[] = [];
    sumulas.forEach((s, idx) => {
      if (idx > 0) content.push({ text: '', pageBreak: 'before' });
      this.montarUmaSumula(content, s);
    });

    return {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [16, 12, 16, 12],
      content,
      defaultStyle: { fontSize: 7.5, color: '#000' },
      styles: {
        titCamp: { fontSize: 11, bold: true, alignment: 'center' },
        confronto: { fontSize: 9, bold: true },
        meta: { fontSize: 7 },
        lbl: { fontSize: 7, bold: true, alignment: 'center', fillColor: '#fff' },
        val: { fontSize: 7, alignment: 'center' },
        th: { fontSize: 7, bold: true, alignment: 'center', fillColor: COR_PRIMARY, color: '#fff' },
        eqBloco: { fontSize: 8, bold: true, fillColor: COR_CINZA_BG },
        gradeNum: { fontSize: 7, bold: true, alignment: 'center' },
      },
    };
  }

  private montarUmaSumula(content: unknown[], s: SumulaSimples): void {
    // ─── Header: confronto + título do campeonato ───
    content.push({
      table: {
        widths: ['*'],
        body: [[
          {
            stack: [
              { text: s.campeonato.toUpperCase(), style: 'titCamp', margin: [0, 1, 0, 2] },
              {
                columns: [
                  { text: s.mandante.toUpperCase(), style: 'confronto', alignment: 'right', width: '*' },
                  {
                    text: s.golsMandante != null && s.golsVisitante != null
                      ? ` ${s.golsMandante}   X   ${s.golsVisitante} `
                      : '   X   ',
                    style: 'confronto',
                    alignment: 'center',
                    width: 80,
                  },
                  { text: s.visitante.toUpperCase(), style: 'confronto', alignment: 'left', width: '*' },
                ],
                margin: [0, 0, 0, 2],
              },
            ],
            border: [true, true, true, true],
          },
        ]],
      },
      layout: this.bordaSolid(),
    });

    // ─── Meta-grid: DATA | COMPETIÇÃO | CATEGORIA | FASE | GINÁSIO | CIDADE + ÁRBITROS ───
    const labels = (txt: string) => ({ text: txt, style: 'lbl' });
    const vals = (txt: string) => ({ text: (txt || '').toUpperCase(), style: 'val' });

    content.push({
      margin: [0, 1, 0, 0],
      table: {
        widths: [55, '*', 55, 120],
        body: [
          [labels('DATA'), vals(s.data || ''), labels('ÁRBITRO 1'), vals(s.arbitro1 || '')],
          [labels('COMPETIÇÃO'), vals(s.campeonato), labels('ÁRBITRO 2'), vals(s.arbitro2 || '')],
          [labels('CATEGORIA'), vals(s.subtitulo || ''), labels('MESÁRIO'), vals(s.mesario || '')],
          [labels('FASE'), vals(s.fase || ''), labels('PLACAR FINAL'), vals(
            s.golsMandante != null && s.golsVisitante != null
              ? `${s.golsMandante} X ${s.golsVisitante}` : ''
          )],
          [labels('GINÁSIO'), vals(s.local || ''), labels('CIDADE'), vals(s.cidade || '')],
        ],
      },
      layout: this.bordaSolid(),
    });

    // ─── Corpo: EQUIPE A e EQUIPE B lado a lado ───
    content.push({
      margin: [0, 2, 0, 0],
      columns: [
        { width: '*', stack: [this.cabecalhoEquipe('EQUIPE A', s.mandante), this.tabelaJogadores(s.escMandante)] },
        { width: 6, text: ' ' },
        { width: '*', stack: [this.cabecalhoEquipe('EQUIPE B', s.visitante), this.tabelaJogadores(s.escVisitante)] },
      ],
    });

    // ─── Grade numerada 1-26 (lado a lado, A e B) ───
    content.push({
      margin: [0, 4, 0, 0],
      columns: [
        { width: '*', stack: [this.gradeNumerada()] },
        { width: 6, text: ' ' },
        { width: '*', stack: [this.gradeNumerada()] },
      ],
    });

    // ─── Assinaturas ───
    content.push({
      margin: [0, 12, 0, 0],
      columns: [
        { text: '____________________\nÁRBITRO', alignment: 'center', width: '*', fontSize: 7 },
        { text: '____________________\nCAPITÃO A', alignment: 'center', width: '*', fontSize: 7 },
        { text: '____________________\nCAPITÃO B', alignment: 'center', width: '*', fontSize: 7 },
        { text: '____________________\nMESÁRIO', alignment: 'center', width: '*', fontSize: 7 },
      ],
    });
  }

  private cabecalhoEquipe(label: string, nomeEquipe: string): unknown {
    return {
      table: {
        widths: [50, '*'],
        body: [[
          { text: label, style: 'eqBloco', alignment: 'center' },
          { text: nomeEquipe.toUpperCase(), style: 'eqBloco' },
        ]],
      },
      layout: this.bordaSolid(),
    };
  }

  private tabelaJogadores(jogadores: { numero?: string; nome: string; gols?: number; amarelos?: number; vermelhos?: number }[]): unknown {
    const MIN_LINHAS = 14;
    const linhasJog = jogadores.slice(0, MIN_LINHAS).map(j => [
      { text: '', alignment: 'center' }, // Reg
      { text: j.nome }, // Jogador
      { text: j.numero || '', alignment: 'center' }, // Nº
      ...this.faltasCells(),
      { text: j.amarelos ? 'X' : '', alignment: 'center' },
      { text: j.vermelhos ? 'X' : '', alignment: 'center' },
      ...this.acumCells(),
    ]);
    while (linhasJog.length < MIN_LINHAS) {
      linhasJog.push([
        { text: '', alignment: 'center' },
        { text: '' },
        { text: '', alignment: 'center' },
        ...this.faltasCells(),
        { text: '', alignment: 'center' },
        { text: '', alignment: 'center' },
        ...this.acumCells(),
      ]);
    }

    return {
      margin: [0, 1, 0, 0],
      table: {
        headerRows: 2,
        widths: [16, '*', 14, 10, 10, 10, 10, 10, 10, 10, 9, 9, 9, 9, 9, 9, 9],
        body: [
          // Linha 1 do header (com colspan agrupando FALTAS/ACUMULATIVAS)
          [
            { text: 'Reg.', style: 'th', rowSpan: 2 },
            { text: 'JOGADORES', style: 'th', rowSpan: 2 },
            { text: 'Nº', style: 'th', rowSpan: 2 },
            { text: 'FALTAS', style: 'th', colSpan: 5 }, {}, {}, {}, {},
            { text: 'AM', style: 'th', rowSpan: 2 },
            { text: 'VM', style: 'th', rowSpan: 2 },
            { text: 'ACUMULATIVAS', style: 'th', colSpan: 7 }, {}, {}, {}, {}, {}, {},
          ],
          // Linha 2 do header (subcolunas FALTAS 1-5 e ACUM 1-7)
          [
            {}, {}, {},
            { text: '1', style: 'th' }, { text: '2', style: 'th' }, { text: '3', style: 'th' },
            { text: '4', style: 'th' }, { text: '5', style: 'th' },
            {}, {},
            { text: '1', style: 'th' }, { text: '2', style: 'th' }, { text: '3', style: 'th' },
            { text: '4', style: 'th' }, { text: '5', style: 'th' },
            { text: '6', style: 'th' }, { text: '7', style: 'th' },
          ],
          ...linhasJog,
          // Comissão técnica
          this.linhaComissao('TÉCNICO'),
          this.linhaComissao('AUXILIAR'),
          this.linhaComissao('ASSISTENTE'),
        ],
      },
      layout: this.bordaSolid(),
    };
  }

  private faltasCells(): unknown[] {
    return [
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
    ];
  }

  private acumCells(): unknown[] {
    return [
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
    ];
  }

  private linhaComissao(label: string): unknown[] {
    return [
      { text: label, style: 'lbl', alignment: 'left', colSpan: 3 }, {}, {},
      { text: '', colSpan: 5 }, {}, {}, {}, {},
      { text: '', alignment: 'center' },
      { text: '', alignment: 'center' },
      { text: '', colSpan: 7 }, {}, {}, {}, {}, {}, {},
    ];
  }

  private gradeNumerada(): unknown {
    const cells = (start: number) => Array.from({ length: 13 }, (_, i) => ({
      text: String(start + i),
      style: 'gradeNum',
      fillColor: '#fafafa',
    }));
    const vazias = () => Array.from({ length: 13 }, () => ({ text: '', fillColor: '#fff' }));
    return {
      table: {
        widths: Array(13).fill(`${100 / 13}%`),
        body: [
          cells(1),
          vazias(),
          cells(14),
          vazias(),
        ],
      },
      layout: this.bordaSolid(),
    };
  }

  private bordaSolid(): unknown {
    return {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => COR_BORDA,
      vLineColor: () => COR_BORDA,
      paddingLeft: () => 2,
      paddingRight: () => 2,
      paddingTop: () => 1,
      paddingBottom: () => 1,
    };
  }

  async gerarBlob(sumulas: SumulaSimples[]): Promise<Blob> {
    await this.carregar();
    if (!window.pdfMake) throw new Error('pdfMake não carregou');
    const docDef = this.montarDocDefinition(sumulas);
    return new Promise<Blob>(resolve => {
      window.pdfMake!.createPdf(docDef).getBlob(blob => resolve(blob));
    });
  }
}

export interface SumulaSimples {
  campeonato: string;
  subtitulo?: string;
  mandante: string;
  visitante: string;
  golsMandante?: number | null;
  golsVisitante?: number | null;
  data?: string;
  local?: string;
  cidade?: string;
  fase?: string;
  arbitro1?: string;
  arbitro2?: string;
  mesario?: string;
  escMandante: { numero?: string; nome: string; gols?: number; amarelos?: number; vermelhos?: number }[];
  escVisitante: { numero?: string; nome: string; gols?: number; amarelos?: number; vermelhos?: number }[];
}
