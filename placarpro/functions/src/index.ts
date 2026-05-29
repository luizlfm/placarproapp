import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

admin.initializeApp();
const db = admin.firestore();

interface JogadorDoc {
  id?: string;
  nome?: string;
  numeroCamisa?: string | number;
  equipeId?: string;
}
interface EquipeDoc {
  id?: string;
  nome?: string;
  cidade?: string;
  logoUrl?: string;
}
interface JogoDoc {
  id?: string;
  mandanteId?: string;
  visitanteId?: string;
  golsMandante?: number | null;
  golsVisitante?: number | null;
  dataHora?: FirebaseFirestore.Timestamp | string | null;
  local?: string;
  fase?: string;
  arbitros?: { funcao?: string; nome?: string }[];
}
interface CampeonatoDoc {
  id?: string;
  titulo?: string;
  logoUrl?: string;
}
interface CategoriaDoc {
  id?: string;
  titulo?: string;
}
interface EventoDoc {
  id?: string;
  tipo?: string;
  jogadorId?: string;
  equipeId?: string;
}

export const gerarSumulasPdf = functions
  .runWith({ memory: '1GB', timeoutSeconds: 120 })
  .https.onRequest(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'método inválido' });
      return;
    }

    const data = req.body || {};
    const { campeonatoId, categoriaId, jogoIds } = data;
    if (!campeonatoId || !categoriaId || !jogoIds?.length) {
      res.status(400).json({ error: 'IDs obrigatórios' });
      return;
    }

    let browserOuter: import('puppeteer-core').Browser | undefined;
    try {
    const campRef = db.doc(`campeonatos/${campeonatoId}`);
    const catRef = campRef.collection('categorias').doc(categoriaId);
    const [campSnap, catSnap, equipesSnap, jogadoresSnap] = await Promise.all([
      campRef.get(),
      catRef.get(),
      catRef.collection('equipes').get(),
      catRef.collection('jogadores').get(),
    ]);
    const campeonato = { id: campSnap.id, ...campSnap.data() } as CampeonatoDoc;
    const categoria = { id: catSnap.id, ...catSnap.data() } as CategoriaDoc;
    const equipes = equipesSnap.docs.map(d => ({ id: d.id, ...d.data() } as EquipeDoc));
    const jogadores = jogadoresSnap.docs.map(d => ({ id: d.id, ...d.data() } as JogadorDoc));
    const equipesMap = new Map(equipes.map(e => [e.id!, e]));

    const jogosComEventos = await Promise.all((jogoIds as string[]).map(async (id: string) => {
      const jogoRef = catRef.collection('jogos').doc(id);
      const [jogoSnap, eventosSnap] = await Promise.all([
        jogoRef.get(),
        jogoRef.collection('eventos').get(),
      ]);
      return {
        jogo: { id: jogoSnap.id, ...jogoSnap.data() } as JogoDoc,
        eventos: eventosSnap.docs.map(d => ({ id: d.id, ...d.data() } as EventoDoc)),
      };
    }));

    const html = montarHtml(campeonato, categoria, jogosComEventos, equipesMap, jogadores);

    browserOuter = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1600, height: 1131, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const page = await browserOuter.newPage();
    await page.setViewport({ width: 1600, height: 1131, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    // Scale 0.65 + deviceScaleFactor 2 = renderiza em alta resolução e
    // encolhe → bordas finas saem hairline no PDF, texto continua nítido.
    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '3mm', right: '3mm', bottom: '3mm', left: '3mm' },
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="sumulas.pdf"');
    res.status(200).send(Buffer.from(pdfBuffer));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[gerarSumulasPdf] erro', msg);
      res.status(500).json({ error: msg });
    } finally {
      if (browserOuter) await browserOuter.close();
    }
  });

