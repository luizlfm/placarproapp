import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import domtoimage from 'dom-to-image-more';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import {
  ArbitroJogo,
  EventoJogo,
  EventoTipo,
  FuncaoArbitro,
  Jogo,
} from '../../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../../campeonatos/campeonato.model';
import { Categoria } from '../../../../campeonatos/categoria.model';
import { dataHoraIsoParaBr } from '../../../../shared/directives/mask.directive';
import { NavBackService } from '../../../../shared/nav-back.service';
import { salvarPdf } from '../../../../shared/pdf-download.helper';

interface LinhaEvento {
  tipo: EventoTipo;
  jogadorNome: string;
  equipe: 'mandante' | 'visitante';
  minuto?: number;
  observacao?: string;
  quantidade?: number;
}

interface JogadorEscalado {
  jogador: Jogador;
  amarelos: number;
  vermelhos: number;
  gols: number;
}

interface SumulaView {
  jogo: Jogo;
  campeonato?: Campeonato;
  categoria?: Categoria;
  mandante?: Equipe;
  visitante?: Equipe;
  escMandante: JogadorEscalado[];
  escVisitante: JogadorEscalado[];
  lances: LinhaEvento[];
  arbitros: ArbitroJogo[];
}

const ROTULO_TIPO: Record<EventoTipo, string> = {
  gol: 'Gol',
  'gol-contra': 'Gol contra',
  amarelo: 'Cartão amarelo',
  vermelho: 'Cartão vermelho',
  azul: 'Cartão azul',
  falta: 'Falta',
  defesa: 'Defesa',
  'sub-entrou': 'Substituição (entrou)',
  'sub-saiu': 'Substituição (saiu)',
  'pen-convertido': 'Pênalti convertido',
  'pen-perdido': 'Pênalti perdido',
  'pen-defendido': 'Pênalti defendido',
};

const ROTULO_FUNCAO: Record<FuncaoArbitro, string> = {
  principal: 'Árbitro principal',
  'auxiliar-1': 'Assistente 1',
  'auxiliar-2': 'Assistente 2',
  'quarto-arbitro': '4º árbitro',
  mesario: 'Mesário',
  cronometrista: 'Cronometrista',
};

/**
 * Página de Súmula imprimível.
 *
 * Layout otimizado pra impressão A4 — abre tudo em uma única página com:
 *  - Cabeçalho (campeonato + categoria + fase/rodada + data/local)
 *  - Placar grande no centro
 *  - Escalações de mandante e visitante lado a lado
 *  - Lista de lances ordenada por minuto
 *  - Arbitragem (se houver) + linhas de assinatura
 *
 * Rota: `/app/campeonato/:id/categoria/:catId/jogo/:jogoId/sumula`
 * Use `window.print()` direto na página pra gerar o PDF.
 */
