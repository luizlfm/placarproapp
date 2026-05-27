import { Component, Input, inject } from '@angular/core';
import { LoadingController, ModalController, ToastController } from '@ionic/angular';
import * as XLSX from 'xlsx';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { NovoJogadorInput } from '../../../../campeonatos/models/jogador.model';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';

type CampoJogador =
  | 'nome'
  | 'apelido'
  | 'posicao'
  | 'numeroCamisa'
  | 'documento'
  | 'dataNascimento'
  | 'telefone'
  | 'ignorar';

interface Coluna {
  /** Cabeçalho original do arquivo (ou "Coluna 1" se não houver). */
  header: string;
  /** Para qual campo do Jogador essa coluna mapeia. */
  campo: CampoJogador;
}

interface LinhaPreview {
  ok: boolean;
  motivo?: string;
  dados: NovoJogadorInput;
}

@Component({
  selector: 'app-importar-jogadores-modal',
  templateUrl: './importar-jogadores-modal.component.html',
  styleUrls: ['./importar-jogadores-modal.component.scss'],
  standalone: false,
})
export class ImportarJogadoresModalComponent {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() equipe!: Equipe;

  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  readonly camposDisponiveis: { value: CampoJogador; label: string }[] = [
    { value: 'nome', label: 'Nome *' },
    { value: 'apelido', label: 'Apelido' },
    { value: 'posicao', label: 'Posição' },
    { value: 'numeroCamisa', label: 'Nº camisa/registro' },
    { value: 'documento', label: 'Documento (CPF/RG)' },
    { value: 'dataNascimento', label: 'Data de nascimento' },
    { value: 'telefone', label: 'Telefone' },
    { value: 'ignorar', label: '— Ignorar coluna —' },
  ];

  arquivoNome = '';
  colunas: Coluna[] = [];
  /** Linhas cruas do arquivo (sem headers se a primeira linha for header). */
  private linhas: unknown[][] = [];
  primeiraLinhaEhHeader = true;
  preview: LinhaPreview[] = [];
  importando = false;

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async escolherArquivo(): Promise<void> {
    const file = await this.pickFile();
    if (!file) return;
    this.arquivoNome = file.name;
    await this.parsearArquivo(file);
  }

  async baixarTemplate(): Promise<void> {
    const header = [
      'Nome',
      'Apelido',
      'Posicao',
      'Numero',
      'Documento',
      'Nascimento',
      'Telefone',
    ];
    const exemplo = [
      ['João da Silva', 'Joãozinho', 'Atacante', '9', '000.000.000-00', '2000-05-15', '11999998888'],
      ['Pedro Santos', '', 'Goleiro', '1', '', '', ''],
    ];
    const csv = [header, ...exemplo]
      .map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-jogadores.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await this.toast('Template baixado!', 'success');
  }

  togglePrimeiraLinhaHeader(): void {
    this.primeiraLinhaEhHeader = !this.primeiraLinhaEhHeader;
    this.aplicarCabecalhos();
    this.recalcPreview();
  }

  onMapeamentoChange(idx: number, valor: CampoJogador): void {
    if (!this.colunas[idx]) return;
    this.colunas[idx].campo = valor;
    this.recalcPreview();
  }

  async confirmar(): Promise<void> {
    const validos = this.preview.filter(p => p.ok).map(p => p.dados);
    if (validos.length === 0) {
      await this.toast('Nenhuma linha válida pra importar.', 'danger');
      return;
    }
    this.importando = true;
    const loader = await this.loadingCtrl.create({
      message: `Importando ${validos.length} jogador(es)...`,
    });
    await loader.present();
    try {
      const total = await this.jogadoresSrv.criarEmLote(
        this.campeonatoId,
        this.categoriaId,
        validos,
      );
      await this.toast(`${total} jogador(es) importados!`, 'success');
      await this.modalCtrl.dismiss({ imported: total });
    } catch (err) {
      console.error('[Importar] erro', err);
      await this.toast('Erro ao importar. Verifique permissões.', 'danger');
    } finally {
      this.importando = false;
      await loader.dismiss();
    }
  }

  get totalValido(): number {
    return this.preview.filter(p => p.ok).length;
  }

  get totalInvalido(): number {
    return this.preview.filter(p => !p.ok).length;
  }

  trackByIndex(i: number): number {
    return i;
  }

