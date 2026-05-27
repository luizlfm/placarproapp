import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { startWith, catchError } from 'rxjs/operators';
import { ArbitroJogo, FuncaoArbitro, Jogo } from '../../../campeonatos/models/jogo.model';
import { Arbitro } from '../../../users/models/arbitro.model';
import { UsersService } from '../../../users/users.service';
import { JogosService } from '../../../campeonatos/jogos.service';

interface FuncaoOpcao {
  value: FuncaoArbitro;
  label: string;
}

const FUNCOES: FuncaoOpcao[] = [
  { value: 'principal', label: 'Árbitro principal' },
  { value: 'auxiliar-1', label: 'Assistente 1' },
  { value: 'auxiliar-2', label: 'Assistente 2' },
  { value: 'quarto-arbitro', label: '4º árbitro' },
  { value: 'mesario', label: 'Mesário' },
  { value: 'cronometrista', label: 'Cronometrista' },
];

/**
 * Modal para vincular árbitros cadastrados (Arbitragem) a um jogo específico
 * com sua respectiva função (principal / assistente / etc.). Mantém uma lista
 * pequena (até 6) no campo `jogo.arbitros`.
 */
@Component({
  selector: 'app-arbitragem-jogo-modal',
  templateUrl: './arbitragem-jogo-modal.component.html',
  styleUrls: ['./arbitragem-jogo-modal.component.scss'],
  standalone: false,
})
export class ArbitragemJogoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogo!: Jogo;

  private readonly usersSrv = inject(UsersService);
  private readonly jogosSrv = inject(JogosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  readonly funcoes = FUNCOES;
  readonly arbitrosDisponiveis$: Observable<Arbitro[]> = this.usersSrv.arbitros$().pipe(
    startWith<Arbitro[]>([]),
    catchError(err => {
      console.error('[ArbitragemJogo] arbitros$', err);
      return of<Arbitro[]>([]);
    }),
  );

  /** Lista atual de árbitros do jogo (edição local). */
  selecionados: ArbitroJogo[] = [];
  salvando = false;

  ngOnInit(): void {
    this.selecionados = [...(this.jogo.arbitros ?? [])];
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** Verifica se um árbitro cadastrado já está selecionado. */
  jaSelecionado(arbitroId: string): boolean {
    return this.selecionados.some(s => s.arbitroId === arbitroId);
  }

  /** Adiciona um árbitro cadastrado à lista do jogo. */
  adicionarArbitro(a: Arbitro): void {
    if (!a.id || this.jaSelecionado(a.id)) return;
    // Default: se ainda não tem principal, marca esse como principal
    const temPrincipal = this.selecionados.some(s => s.funcao === 'principal');
    const funcao: FuncaoArbitro = temPrincipal ? 'auxiliar-1' : 'principal';
    this.selecionados = [
      ...this.selecionados,
      { arbitroId: a.id, nome: a.nome, funcao },
    ];
  }

  /** Adiciona manualmente um árbitro digitando o nome (sem cadastro prévio). */
  async adicionarManual(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Adicionar árbitro',
      message: 'Digite o nome do árbitro (não cadastrado).',
      inputs: [{ name: 'nome', type: 'text', placeholder: 'Nome' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          handler: (data: { nome?: string }) => {
            const nome = (data.nome ?? '').trim();
            if (nome.length < 2) return false;
            const temPrincipal = this.selecionados.some(s => s.funcao === 'principal');
            this.selecionados = [
              ...this.selecionados,
              { nome, funcao: temPrincipal ? 'auxiliar-1' : 'principal' },
            ];
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Remove um árbitro da lista. */
  remover(i: number): void {
    this.selecionados = this.selecionados.filter((_, idx) => idx !== i);
  }

  /** Altera a função (principal/auxiliar/etc.) de um árbitro. */
  trocarFuncao(i: number, valor: string): void {
    const novo = [...this.selecionados];
    novo[i] = { ...novo[i], funcao: valor as FuncaoArbitro };
    this.selecionados = novo;
  }

  rotuloFuncao(f: FuncaoArbitro): string {
    return FUNCOES.find(x => x.value === f)?.label ?? f;
  }

  trackById(_i: number, a: Arbitro): string {
    return a.id ?? '';
  }

  trackByIdx(i: number): number {
    return i;
  }

  async salvar(): Promise<void> {
    if (!this.jogo?.id) return;
    this.salvando = true;
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id, {
        arbitros: this.selecionados,
      });
      await this.toast('Arbitragem salva.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[ArbitragemJogo] salvar', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