@Component({
  selector: 'app-sumula',
  templateUrl: './sumula.page.html',
  styleUrls: ['./sumula.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class SumulaPage implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly catsSrv = inject(CategoriasService);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly navBack = inject(NavBackService);
  private readonly modalCtrl = inject(ModalController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /**
   * Modo MODAL — quando aberta via `ModalController.create({ component:
   * SumulaPage })` em vez de navegação por rota. Faz o botão "Voltar"
   * fechar o modal em vez de chamar `navBack.back(...)`, e permite que
   * os IDs venham por @Input em vez de paramMap.
   */
  @Input() isModal = false;
  @Input() campeonatoIdInput?: string;
  @Input() categoriaIdInput?: string;
  @Input() jogoIdInput?: string;

  /** IDs efetivos — vindos do @Input (modal) ou do paramMap (rota). */
  campeonatoId = '';
  categoriaId = '';
  jogoId = '';

  readonly ROTULO_TIPO = ROTULO_TIPO;
  readonly ROTULO_FUNCAO = ROTULO_FUNCAO;

  /** Quantidade de linhas fixas pra jogadores em cada equipe (replica modelo). */
  readonly LINHAS_JOGADORES = 19;
  /** Grade numerada de 1 a 26 no rodapé. */
  readonly NUMEROS_13 = Array.from({ length: 13 }, (_, i) => i + 1);

readonly NUMEROS_13_2 = Array.from({ length: 13 }, (_, i) => i + 14);

/* quantidade de linhas vazias */
readonly  COLUNAS_VAZIAS = Array.from({ length: 13 });

  sumula$: Observable<SumulaView | undefined> = of(undefined);

  ngOnInit(): void {
    // Em modo modal os IDs vêm por @Input; em modo rota vêm do paramMap.
    this.campeonatoId = this.campeonatoIdInput ?? this.lerParam('id');
    this.categoriaId = this.categoriaIdInput ?? this.lerParam('catId');
    this.jogoId = this.jogoIdInput ?? this.lerParam('jogoId');

    if (!this.campeonatoId || !this.categoriaId || !this.jogoId) {
      console.error('[Sumula] params ausentes');
      return;
    }
    this.sumula$ = this.montarObservable();
  }

  /**
   * URL data:image/png da súmula renderizada como imagem (modo mobile-modal).
   * Quando setada, o template ESCONDE o HTML da folha e mostra essa imagem
   * rotacionada. Idêntico visualmente ao PDF gerado — elimina problemas de
   * CSS mobile (table-layout, vertical-text, colunas desalinhadas) porque
   * é uma captura estática do layout web (que renderiza certo).
   */
  previewImagemUrl: string | null = null;
  /** Loading flag enquanto a captura roda (mostra spinner no template). */
  gerandoPreviewMobile = false;
  private previewGerado = false;

  ngAfterViewInit(): void {
    // Em modo MODAL (mobile OU web): gera preview como IMAGEM idêntica ao
    // PDF. Em mobile a img é rotacionada via CSS pra caber em portrait;
    // em web é exibida em tamanho natural (A4 landscape). Em ambos os
    // casos, o HTML original fica visibility:hidden por baixo (continua
    // no DOM pra imprimir/baixarPdf reutilizarem).
    if (this.isModal) {
      this.gerarPreviewMobile();
    }
  }

  /**
   * Gera a "preview" da súmula como imagem PNG (mesma pipeline do
   * `baixarPdf`) e atribui a `previewImagemUrl`. Chamado SÓ em mobile-modal.
   *
   * Por que isto existe:
   *   - O modal mobile rotaciona a folha via CSS (`transform: rotate(90deg)`),
   *     mas o `table-layout: fixed` + `writing-mode: vertical-rl` da
   *     `.vertical-text` (TÉCNICO/CAPITÃO) desalinha as colunas em browsers
   *     mobile, mesmo com `<colgroup>` forçando widths.
   *   - Gerando a imagem do layout WEB (off-screen, sem rotate) e exibindo
   *     essa imagem rotacionada, o resultado é pixel-perfect IGUAL ao PDF.
   *   - O HTML original continua no DOM (escondido via CSS) pra que
   *     `imprimir()` / `baixarPdf()` continuem funcionando normalmente.
   */
  private async gerarPreviewMobile(): Promise<void> {
    if (this.previewGerado) return;
    this.gerandoPreviewMobile = true;
    try {
      // Espera a `.sumula-folha` renderizar no DOM (sumula$ é async).
      const folha = await this.esperarSeletor('.sumula-folha', 8000);
      if (!folha) return;

      // Aguarda imagens + inline (logos do campeonato / equipes).
      await this.aguardarImagens(3000);
      await this.inlineImagens(folha);
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const dataUrl = await this.capturarFolhaParaPreview(folha);
      if (dataUrl) {
        this.previewImagemUrl = dataUrl;
        this.previewGerado = true;
        // Aguarda Angular renderizar a <img> no DOM e ATIVA pinch-zoom
        // SÓ em mobile (no web, scroll natural já basta). As CSS vars
        // `--user-zoom`/`--user-pan-x`/`--user-pan-y` modificadas pelos
        // handlers de touch são aplicadas no `transform` da img.
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        await new Promise<void>(r => requestAnimationFrame(() => r()));
        if (this.ehMobile()) {
          this.ativarPinchZoomImgPreview();
        }
      }
    } catch (err) {
      console.error('[gerarPreviewMobile] erro', err);
    } finally {
      this.gerandoPreviewMobile = false;
    }
  }

  /**
   * Ativa pinch-zoom + pan + double-tap NA `<img class="sumula-preview-img">`
   * em vez da `.sumula-folha`. Os mesmos handlers de touch são reutilizados —
   * eles operam via `--user-zoom`/`--user-pan-x`/`--user-pan-y` no
   * `touchTarget`, e o transform da img já consome essas CSS vars.
   */
  private ativarPinchZoomImgPreview(): void {
    this.removerListenersPinchZoom();
    const root = this.host.nativeElement as HTMLElement;
    const img = root.querySelector<HTMLElement>('.sumula-preview-img');
    if (!img) return;
    this.touchTarget = img;
    img.addEventListener('touchstart', this.onTouchStart, { passive: false });
    img.addEventListener('touchmove', this.onTouchMove, { passive: false });
    img.addEventListener('touchend', this.onTouchEnd, { passive: false });
    img.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    img.addEventListener('dblclick', this.onDoubleTap, { passive: false });
  }

  /**
   * Aguarda um seletor aparecer no host. Usado pra esperar `sumula$ | async`
   * resolver e a `.sumula-folha` aparecer no DOM antes da captura.
   */
  private esperarSeletor(seletor: string, timeoutMs: number): Promise<HTMLElement | null> {
    return new Promise(resolve => {
      const root = this.host.nativeElement as HTMLElement;
      const existing = root.querySelector<HTMLElement>(seletor);
      if (existing) return resolve(existing);
      const inicio = Date.now();
      const check = (): void => {
        const el = root.querySelector<HTMLElement>(seletor);
        if (el) return resolve(el);
        if (Date.now() - inicio > timeoutMs) return resolve(null);
        requestAnimationFrame(check);
      };
      check();
    });
  }

  /**
   * Captura a `.sumula-folha` como PNG data URL. Idêntico ao pipeline do
   * `baixarPdf` mas sem o passo do jsPDF — retorna direto o data URL pra
   * exibir como `<img>` no template.
   */
  private async capturarFolhaParaPreview(folha: HTMLElement): Promise<string | null> {
    const offscreen = document.createElement('div');
    offscreen.style.cssText = `
      position: fixed;
      top: -10000px;
      left: 0;
      width: 290mm;
      background: #ffffff;
      pointer-events: none;
      z-index: -1;
    `;
    try {
      const clone = folha.cloneNode(true) as HTMLElement;
      clone.style.transform = 'none';
      clone.style.position = 'static';
      clone.style.top = 'auto';
      clone.style.left = 'auto';
      clone.style.margin = '0';
      clone.style.boxShadow = 'none';
      clone.style.setProperty('--user-zoom', '1');
      clone.style.setProperty('--user-pan-x', '0px');
      clone.style.setProperty('--user-pan-y', '0px');
      clone.style.setProperty('--rot-scale', '1');
      clone.style.setProperty('border-width', '0.3px', 'important');
      clone.querySelectorAll<HTMLElement>('*').forEach(el => {
        el.style.setProperty('border-width', '0.3px', 'important');
      });

      // Anti-rotação do TÉCNICO/CAPITÃO — `writing-mode: vertical-rl` +
      // `transform: rotate(180deg)` confunde dom-to-image. Trocamos por
      // um `<div>` rotate(-90deg) puro (idêntico ao baixarPdf).
      clone.querySelectorAll<HTMLElement>('.vertical-text').forEach(v => {
        const texto = (v.textContent || '').trim();
        if (!texto) return;
        v.style.writingMode = 'horizontal-tb';
        v.style.transform = 'none';
        v.style.position = 'relative';
        v.style.padding = '0';
        v.innerHTML =
          '<div style="position:absolute;top:50%;left:50%;' +
          'transform:translate(-50%,-50%) rotate(-90deg);' +
          'transform-origin:center center;white-space:nowrap;' +
          'font:inherit;color:inherit;">' +
          texto +
          '</div>';
      });

      offscreen.appendChild(clone);
      document.body.appendChild(offscreen);

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
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      const rect = clone.getBoundingClientRect();
      // Scale 2× pro mobile (menos memória que 3×, ainda nítido pro
      // tamanho da tela em portrait).
      const dataUrl = await domtoimage.toPng(clone, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        scale: 2,
        cacheBust: false,
      });
      return dataUrl;
    } catch (err) {
      console.error('[capturarFolhaParaPreview] erro', err);
      return null;
    } finally {
      if (offscreen.parentNode) {
        offscreen.parentNode.removeChild(offscreen);
      }
    }
  }

  ngOnDestroy(): void {
    this.removerListenersPinchZoom();
  }

  voltar(): void {
    // Modo modal: fecha o modal em vez de navegar pra trás.
    if (this.isModal) {
      this.modalCtrl.dismiss();
      return;
    }
    this.navBack.back([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      this.jogoId,
    ]);
  }

  /**
   * Gera e abre o diálogo de impressão.
   *
   * Antes de chamar `window.print()`, mostra um loading "Gerando súmula..."
   * porque:
   *  1. Imagens (logos do campeonato + equipes) podem ainda não ter terminado
   *     de carregar — se o print dispara antes, sai branco no PDF.
   *  2. O browser bloqueia a thread enquanto monta o preview de impressão,
   *     o que daria a impressão de "travou" sem nenhum feedback visual.
   *
   * O loading é dismissado logo depois de chamar `window.print()` —
   * importante porque o `print()` bloqueia até o usuário fechar o
   * diálogo, então deixamos um setTimeout pra dismissar quando voltar.
   */
  /**
   * Gera a súmula como PDF (mesma pipeline do `baixarPdf()` — html2canvas
   * + jsPDF) e abre numa nova aba com `autoPrint()` ativo. O reader do
   * PDF dispara o diálogo de impressão automaticamente.
   *
   * Antes usava `window.print()` direto, mas tinha 2 problemas:
   *   1) Rendering nativo do print é frágil — depende de @media print,
   *      borders 1px somem em algumas escalas, layout distorce no mobile
   *      por causa do `transform: rotate(90deg)` da CSS mobile que persiste.
   *   2) Não dava saída idêntica ao "Baixar PDF" — usuário via diferença
   *      visual entre os 2 caminhos.
   *
   * Com html2canvas + jsPDF + autoPrint, ambos os caminhos ("Baixar PDF"
   * e "Imprimir") usam a MESMA pipeline de captura — pixel-perfect
   * idênticos. A única diferença é o destino (save vs autoPrint+newtab).
   */
  /**
   * Imprime a súmula abrindo uma NOVA JANELA isolada contendo só a folha
   * (com os mesmos stylesheets do app), e disparando window.print() lá.
   *
   * Por que não usar `html2canvas + jsPDF`:
   *   - Rasterizar o DOM produz PDF de imagem com bordas perceptivelmente
   *     mais grossas que a tela. JPEG borra linhas finas, PNG fica
   *     ok mas anti-aliasing diferente do browser. Resultado: usuário
   *     percebe as bordas como "grossas".
   *
   * Por que não usar `window.print()` direto na página atual:
   *   - O Chrome em mobile aplica @media print sobre TODA a página, e
   *     dependendo do viewport (≤900px) a folha pode ficar escondida
   *     ou distorcida. Houve várias tentativas; cada vez tinha algum
   *     edge case.
   *
   * Por que abrir em nova janela com só a folha funciona:
   *   - Janela limpa, sem modal, sem ion-content, sem shell.
   *   - Importa os MESMOS stylesheets do app via `<link>` clonados —
   *     o `.sumula-folha` renderiza idêntico à tela (vetor nativo).
   *   - `window.print()` na nova janela = PDF vetorial com bordas
   *     hairline crisp, iguais à tela.
   *   - Fecha a janela depois de printar.
   */
  async imprimir(): Promise<void> {
    const root = this.host.nativeElement as HTMLElement;
    const folha = root.querySelector<HTMLElement>('.sumula-folha');
    if (!folha) return;

    const loading = await this.loadingCtrl.create({
      message: 'Preparando impressão...',
      spinner: 'crescent',
    });
    await loading.present();

    try {
      await this.aguardarImagens(3000);
    } catch {
      /* segue */
    }

    // Coleta todos os <link rel="stylesheet"> e <style> do head atual
    // pra clonar no doc da nova janela — assim as classes Angular com
    // `[_ngcontent-...]` continuam aplicando ao HTML clonado da folha.
    const headHtml = Array.from(
      document.head.querySelectorAll('link[rel="stylesheet"], style'),
    )
      .map(el => el.outerHTML)
      .join('\n');

    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) {
      await loading.dismiss();
      const t = await this.toastCtrl.create({
        message: 'Não foi possível abrir nova janela. Permita pop-ups e tente de novo.',
        duration: 4000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
      return;
    }

    win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Súmula</title>
${headHtml}
<style>
  @page { size: A4 landscape; margin: 5mm; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { display: flex; justify-content: center; }
  .sumula-folha {
    box-shadow: none !important;
    margin: 0 auto !important;
    transform: none !important;
    position: static !important;
  }
</style>
</head>
<body>
${folha.outerHTML}
</body>
</html>`);
    win.document.close();

    await loading.dismiss();

    // Espera os stylesheets/imagens do doc novo carregarem antes de
    // chamar `print()` — senão a folha sai sem styles aplicados.
    // Usa `afterprint` pra fechar SÓ depois do usuário interagir com
    // o diálogo (printar ou cancelar). `setTimeout` curto antes
    // fechava a janela antes do diálogo aparecer.
    const dispararPrint = async (): Promise<void> => {
      // Espera stylesheets carregarem na nova janela.
      try {
        const links = Array.from(
          win.document.querySelectorAll('link[rel="stylesheet"]'),
        ) as HTMLLinkElement[];
        await Promise.all(
          links.map(
            link =>
              new Promise<void>(resolve => {
                if ((link as HTMLLinkElement).sheet) return resolve();
                link.addEventListener('load', () => resolve(), { once: true });
                link.addEventListener('error', () => resolve(), { once: true });
                setTimeout(resolve, 1500); // fallback timeout
              }),
          ),
        );
      } catch {
        /* segue */
      }

      // Espera imagens da folha clonada também carregarem.
      try {
        const imgs = Array.from(win.document.querySelectorAll('img')) as HTMLImageElement[];
        await Promise.all(
          imgs.map(
            img =>
              new Promise<void>(resolve => {
                if (img.complete) return resolve();
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
                setTimeout(resolve, 2000);
              }),
          ),
        );
      } catch {
        /* segue */
      }

      // Fecha a janela DEPOIS do diálogo de impressão ser fechado.
      win.addEventListener(
        'afterprint',
        () => {
          try { win.close(); } catch { /* ignore */ }
        },
        { once: true },
      );

      try {
        win.focus();
        win.print();
      } catch (err) {
        console.warn('[imprimir] window.print falhou', err);
        try { win.close(); } catch { /* ignore */ }
      }
    };

    if (win.document.readyState === 'complete') {
      void dispararPrint();
    } else {
      win.addEventListener('load', () => void dispararPrint(), { once: true });
    }
  }

  /**
   * Baixa a súmula como PDF (A4 paisagem). Funciona em desktop E mobile —
   * útil em iOS onde `window.print()` nem sempre oferece a opção "Salvar
   * como PDF" no diálogo nativo.
   *
   * Estratégia:
   *  1. Localiza o elemento `.sumula-folha` no DOM
   *  2. Usa `html2canvas` pra renderizar como bitmap em alta resolução
   *  3. Passa o bitmap pro `jsPDF` configurado em A4 landscape
   *  4. `doc.save(...)` força download via `<a download>` no browser
   *
   * Em mobile o elemento está ROTACIONADO via CSS — html2canvas captura
   * a versão sem transformações (o transform CSS não afeta a renderização
   * via canvas), então o PDF final sai correto independente do display.
   */
  /**
   * Baixa direto o .pdf SEM diálogo, com bordas finas e SEM corte.
   *
   * Estratégia chave (a que finalmente funciona pros dois requisitos):
   *
   *   1. CLONA a `.sumula-folha` pra um container `position: fixed`
   *      OFF-SCREEN (top: -10000px) no `<body>` da página. Isto tira
   *      a folha do contexto do modal (que tem overflow/clipping/scale)
   *      e dá a ela espaço ilimitado pra renderizar.
   *
   *   2. Aplica `border-width: 0.5px` inline + `!important` em cada
   *      elemento do clone (inline + important = especificidade máxima
   *      em CSS, vence qualquer regra Angular encapsulada).
   *
   *   3. Captura com `html2canvas + foreignObjectRendering: true`.
   *      Sem o contexto restrito do modal, o SVG `<foreignObject>`
   *      renderiza a folha INTEIRA sem cortar.
   *
   *   4. Embute em jsPDF como PNG sem perda → arquivo .pdf vai
   *      direto pra Downloads via `pdf.save()`, sem diálogo.
   *
   *   5. Remove o clone do DOM no `finally`.
   */
  async baixarPdf(): Promise<void> {
    const root = this.host.nativeElement as HTMLElement;
    const folhaOriginal = root.querySelector<HTMLElement>('.sumula-folha');
    if (!folhaOriginal) return;

    const loading = await this.loadingCtrl.create({
      message: 'Gerando PDF...',
      spinner: 'crescent',
    });
    await loading.present();

    // Container off-screen e clone — declarados fora do try pra acessar
    // no finally.
    const offscreen = document.createElement('div');
    offscreen.style.cssText = `
      position: fixed;
      top: -10000px;
      left: 0;
      width: 290mm;
      background: #ffffff;
      pointer-events: none;
      z-index: -1;
    `;

    try {
      await this.aguardarImagens(3000);
      await this.inlineImagens(folhaOriginal);

      // Clone profundo (preserva DOM e estados como `innerHTML`).
      const folhaClone = folhaOriginal.cloneNode(true) as HTMLElement;

      // Reseta transforms/posicionamento herdados do modo modal mobile.
      folhaClone.style.transform = 'none';
      folhaClone.style.position = 'static';
      folhaClone.style.top = 'auto';
      folhaClone.style.left = 'auto';
      folhaClone.style.margin = '0';
      folhaClone.style.boxShadow = 'none';
      folhaClone.style.setProperty('--user-zoom', '1');
      folhaClone.style.setProperty('--user-pan-x', '0px');
      folhaClone.style.setProperty('--user-pan-y', '0px');
      folhaClone.style.setProperty('--rot-scale', '1');

      // Borders HAIRLINE via inline style com !important. 0.3px é o
      // limite onde a borda ainda aparece no html2canvas (scale 4 = 1.2
      // canvas pixels — visível) mas no PDF A4 vira ~0.2pt = hairline.
      // Inline + !important supera qualquer regra Angular encapsulada.
      folhaClone.style.setProperty('border-width', '0.3px', 'important');
      const todos = folhaClone.querySelectorAll<HTMLElement>('*');
      todos.forEach(el => {
        el.style.setProperty('border-width', '0.3px', 'important');
      });

      // Anti-rotação do TÉCNICO/CAPITÃO pra html2canvas renderizar certo.
      const verticais = folhaClone.querySelectorAll<HTMLElement>('.vertical-text');
      verticais.forEach(v => {
        const texto = (v.textContent || '').trim();
        if (!texto) return;
        v.style.writingMode = 'horizontal-tb';
        v.style.transform = 'none';
        v.style.position = 'relative';
        v.style.padding = '0';
        v.innerHTML =
          '<div style="position:absolute;top:50%;left:50%;' +
          'transform:translate(-50%,-50%) rotate(-90deg);' +
          'transform-origin:center center;white-space:nowrap;' +
          'font:inherit;color:inherit;">' +
          texto +
          '</div>';
      });

      offscreen.appendChild(folhaClone);
      document.body.appendChild(offscreen);

      // 2 frames pra layout estabilizar.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      // Aguarda as IMAGENS DO CLONE decodificarem — `cloneNode(true)`
      // copia o `src` mas o browser precisa baixar/decodar a imagem do
      // base64 nos novos elementos antes do dom-to-image capturar.
      // Sem isso, logos saem em branco no PDF.
      const imgsClone = Array.from(folhaClone.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgsClone.map(img => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>(resolve => {
            const fin = (): void => resolve();
            img.addEventListener('load', fin, { once: true });
            img.addEventListener('error', fin, { once: true });
            // Fallback timeout — se a imagem demorar, segue sem ela.
            setTimeout(fin, 2000);
          });
        }),
      );
      // Mais um yield depois das imagens decodificarem.
      await new Promise<void>(r => requestAnimationFrame(() => r()));

      // Mede dimensões REAIS do clone fora do modal.
      const rect = folhaClone.getBoundingClientRect();

      // Usa `dom-to-image-more` em vez de html2canvas — implementação
      // SVG-foreignObject diferente, com melhor handling de sub-pixel
      // borders (preserva 0.3-0.5px CSS como hairline no canvas final).
      // Retorna PNG data URL direto pronto pra embutir no jsPDF.
      const dataUrl = await domtoimage.toPng(folhaClone, {
        bgcolor: '#ffffff',
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
        // Pixel ratio 3× pra resolução alta (texto/borders nítidos).
        // dom-to-image usa este multiplicador na renderização SVG.
        scale: 3,
        cacheBust: true,
      });

      // Cria um canvas auxiliar SÓ pra extrair as dimensões finais.
      const tmpImg = new Image();
      const carregado = new Promise<void>((resolve, reject) => {
        tmpImg.onload = () => resolve();
        tmpImg.onerror = () => reject(new Error('falha ao carregar PNG do dom-to-image'));
      });
      tmpImg.src = dataUrl;
      await carregado;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgRatio = tmpImg.naturalHeight / tmpImg.naturalWidth;
      const imgWidth = pdfWidth;
      let imgHeight = imgWidth * imgRatio;
      if (imgHeight > pdfHeight) imgHeight = pdfHeight;

      pdf.addImage(dataUrl, 'PNG', 0, 0, imgWidth, imgHeight);

      await salvarPdf(pdf, `sumula-${this.jogoId}.pdf`, this.toastCtrl, this.modalCtrl);
    } catch (err) {
      console.error('[baixarPdf] erro', err);
      const t = await this.toastCtrl.create({
        message: 'Falha ao gerar PDF. Tente novamente.',
        duration: 3000,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      // Remove o clone off-screen pra liberar memória.
      try {
        if (offscreen.parentNode) {
          offscreen.parentNode.removeChild(offscreen);
        }
      } catch { /* ignore */ }
      await loading.dismiss();
    }
  }

  /**
   * Aguarda todas as imagens dentro do componente terminarem de carregar.
   * Resolve quando todas concluem (com sucesso ou erro) ou quando o
   * timeout expira — o que vier primeiro.
   */
  private aguardarImagens(timeoutMs: number): Promise<void> {
    return new Promise<void>(resolve => {
      const imgs = Array.from(
        this.host.nativeElement.querySelectorAll('img'),
      ) as HTMLImageElement[];
      const pendentes = imgs.filter(img => !img.complete);
      if (pendentes.length === 0) return resolve();

      let restantes = pendentes.length;
      const finalizar = (): void => {
        restantes--;
        if (restantes <= 0) resolve();
      };
      pendentes.forEach(img => {
        img.addEventListener('load', finalizar, { once: true });
        img.addEventListener('error', finalizar, { once: true });
      });

      // Fallback: timeout duro pra não esperar pra sempre.
      setTimeout(() => resolve(), timeoutMs);
    });
  }

  /**
   * Captura a folha como canvas REPLICANDO fielmente o rendering da tela.
   *
   * Pra evitar bordas grossas no PDF (problema anterior):
   *   - `scale: 3` — 3× a resolução CSS (escala alta → bordas finas
   *     relativas mesmo em PDF A4 paisagem).
   *   - PNG sem perda (chamado externamente) — JPEG borra linhas 1px.
   *   - NÃO altera `border-width` no clone: mantém 1px igual à tela
   *     (visualização que o usuário aprovou).
   */
  private async capturarFolha(folha: HTMLElement): Promise<HTMLCanvasElement> {
    return html2canvas(folha, {
      scale: 3,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      onclone: (clonedDoc: Document) => {
        this.prepararCloneParaCaptura(clonedDoc);
      },
    });
  }

  /**
   * Converte todas as `<img>` do container em data URLs (base64) ANTES
   * do html2canvas capturar — sem isso os logos saem em branco no PDF.
   *
   * Estratégia (canvas-based, mais robusta que fetch+FileReader):
   *  1. Pra cada `<img>`, cria UM NOVO `<Image>` com `crossOrigin =
   *     'anonymous'` ANTES de setar o src.
   *  2. Quando ele carregar, desenha em `<canvas>` e exporta com
   *     `toDataURL` — base64 pronto, inline.
   *  3. Substitui `img.src` da DOM original pelo data URL.
   *
   * Por que isto é melhor que `fetch + FileReader`:
   *  - `fetch` honra cache, e o cache pode ter sido populado com a img
   *    carregada SEM CORS (1ª carga sem `crossorigin`). Aí o fetch
   *    retorna cached opaque response e CORS quebra.
   *  - Novo `<Image>` com `crossOrigin = 'anonymous'` FORÇA o browser a
   *    re-buscar com CORS preflight (mesmo se já existe no cache não-CORS).
   *  - `canvas.toDataURL` é universalmente suportado e não tem timing
   *    issues do FileReader async com large blobs.
   *
   * IMPORTANTE: NÃO mexer no `crossorigin` da tag `<img>` original no
   * template — isso quebra a exibição na tela quando o Firebase Storage
   * não responde com CORS adequado. Só processa em separado pro PDF.
   */
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
        } catch {
          /* segue sem essa imagem */
        }
      }),
    );
  }

  /**
   * Carrega URL como data URL (base64). Tenta 2 caminhos pra maximizar
   * sucesso em Firebase Storage / CDNs:
   *  1) `fetch(src, { mode: 'cors', cache: 'no-store' })` — força nova
   *     requisição com CORS (não usa cache opaque que pode ter ficado
   *     da 1ª carga sem crossOrigin).
   *  2) Fallback: novo `<Image>` com `crossOrigin = 'anonymous'` +
   *     canvas → toDataURL.
   */
  private async urlParaDataUrl(src: string): Promise<string | null> {
    // Caminho 1: fetch direto (sem cache).
    try {
      const res = await fetch(src, { mode: 'cors', cache: 'no-store' });
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        return dataUrl;
      }
    } catch (err) {
      console.warn('[inlineImagens] fetch falhou pra', src, err);
    }

    // Caminho 2: Image() + canvas.
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          console.warn('[inlineImagens] canvas falhou pra', src, err);
          resolve(null);
        }
      };
      img.onerror = err => {
        console.warn('[inlineImagens] Image load falhou pra', src, err);
        resolve(null);
      };
      img.src = src;
    });
  }

  /**
   * Prepara o DOM CLONADO pra captura via html2canvas — chamado pelo
   * callback `onclone`. Centraliza tudo que precisa ser ajustado antes
   * do canvas ser renderizado:
   *
   *  1) `.sumula-folha` — zera transform/position/scale/pan do modo
   *     modal mobile (rotação 90° + scale) pra capturar em orientação
   *     A4 paisagem natural.
   *
   *  2) `.vertical-text` (TÉCNICO / CAPITÃO) — html2canvas v1.4.1 tem
   *     bug renderizando `writing-mode: vertical-rl + transform:
   *     rotate(180deg)` combinados (aplica só um dos dois, texto sai
   *     de cabeça pra baixo). Substituímos por `transform: rotate(-90deg)`
   *     puro (sem writing-mode) — html2canvas renderiza isto certo,
   *     e visualmente o resultado é IDÊNTICO (texto vertical lendo
   *     bottom-to-top com chars heads-left).
   */
  private prepararCloneParaCaptura(clonedDoc: Document): void {
    const clonedFolha = clonedDoc.querySelector<HTMLElement>('.sumula-folha');
    if (clonedFolha) {
      clonedFolha.style.transform = 'none';
      clonedFolha.style.position = 'static';
      clonedFolha.style.top = 'auto';
      clonedFolha.style.left = 'auto';
      clonedFolha.style.margin = '0';
      clonedFolha.style.setProperty('--user-zoom', '1');
      clonedFolha.style.setProperty('--user-pan-x', '0px');
      clonedFolha.style.setProperty('--user-pan-y', '0px');
      clonedFolha.style.setProperty('--rot-scale', '1');
    }

    // NÃO alteramos border-width aqui — mantemos 1px igual à tela
    // (visualização aprovada pelo usuário). A nitidez vem do scale: 3
    // + saída PNG (sem compressão lossy que borra linhas finas).

    // FIX html2canvas: `.vertical-text` usa `writing-mode: vertical-rl
    // + transform: rotate(180deg)` que o html2canvas v1.4.1 renderiza
    // errado (texto sai de cabeça pra baixo). NÃO mexer no TD (a célula
    // tem layout/borda/width que precisa ficar intacto). A solução é:
    //
    //   1) Pegar o texto do TD ("TÉCNICO" / "CAPITÃO")
    //   2) Inserir um <div> filho posicionado ABSOLUTO no centro do TD
    //   3) Rotacionar SÓ esse div com `transform: rotate(-90deg)`
    //   4) Limpar writing-mode/transform do TD pra não duplicar rotação
    //
    // Resultado: o TD continua com a mesma largura/borda/altura, e o
    // texto sai vertical legível dentro dele.
    const verticais = clonedDoc.querySelectorAll<HTMLElement>('.vertical-text');
    verticais.forEach(v => {
      const texto = (v.textContent || '').trim();
      if (!texto) return; // pula células vazias (são placeholders sem label)

      // Limpa o que o html2canvas processa errado no TD.
      v.style.writingMode = 'horizontal-tb';
      v.style.transform = 'none';
      v.style.position = 'relative';
      v.style.padding = '0';

      // Substitui conteúdo por um wrapper rotacionado, mantendo a
      // mesma classe pra preservar herança de cor/font.
      v.innerHTML =
        '<div style="position:absolute;top:50%;left:50%;' +
        'transform:translate(-50%,-50%) rotate(-90deg);' +
        'transform-origin:center center;white-space:nowrap;' +
        'font:inherit;color:inherit;">' +
        texto +
        '</div>';
    });
  }

  formatarDataBr(iso?: string | null): string {
    if (!iso) return 'A definir';
    return dataHoraIsoParaBr(iso) || iso;
  }

  /** Extrai só DD/MM/YYYY do datetime ISO. */
  formatarSomenteData(iso?: string | null): string {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    } catch {
      return iso;
    }
  }

  /** Monta "NOME (CIDADE/UF)" — formato dos times no cabeçalho. */
  nomeCompleto(eq?: Equipe): string {
    if (!eq) return '';
    if (eq.cidade) return `${eq.nome} (${eq.cidade})`;
    return eq.nome;
  }

  /** Junta cidades das duas equipes para a linha "CIDADE". */
  cidadeEquipes(s: SumulaView): string {
    const cm = s.mandante?.cidade;
    const cv = s.visitante?.cidade;
    if (cm && cv && cm !== cv) return `${cm} / ${cv}`;
    return cm || cv || '';
  }

  /** Acha o árbitro de uma função específica e retorna só o nome. */
  arbitroPor(funcao: FuncaoArbitro, arbitros: ArbitroJogo[]): string {
    return arbitros.find(a => a.funcao === funcao)?.nome ?? '';
  }

  /**
   * Garante N linhas na tabela de jogadores (mesmo que o time tenha menos).
   * Replica o modelo impresso que sempre mostra ~19 linhas pra escrita manual.
   */
  preencherLinhas(
    escalados: JogadorEscalado[],
    quantidade: number,
  ): (JogadorEscalado | undefined)[] {
    const out: (JogadorEscalado | undefined)[] = [...escalados];
    while (out.length < quantidade) out.push(undefined);
    return out.slice(0, Math.max(quantidade, out.length));
  }

  /**
   * Calcula quantas linhas mostrar em CADA tabela — usa o máximo entre as duas
   * equipes (pra que ambas fiquem com a mesma altura) ou LINHAS_JOGADORES (19)
   * como mínimo. Garante que as separações horizontais fluem alinhadas dos
   * dois lados.
   */
  linhasParaAmbas(s: SumulaView): number {
    return Math.max(
      this.LINHAS_JOGADORES,
      s.escMandante?.length ?? 0,
      s.escVisitante?.length ?? 0,
    );
  }

  private montarObservable(): Observable<SumulaView | undefined> {
    const campeonato$ = this.campsSrv.get$(this.campeonatoId).pipe(catchError(() => of(undefined)));
    const categoria$ = this.catsSrv
      .get$(this.campeonatoId, this.categoriaId)
      .pipe(catchError(() => of(undefined)));
    const jogo$ = this.jogosSrv
      .get$(this.campeonatoId, this.categoriaId, this.jogoId)
      .pipe(catchError(() => of(undefined)));
    const equipes$ = this.equipesSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Equipe[]>([]), catchError(() => of<Equipe[]>([])));
    const jogadores$ = this.jogadoresSrv
      .list$(this.campeonatoId, this.categoriaId)
      .pipe(startWith<Jogador[]>([]), catchError(() => of<Jogador[]>([])));
    const eventos$ = this.jogosSrv
      .listEventos$(this.campeonatoId, this.categoriaId, this.jogoId)
      .pipe(startWith<EventoJogo[]>([]), catchError(() => of<EventoJogo[]>([])));

    return combineLatest([campeonato$, categoria$, jogo$, equipes$, jogadores$, eventos$]).pipe(
      map(([camp, cat, jogo, equipes, jogadores, eventos]) => {
        if (!jogo) return undefined;
        const m = equipes.find(e => e.id === jogo.mandanteId);
        const v = equipes.find(e => e.id === jogo.visitanteId);

        // Lances ordenados por minuto (lances sem minuto vão pro fim)
        const lances: LinhaEvento[] = eventos
          .map(ev => ({
            tipo: ev.tipo,
            jogadorNome:
              jogadores.find(j => j.id === ev.jogadorId)?.nome ?? '(sem jogador)',
            equipe: (ev.equipeId === jogo.mandanteId ? 'mandante' : 'visitante') as
              | 'mandante'
              | 'visitante',
            minuto: ev.minuto,
            observacao: ev.observacao,
            quantidade: ev.quantidade,
          }))
          .sort((a, b) => (a.minuto ?? 999) - (b.minuto ?? 999));

        // Escalações com contagem de gols/amarelos/vermelhos
        const escMandante = this.montarEscalados(jogadores, eventos, jogo.mandanteId);
        const escVisitante = this.montarEscalados(jogadores, eventos, jogo.visitanteId);

        return {
          jogo,
          campeonato: camp,
          categoria: cat,
          mandante: m,
          visitante: v,
          escMandante,
          escVisitante,
          lances,
          arbitros: jogo.arbitros ?? [],
        };
      }),
    );
  }

  private montarEscalados(
    jogadores: Jogador[],
    eventos: EventoJogo[],
    equipeId: string,
  ): JogadorEscalado[] {
    const ids = jogadores.filter(j => j.equipeId === equipeId).map(j => j.id!);
    return ids
      .map(id => jogadores.find(j => j.id === id))
      .filter((j): j is Jogador => !!j)
      .map(j => {
        const meus = eventos.filter(e => e.jogadorId === j.id && e.equipeId === equipeId);
        return {
          jogador: j,
          gols: meus
            .filter(e => e.tipo === 'gol')
            .reduce((s, e) => s + (e.quantidade ?? 1), 0),
          amarelos: meus.filter(e => e.tipo === 'amarelo').length,
          vermelhos: meus.filter(e => e.tipo === 'vermelho').length,
        };
      })
      .sort((a, b) => (a.jogador.nome ?? '').localeCompare(b.jogador.nome ?? '', 'pt-BR'));
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

  rotuloStatus(s: string): string {
    switch (s) {
      case 'encerrado': return 'Encerrada';
      case 'em-andamento': return 'Em andamento';
      case 'agendado': return 'Agendada';
      case 'cancelado': return 'Cancelada';
      case 'wo': return 'W.O.';
      default: return s;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Pinch-zoom + pan na súmula (mobile, modo modal)
  //
  // O viewport global tem `user-scalable=no`, então o zoom nativo do
  // browser está desativado. Aqui implementamos um zoom CUSTOM SÓ pra
  // a `.sumula-folha` — o resto do app continua sem zoom (UX consistente
  // com PWA). Usa Touch Events (touchstart/move/end) pra:
  //   - 2 dedos: pinch zoom (escala 1× → 4×)
  //   - 1 dedo (quando já zoomado): pan
  // O resultado é aplicado via CSS custom properties que o stylesheet
  // combina com o rotate(90deg) + scale base.
  // ──────────────────────────────────────────────────────────────────

  private userZoom = 1;
  private userPanX = 0;
  private userPanY = 0;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private panStartX = 0;
  private panStartY = 0;
  private panStartUserX = 0;
  private panStartUserY = 0;
  private touchTarget: HTMLElement | null = null;

  private ehMobile(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
  }

  private ativarPinchZoom(): void {
    const root = this.host.nativeElement as HTMLElement;
    const folha = root.querySelector<HTMLElement>('.sumula-folha');
    if (!folha) return;
    this.touchTarget = folha;
    folha.addEventListener('touchstart', this.onTouchStart, { passive: false });
    folha.addEventListener('touchmove', this.onTouchMove, { passive: false });
    folha.addEventListener('touchend', this.onTouchEnd, { passive: false });
    folha.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
    folha.addEventListener('dblclick', this.onDoubleTap, { passive: false });
  }

  private removerListenersPinchZoom(): void {
    const folha = this.touchTarget;
    if (!folha) return;
    folha.removeEventListener('touchstart', this.onTouchStart);
    folha.removeEventListener('touchmove', this.onTouchMove);
    folha.removeEventListener('touchend', this.onTouchEnd);
    folha.removeEventListener('touchcancel', this.onTouchEnd);
    folha.removeEventListener('dblclick', this.onDoubleTap);
    this.touchTarget = null;
  }

  /** Distância euclidiana entre dois toques. */
  private distancia(t1: Touch, t2: Touch): number {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private onTouchStart = (ev: TouchEvent): void => {
    if (ev.touches.length === 2) {
      // Início do pinch — guarda distância inicial pra calcular delta.
      ev.preventDefault();
      this.pinchStartDist = this.distancia(ev.touches[0], ev.touches[1]);
      this.pinchStartZoom = this.userZoom;
    } else if (ev.touches.length === 1 && this.userZoom > 1) {
      // Início de pan (só quando já tem zoom).
      this.panStartX = ev.touches[0].clientX;
      this.panStartY = ev.touches[0].clientY;
      this.panStartUserX = this.userPanX;
      this.panStartUserY = this.userPanY;
    }
  };

  private onTouchMove = (ev: TouchEvent): void => {
    if (ev.touches.length === 2 && this.pinchStartDist > 0) {
      // Pinch ativo — atualiza zoom proporcional à mudança de distância.
      ev.preventDefault();
      const distAtual = this.distancia(ev.touches[0], ev.touches[1]);
      const ratio = distAtual / this.pinchStartDist;
      // Clamp entre 1× (sem zoom out abaixo do base) e 4× (limite confortável).
      this.userZoom = Math.max(1, Math.min(4, this.pinchStartZoom * ratio));
      // Se voltou ao zoom 1, zera o pan também pra recentralizar.
      if (this.userZoom <= 1.01) {
        this.userPanX = 0;
        this.userPanY = 0;
      }
      this.aplicarTransform();
    } else if (ev.touches.length === 1 && this.userZoom > 1) {
      // Pan — move a folha enquanto o dedo desliza.
      ev.preventDefault();
      const dx = ev.touches[0].clientX - this.panStartX;
      const dy = ev.touches[0].clientY - this.panStartY;
      this.userPanX = this.panStartUserX + dx;
      this.userPanY = this.panStartUserY + dy;
      this.aplicarTransform();
    }
  };

  private onTouchEnd = (ev: TouchEvent): void => {
    if (ev.touches.length < 2) {
      this.pinchStartDist = 0;
    }
  };

  /** Double-tap reseta o zoom (UX comum em apps mobile). */
  private onDoubleTap = (ev: Event): void => {
    ev.preventDefault();
    this.userZoom = 1;
    this.userPanX = 0;
    this.userPanY = 0;
    this.aplicarTransform();
  };

  /** Aplica os valores atuais via CSS custom properties — o stylesheet
   *  combina com a rotação base. */
  private aplicarTransform(): void {
    if (!this.touchTarget) return;
    this.touchTarget.style.setProperty('--user-zoom', String(this.userZoom));
    this.touchTarget.style.setProperty('--user-pan-x', `${this.userPanX}px`);
    this.touchTarget.style.setProperty('--user-pan-y', `${this.userPanY}px`);
  }
}