  // ─────────────────────────────────────────────────────────
  private async parsearArquivo(file: File): Promise<void> {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const dados = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        blankrows: false,
        defval: '',
      });
      this.linhas = dados as unknown[][];
      this.aplicarCabecalhos();
      this.recalcPreview();
    } catch (err) {
      console.error('[Importar] parse erro', err);
      await this.toast('Arquivo inválido ou corrompido.', 'danger');
    }
  }

  private aplicarCabecalhos(): void {
    if (this.linhas.length === 0) {
      this.colunas = [];
      return;
    }
    const primeira = this.linhas[0] ?? [];
    const qtdCols = Math.max(...this.linhas.map(l => l.length));
    const headers: string[] = [];
    for (let i = 0; i < qtdCols; i++) {
      if (this.primeiraLinhaEhHeader) {
        headers.push((primeira[i] ?? '').toString().trim() || `Coluna ${i + 1}`);
      } else {
        headers.push(`Coluna ${i + 1}`);
      }
    }
    this.colunas = headers.map((h, i) => ({
      header: h,
      campo: this.detectarCampo(h, i),
    }));
  }

  private detectarCampo(header: string, idx: number): CampoJogador {
    const h = header.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (idx === 0 && !this.primeiraLinhaEhHeader) return 'nome';
    if (/^nome|^jogador|^atleta/.test(h)) return 'nome';
    if (/apelido|alcunha/.test(h)) return 'apelido';
    if (/posic|funcao/.test(h)) return 'posicao';
    if (/camisa|numero|^n[º°]?$|registro/.test(h)) return 'numeroCamisa';
    if (/doc|cpf|rg/.test(h)) return 'documento';
    if (/nasc|data/.test(h)) return 'dataNascimento';
    if (/telefone|fone|celular|whatsapp/.test(h)) return 'telefone';
    return 'ignorar';
  }

  private recalcPreview(): void {
    const linhasDados = this.primeiraLinhaEhHeader ? this.linhas.slice(1) : this.linhas;
    this.preview = linhasDados.map(l => this.mapearLinha(l));
  }

  private mapearLinha(linha: unknown[]): LinhaPreview {
    const dados: Record<string, string> = {};
    this.colunas.forEach((col, i) => {
      if (col.campo === 'ignorar') return;
      const raw = linha[i];
      const valor = this.normalizarCelula(col.campo, raw);
      if (valor) dados[col.campo] = valor;
    });
    if (!dados['nome'] || dados['nome'].trim().length < 2) {
      return {
        ok: false,
        motivo: 'Nome ausente ou muito curto',
        dados: {
          nome: (dados['nome'] || '').trim(),
          equipeId: this.equipe.id!,
        },
      };
    }
    // Constrói o payload apenas com os campos que têm valor.
    // Firestore NÃO aceita undefined em writeBatch.set — por isso
    // não usamos `campo: dados['x'] || undefined`.
    const payload: NovoJogadorInput = {
      nome: dados['nome'].trim(),
      equipeId: this.equipe.id!,
    };
    const apelido = dados['apelido']?.trim();
    if (apelido) payload.apelido = apelido;
    const posicao = dados['posicao']?.trim();
    if (posicao) payload.posicao = posicao;
    const numeroCamisa = dados['numeroCamisa']?.trim();
    if (numeroCamisa) payload.numeroCamisa = numeroCamisa;
    const documento = dados['documento']?.trim();
    if (documento) payload.documento = documento;
    const dataNascimento = dados['dataNascimento']?.trim();
    if (dataNascimento) payload.dataNascimento = dataNascimento;
    const telefone = dados['telefone']?.trim();
    if (telefone) payload.telefone = telefone;
    return { ok: true, dados: payload };
  }

  private normalizarCelula(campo: CampoJogador, raw: unknown): string {
    if (raw === null || raw === undefined) return '';
    if (campo === 'dataNascimento') {
      if (raw instanceof Date) {
        const yyyy = raw.getFullYear();
        const mm = String(raw.getMonth() + 1).padStart(2, '0');
        const dd = String(raw.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
      const txt = raw.toString().trim();
      // DD/MM/YYYY ou DD-MM-YYYY → YYYY-MM-DD
      const m = txt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (m) {
        const [_, d, mo, y] = m;
        const yyyy = y.length === 2 ? `20${y}` : y;
        return `${yyyy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
      return txt;
    }
    return raw.toString();
  }

  private pickFile(): Promise<File | null> {
    return new Promise<File | null>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const f = input.files?.[0] ?? null;
        if (document.body.contains(input)) document.body.removeChild(input);
        resolve(f);
      };
      window.addEventListener(
        'focus',
        () =>
          setTimeout(() => {
            if (document.body.contains(input)) {
              document.body.removeChild(input);
              resolve(null);
            }
          }, 1000),
        { once: true },
      );
      input.click();
    });
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'bottom',
      color,
    });
    await t.present();
  }
}