// ════════════════════════════════════════════════════════════════════
// CSS — replicando o template visual da `.sumula-folha` (modelo padrão)
// ════════════════════════════════════════════════════════════════════
const CSS = `
@page { size: A4 landscape; margin: 3mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.15; }
.sumula-folha { width: 100%; padding: 0; page-break-after: always; background: #fff; }
.sumula-folha:last-child { page-break-after: auto; }

/* ════ Faixa do título ════ */
.sm-titulo-faixa { display: grid; grid-template-columns: 56px 1fr 96px; border: 0.1px solid #000; border-bottom: 0; }
.sm-titulo-faixa .sm-logo-camp { border-right: 0.1px solid #000; display: flex; align-items: center; justify-content: center; padding: 3px; }
.sm-titulo-faixa .sm-logo-camp img { max-width: 100%; max-height: 44px; object-fit: contain; }
.sm-titulo-faixa .sm-titulo-bloco { display: flex; flex-direction: column; min-width: 0; }
.sm-titulo-faixa .sm-titulo { font-size: 13px; font-weight: 800; text-align: center; padding: 3px 6px; text-transform: uppercase; border-bottom: 0.1px solid #000; letter-spacing: 0.5px; line-height: 1.1; }
.sm-titulo-faixa .sm-confronto { display: grid; grid-template-columns: 1fr 72px 22px 72px 1fr; align-items: stretch; min-height: 22px; }
.sm-titulo-faixa .sm-time-nome { font-weight: 800; padding: 3px 8px; font-size: 10px; text-align: center; text-transform: uppercase; display: flex; align-items: center; justify-content: center; }
.sm-titulo-faixa .sm-placar-boxes { display: grid; grid-template-columns: repeat(4, 1fr); border-left: 0.1px solid #000; }
.sm-titulo-faixa .sm-placar-boxes.lado-v { border-left: 0; border-right: 0.1px solid #000; }
.sm-titulo-faixa .sm-placar-boxes .cx-pl { border-right: 0.1px solid #000; background: #fff; min-height: 22px; }
.sm-titulo-faixa .sm-placar-boxes .cx-pl:last-child { border-right: none; }
.sm-titulo-faixa .sm-vs { text-align: center; font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.sm-titulo-faixa .sm-logos-times { display: grid; grid-template-columns: 1fr 1fr; border-left: 0.1px solid #000; }
.sm-titulo-faixa .sm-logo-time { display: flex; align-items: center; justify-content: center; padding: 2px; }
.sm-titulo-faixa .sm-logo-time + .sm-logo-time { border-left: 0.1px solid #000; }
.sm-titulo-faixa .sm-logo-time img { max-width: 100%; max-height: 40px; object-fit: contain; }

/* ════ Meta-grid ════ */
.sm-meta-grid { width: 100%; border-collapse: collapse; table-layout: fixed; border: 0.1px solid #000; border-top: 0; }
.sm-meta-grid td { border: 0.1px solid #000; padding: 2px 4px; font-size: 9px; height: 18px; line-height: 1.1; background: #fff; text-align: center; }
.sm-meta-grid td.lbl { font-weight: 700; text-align: center; font-size: 8.5px; background: #f5f7fa; }
.sm-meta-grid td.val { font-weight: 700; }
.sm-meta-grid td.check-box { text-align: center; font-weight: 700; font-size: 11px; }

/* ════ Corpo (2 equipes lado a lado) ════ */
.sm-corpo { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 0; }
.sm-equipe-bloco { display: flex; flex-direction: column; min-width: 0; }
.sm-equipe-cabecalho { margin-top: 5px; display: grid; grid-template-columns: 56px 1fr 60px 110px; border: 0.1px solid #000; margin-bottom: 5px; }
.sm-equipe-cabecalho .celula { padding: 3px 4px; font-weight: 700; font-size: 9.5px; text-align: center; border-right: 0.1px solid #000; display: flex; align-items: center; justify-content: center; }
.sm-equipe-cabecalho .celula:last-child { border-right: none; }
.sm-equipe-cabecalho .nome-equipe { font-size: 9px; font-weight: 800; text-transform: uppercase; }
.sm-equipe-cabecalho .iniciantes-boxes { padding: 0; gap: 0; display: flex; }
.sm-equipe-cabecalho .iniciantes-boxes .box-mini { display: inline-block; flex: 1; border-right: 0.1px solid #000; min-height: 16px; }
.sm-equipe-cabecalho .iniciantes-boxes .box-mini:last-child { border-right: none; }

/* ════ Tabela de jogadores ════ */
.sm-jogadores { width: 100%; border-collapse: collapse; table-layout: fixed; }
.sm-jogadores th, .sm-jogadores td { border: 0.1px solid #000; padding: 0; text-align: center; vertical-align: middle; }
.sm-jogadores th { font-size: 8px; height: 14px; background: #fff; font-weight: 700; }
.sm-jogadores td { height: 15px; font-size: 8.5px; }
.sm-jogadores .td-jogador { text-align: center; padding: 0 2px; font-weight: 700; text-transform: uppercase; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ════ Grade numerada ════ */
.sm-grade-numerada { display: grid; grid-template-columns: repeat(13, 1fr); width: 100%; max-width: 520px; margin: 5px auto; border: 0.1px solid #000; }
.sm-grade-numerada .num-box, .sm-grade-numerada .empty-box { height: 18px; border-bottom: 0.1px solid #000; border-right: 0.1px solid #000; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; }
.sm-grade-numerada > :nth-child(13n) { border-right: none; }
.sm-grade-numerada > :nth-last-child(-n + 13) { border-bottom: none; }

/* ════ Vertical text (TÉCNICO/CAPITÃO) ════ */
.vertical-text { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 9px; font-weight: bold; text-align: center; }
`;

