import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import html2canvas from 'html2canvas';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { Categoria } from '../../../campeonatos/categoria.model';

export type ArteJogoOpcao = 1 | 2;

/**
 * Modal "Arte do Jogo" — gera uma arte visual da partida em 3 layouts
 * pré-definidos (opções 1, 2, 3) com campos editáveis ao vivo. O botão
 * "Compartilhar" usa html2canvas pra renderizar o preview em PNG e
 * dispara o Web Share API (mobile) ou download direto (desktop).
 */
@Component({
  selector: 'app-arte-do-jogo-modal',
  templateUrl: './arte-do-jogo-modal.component.html',
  styleUrls: ['./arte-do-jogo-modal.component.scss'],
  standalone: false,
})
export class ArteDoJogoModalComponent implements OnInit {
  @Input() jogo!: Jogo;
  @Input() mandante?: Equipe;
  @Input() visitante?: Equipe;
  @Input() campeonato?: Campeonato;
  @Input() categoria?: Categoria;

  private readonly fb = inject(FormBuilder);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  @ViewChild('preview', { read: ElementRef }) previewEl?: ElementRef<HTMLDivElement>;

  opcao: ArteJogoOpcao = 1;
  gerando = false;

  /** Tamanho da fonte (multiplicador aplicado nas fontes do preview via
   *  CSS variable `--font-scale`). 1.0 = default; 0.85 = compacto; 1.15 = ampliado. */
  tamanhoFonte: 'pequeno' | 'medio' | 'grande' = 'medio';

  get fontScale(): number {
    return this.tamanhoFonte === 'pequeno' ? 0.85
         : this.tamanhoFonte === 'grande'  ? 1.15
         : 1;
  }

  trocarTamanho(t: 'pequeno' | 'medio' | 'grande'): void {
    this.tamanhoFonte = t;
  }

  /**
   * 5 fundos padrão (estilo Canva) — cada um é uma classe CSS aplicada
   * ao container `.arte`. O `id` é usado como modificador no HTML e o
   * `label` aparece no thumbnail.
   */
  readonly fundos: { id: string; label: string }[] = [
    { id: 'gramado',   label: 'Gramado' },
    { id: 'estadio',   label: 'Estádio' },
    { id: 'quadra',    label: 'Quadra' },
    { id: 'gradient',  label: 'Gradiente' },
    { id: 'liso',      label: 'Liso' },
  ];

  /** Form com todos os campos editáveis (alguns só aparecem em opções específicas). */
  readonly form: FormGroup = this.fb.nonNullable.group({
    nomeMandante: [''],
    nomeVisitante: [''],
    titulo: [''],
    subtitulo: [''],
    endereco: [''],
    diaSemana: [''],
    data: [''],
    hora: [''],
    cor1: ['#1C2E3D'],
    cor2: ['#F2C500'],
    fundo: ['gramado'],
    decoracao: [true],
    addBrasao: [true],
  });

  ngOnInit(): void {
    // Pré-popula a partir do jogo + campeonato + categoria
    const dataHora = this.jogo?.dataHora ?? '';
    let dataIso = '';
    let horaIso = '';
    if (dataHora) {
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(dataHora);
      if (m) {
        dataIso = `${parseInt(m[3], 10)}/${parseInt(m[2], 10)}`;
        if (m[4]) horaIso = `${m[4]}:${m[5]}`;
      }
    }
    this.form.patchValue({
      nomeMandante: this.mandante?.nome ?? 'Mandante',
      nomeVisitante: this.visitante?.nome ?? 'Visitante',
      titulo: this.campeonato?.titulo ?? '',
      subtitulo: this.categoria?.titulo ?? '',
      endereco: this.jogo?.local ?? '',
      diaSemana: this.diaSemanaPtBr(dataHora),
      data: dataIso,
      hora: horaIso,
    });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  trocarOpcao(o: ArteJogoOpcao): void {
    this.opcao = o;
  }

  get golsMandante(): number {
    return this.jogo?.golsMandante ?? 0;
  }
  get golsVisitante(): number {
    return this.jogo?.golsVisitante ?? 0;
  }

  /**
   * Renderiza o preview pra PNG via html2canvas e dispara o Web Share API
   * (mobile) com fallback pra download. Mostra toast em caso de erro.
   */
  async compartilhar(): Promise<void> {
    if (!this.previewEl) return;
    this.gerando = true;
    try {
      // Tamanho-alvo: 1080x1080 (Instagram feed). Calcula `scale` com base
      // na largura real do preview pra garantir export nesse tamanho.
      const target = 1080;
      const previewW = this.previewEl.nativeElement.offsetWidth || target;
      const scale = target / previewW;
      const canvas = await html2canvas(this.previewEl.nativeElement, {
        backgroundColor: null,
        scale,
        width: previewW,
        height: previewW, // square 1:1
        useCORS: true,
      });
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject('blob null')), 'image/png');
      });
      const arquivo = new File([blob], 'arte-jogo.png', { type: 'image/png' });

      // Web Share API com arquivo (mobile moderno)
      if (navigator.share && (navigator as Navigator & { canShare?: (data: ShareData) => boolean }).canShare?.({ files: [arquivo] })) {
        await navigator.share({
          files: [arquivo],
          title: 'Arte do jogo',
          text: `${this.form.value.nomeMandante} × ${this.form.value.nomeVisitante}`,
        });
      } else {
        // Fallback: download direto
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'arte-jogo.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[ArteJogo] gerar erro', err);
      const t = await this.toastCtrl.create({
        message: 'Erro ao gerar a arte.',
        duration: 2400,
        color: 'danger',
        position: 'top',
      });
      await t.present();
    } finally {
      this.gerando = false;
    }
  }

  /** Devolve "TERÇA-FEIRA" / "QUARTA-FEIRA"... a partir de um ISO `YYYY-MM-DDTHH:mm`. */
  private diaSemanaPtBr(iso: string): string {
    if (!iso) return '';
    const [datePart] = iso.split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    if (!y || !m || !d) return '';
    const dt = new Date(y, m - 1, d);
    const nomes = ['DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA', 'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO'];
    return nomes[dt.getDay()] ?? '';
  }
}