function montarHtml(
  campeonato: CampeonatoDoc,
  categoria: CategoriaDoc,
  jogosComEventos: { jogo: JogoDoc; eventos: EventoDoc[] }[],
  equipesMap: Map<string, EquipeDoc>,
  jogadores: JogadorDoc[],
): string {
  const folhas = jogosComEventos.map(({ jogo, eventos }) => {
    const mandante = jogo.mandanteId ? equipesMap.get(jogo.mandanteId) : undefined;
    const visitante = jogo.visitanteId ? equipesMap.get(jogo.visitanteId) : undefined;
    const escalados = (equipeId?: string) => {
      if (!equipeId) return [];
      return jogadores.filter(j => j.equipeId === equipeId).map(j => {
        const evs = eventos.filter(e => e.jogadorId === j.id && e.equipeId === equipeId);
        return {
          jogador: j,
          gols: evs.filter(e => e.tipo === 'gol').length,
          amarelos: evs.filter(e => e.tipo === 'amarelo').length,
          vermelhos: evs.filter(e => e.tipo === 'vermelho').length,
        };
      });
    };
    return montarFolha(campeonato, categoria, jogo, mandante, visitante, escalados(jogo.mandanteId), escalados(jogo.visitanteId));
  }).join('\n');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${folhas}</body></html>`;
}

function montarFolha(
  campeonato: CampeonatoDoc,
  categoria: CategoriaDoc,
  jogo: JogoDoc,
  mandante: EquipeDoc | undefined,
  visitante: EquipeDoc | undefined,
  escMandante: { jogador: JogadorDoc; gols: number; amarelos: number; vermelhos: number }[],
  escVisitante: { jogador: JogadorDoc; gols: number; amarelos: number; vermelhos: number }[],
): string {
  const arb = (f: string) => esc((jogo.arbitros || []).find(a => a.funcao === f)?.nome || '');
  const data = formatarData(jogo.dataHora);
  const cidade = [mandante?.cidade, visitante?.cidade].filter(Boolean).join(' / ');
  const placarBox = (v: number | null | undefined) => `<span class="cx-pl">${v != null ? v : ''}</span>`;

  const linhasJogador = (jogs: typeof escMandante) => {
    const MIN = 14;
    const out: string[] = [];
    for (let i = 0; i < MIN; i++) {
      const j = jogs[i];
      // Acumulativas: linha 0/1 mostra 1-7, linha 2 PEDIDO DE TEMPO, 3 1ºP 2ºP EX, 4 caixas, 5+ TÉCNICO/CAPITÃO
      let acumCells = '';
      if (i < 2) {
        for (let n = 1; n <= 7; n++) acumCells += `<td class="td-acum">${n}</td>`;
      } else if (i === 2) {
        acumCells = `<td class="td-pedido-header" colspan="7">PEDIDO DE TEMPO</td>`;
      } else if (i === 3) {
        acumCells = `<td class="td-pedido-box"></td><td class="td-pedido-lbl" colspan="2">1º P</td><td class="td-pedido-lbl" colspan="2">2º P</td><td class="td-pedido-lbl" colspan="2">EX</td>`;
      } else if (i === 4) {
        acumCells = `<td class="td-pedido-box"></td><td class="td-pedido-box" colspan="2"></td><td class="td-pedido-box" colspan="2"></td><td class="td-pedido-box" colspan="2"></td>`;
      } else if (i === 5) {
        const rs = MIN - 5;
        acumCells = `<td class="td-pedido-box"></td><td class="vertical-text" rowspan="${rs}">TÉCNICO</td><td class="vertical-text" rowspan="${rs}"></td><td class="vertical-text" rowspan="${rs}"></td><td class="vertical-text" rowspan="${rs}">CAPITÃO</td><td class="vertical-text" rowspan="${rs}"></td><td class="vertical-text" rowspan="${rs}"></td>`;
      } else {
        acumCells = `<td class="td-pedido-box"></td>`;
      }
      out.push(`<tr>
        <td class="td-registro"></td>
        <td class="td-jogador">${esc(j?.jogador.nome || '')}</td>
        <td class="td-num">${esc(String(j?.jogador.numeroCamisa || ''))}</td>
        <td class="td-falta">1</td><td class="td-falta">2</td><td class="td-falta">3</td><td class="td-falta">4</td><td class="td-falta">5</td>
        <td class="td-am">${j?.amarelos ? 'X' : ''}</td>
        <td class="td-vm">${j?.vermelhos ? 'X' : ''}</td>
        ${acumCells}
      </tr>`);
    }
    return out.join('');
  };

  const tabelaEquipe = (label: string, nome: string, jogs: typeof escMandante) => `
    <div class="sm-equipe-bloco">
      <div class="sm-equipe-cabecalho">
        <div class="celula">${label}</div>
        <div class="celula nome-equipe">${esc(nome)}</div>
        <div class="celula">INICIANTES</div>
        <div class="celula iniciantes-boxes">
          ${Array(7).fill('<span class="box-mini"></span>').join('')}
        </div>
      </div>
      <table class="sm-jogadores">
        <colgroup>
          <col style="width:7%"><col style="width:38%"><col style="width:5%">
          <col style="width:3%"><col style="width:3%"><col style="width:3%"><col style="width:3%"><col style="width:3%">
          <col style="width:3.5%"><col style="width:3.5%">
          <col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%"><col style="width:3.5%">
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">Reg.</th>
            <th rowspan="2">JOGADORES</th>
            <th rowspan="2">Nº</th>
            <th colspan="5">FALTAS</th>
            <th rowspan="2">AM</th>
            <th rowspan="2">VM</th>
            <th colspan="7">ACUMULATIVAS</th>
          </tr>
          <tr>
            <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th>
            <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th>
          </tr>
        </thead>
        <tbody>${linhasJogador(jogs)}
          <tr class="comissao-row"><td colspan="3" style="text-align:left;padding:2px 6px;font-weight:700;">TÉCNICO</td><td colspan="5"></td><td></td><td></td><td colspan="7"></td></tr>
          <tr class="comissao-row"><td colspan="3" style="text-align:left;padding:2px 6px;font-weight:700;">AUXILIAR</td><td colspan="5"></td><td></td><td></td><td colspan="7"></td></tr>
          <tr class="comissao-row"><td colspan="3" style="text-align:left;padding:2px 6px;font-weight:700;">ASSISTENTE</td><td colspan="5"></td><td></td><td></td><td colspan="7"></td></tr>
        </tbody>
      </table>
      <div class="sm-grade-numerada">
        ${Array.from({ length: 13 }, (_, i) => `<div class="num-box">${i + 1}</div>`).join('')}
        ${Array(13).fill('<div class="empty-box"></div>').join('')}
        ${Array.from({ length: 13 }, (_, i) => `<div class="num-box">${i + 14}</div>`).join('')}
        ${Array(13).fill('<div class="empty-box"></div>').join('')}
      </div>
    </div>`;

  return `
<div class="sumula-folha">
  <div class="sm-titulo-faixa">
    <div class="sm-logo-camp">${campeonato.logoUrl ? `<img src="${esc(campeonato.logoUrl)}" />` : ''}</div>
    <div class="sm-titulo-bloco">
      <div class="sm-titulo">${esc(campeonato.titulo || 'Campeonato')}</div>
      <div class="sm-confronto">
        <div class="sm-time-nome">${esc((mandante?.nome || 'Mandante') + (mandante?.cidade ? ' - ' + mandante.cidade : ''))}</div>
        <div class="sm-placar-boxes lado-m">${placarBox(jogo.golsMandante)}</div>
        <div class="sm-vs">X</div>
        <div class="sm-placar-boxes lado-v">${placarBox(jogo.golsVisitante)}</div>
        <div class="sm-time-nome">${esc((visitante?.nome || 'Visitante') + (visitante?.cidade ? ' - ' + visitante.cidade : ''))}</div>
      </div>
    </div>
    <div class="sm-logos-times">
      <div class="sm-logo-time">${mandante?.logoUrl ? `<img src="${esc(mandante.logoUrl)}" />` : ''}</div>
      <div class="sm-logo-time">${visitante?.logoUrl ? `<img src="${esc(visitante.logoUrl)}" />` : ''}</div>
    </div>
  </div>

  <table class="sm-meta-grid">
    <colgroup>
      <col style="width:9%"><col style="width:7.5%"><col style="width:7.5%"><col style="width:7.5%"><col style="width:7.5%">
      <col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col style="width:25%">
    </colgroup>
    <tr>
      <td class="lbl">DATA</td><td class="val" colspan="4">${esc(data)}</td>
      <td class="lbl">HORÁRIO</td><td class="lbl">INÍCIO</td><td class="lbl">TÉRMINO</td>
      <td class="lbl">CONTAGEM</td>
      <td class="lbl" rowspan="2">ÁRBITRO 01</td><td class="val" rowspan="2">${arb('principal')}</td>
    </tr>
    <tr>
      <td class="lbl">COMPETIÇÃO</td><td class="val" colspan="4">${esc(campeonato.titulo || '')}</td>
      <td class="lbl">1º PERÍODO</td><td></td><td></td><td class="check-box">X</td>
    </tr>
    <tr>
      <td class="lbl">CATEGORIA</td><td class="val" colspan="4">${esc((categoria.titulo || '').toUpperCase())}</td>
      <td class="lbl">2º PERÍODO</td><td></td><td></td><td class="check-box">X</td>
      <td class="lbl" rowspan="2">ÁRBITRO 02</td><td class="val" rowspan="2">${arb('auxiliar-1')}</td>
    </tr>
    <tr>
      <td class="lbl">FASE</td><td class="val" colspan="2">${esc((jogo.fase || '').toUpperCase())}</td>
      <td class="lbl">SÉRIE</td><td></td>
      <td class="lbl">EXTRA</td><td></td><td></td><td class="check-box">X</td>
    </tr>
    <tr>
      <td class="lbl">GINÁSIO</td><td class="val" colspan="4">${esc((jogo.local || '').toUpperCase())}</td>
      <td class="lbl" colspan="3">PLACAR FINAL</td><td class="check-box">X</td>
      <td class="lbl" rowspan="2">MESÁRIO</td><td class="val" rowspan="2">${arb('mesario')}</td>
    </tr>
    <tr>
      <td class="lbl">CIDADE</td><td class="val" colspan="4">${esc(cidade.toUpperCase())}</td>
      <td class="lbl" colspan="3">DESEMPATE - PENALIDADES</td><td class="check-box">X</td>
    </tr>
  </table>

  <div class="sm-corpo">
    ${tabelaEquipe('EQUIPE A', mandante?.nome || '', escMandante)}
    ${tabelaEquipe('EQUIPE B', visitante?.nome || '', escVisitante)}
  </div>
</div>`;
}

function formatarData(dt: FirebaseFirestore.Timestamp | string | null | undefined): string {
  if (!dt) return '';
  try {
    let d: Date;
    if (typeof dt === 'string') d = new Date(dt);
    else if (typeof (dt as FirebaseFirestore.Timestamp).toDate === 'function') d = (dt as FirebaseFirestore.Timestamp).toDate();
    else return '';
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return '';
  }
}

function esc(s: string): string {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
