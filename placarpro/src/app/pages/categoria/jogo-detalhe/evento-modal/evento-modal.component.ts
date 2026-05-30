import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import { EventoJogo, EventoTipo } from '../../../../campeonatos/models/jogo.model';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { StorageService } from '../../../../shared/storage.service';

interface TipoOpcao {
  value: EventoTipo;
  label: string;
  icon: string;
  classe: string;
}

interface MidiaPendente {
  /** Arquivo bruto que será enviado após salvar. */
  file: File;
  /** Preview URL (objectURL pra mostrar antes do upload). */
  preview: string;
  isVideo: boolean;
}

interface MidiaSalva {
  url: string;
  isVideo: boolean;
}

const TIPOS: TipoOpcao[] = [
  { value: 'gol', label: 'Gol', icon: 'football', classe: 't-gol' },
  { value: 'gol-contra', label: 'Gol contra', icon: 'football-outline', classe: 't-gol-contra' },
  { value: 'amarelo', label: 'Amarelo', icon: 'square', classe: 't-amarelo' },
  { value: 'vermelho', label: 'Vermelho', icon: 'square', classe: 't-vermelho' },
  { value: 'azul', label: 'Azul', icon: 'square', classe: 't-azul' },
  { value: 'falta', label: 'Falta', icon: 'hand-left-outline', classe: 't-falta' },
  { value: 'defesa', label: 'Defesa', icon: 'hand-right-outline', classe: 't-defesa' },
  { value: 'sub-entrou', label: 'Entrou', icon: 'arrow-up-outline', classe: 't-sub' },
  { value: 'sub-saiu', label: 'Saiu', icon: 'arrow-down-outline', classe: 't-sub' },
];

/** Tipos que permitem registrar múltiplas ocorrências de uma vez.
 *  Apenas "gol" — cartões, faltas, etc. precisam de um lance individual cada.
 */
const TIPOS_COM_QUANTIDADE: EventoTipo[] = ['gol'];
const TIPOS_COM_ASSISTENCIA: EventoTipo[] = ['gol'];
const QUANTIDADES = [1, 2, 3, 4, 5];

@Component({
  selector: 'app-evento-modal',
  templateUrl: './evento-modal.component.html',
  styleUrls: ['./evento-modal.component.scss'],
  standalone: false,
})
export class EventoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  @Input() mandante!: Equipe;
  @Input() visitante!: Equipe;
  @Input() eventoExistente?: EventoJogo;
  @Input() ladoPadrao: 'mandante' | 'visitante' = 'mandante';
  @Input() tipoPadrao: EventoTipo = 'gol';
  /** Quando true, esconde o card do OUTRO time e mostra só o
   *  `ladoPadrao` em destaque (não-clicável). Usado quando o lance é
   *  iniciado a partir do botão de ação de UM time específico (Quick
   *  Actions), onde a escolha de equipe já está implícita. */
  @Input() bloquearEquipe = false;
  /** Minuto sugerido pelo cronômetro da partida (auto-preenche o campo
   *  + ativa o toggle "definir tempo"). Setado pelo editor de partida. */
  @Input() minutoSugerido?: number | null;
  /** Tempo/período atual da partida (1ºT, 2ºT, prorrogação, pênaltis).
   *  Auto-anexado ao evento criado quando passado — não tem campo visível
   *  no form (é metadado automático). */
  @Input() tempoSugerido?: import('../../../../campeonatos/models/jogo.model').TempoJogoNome;

  private readonly fb = inject(FormBuilder);
  private readonly jogosSrv = inject(JogosService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly storageSrv = inject(StorageService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);

  readonly tipos = TIPOS;
  readonly quantidades = QUANTIDADES;
  salvando = false;
  definirTempo = false;
  /** Estado da confirmação inline de remover (fallback caso o alert não
   *  apareça por z-index sobre o modal). Primeiro clique no trash arma,
   *  segundo clique dentro de 3s efetiva a remoção. */
  confirmandoRemover = false;
  private confirmRemoverTimer?: ReturnType<typeof setTimeout>;

  midiasPendentes: MidiaPendente[] = [];
  midiasSalvas: MidiaSalva[] = [];

  readonly form: FormGroup = this.fb.nonNullable.group({
    tipo: ['gol' as EventoTipo, Validators.required],
    equipeId: ['', Validators.required],
    jogadorId: [''],
    assistenteId: [''],
    quantidade: [1],
    minuto: [null as number | null],
    observacao: [''],
  });

  jogadores$: Observable<Jogador[]> = of([]);

  ngOnInit(): void {
    if (this.eventoExistente) {
      this.form.patchValue({
        tipo: this.eventoExistente.tipo,
        equipeId: this.eventoExistente.equipeId,
        jogadorId: this.eventoExistente.jogadorId ?? '',
        assistenteId: this.eventoExistente.assistenteId ?? '',
        quantidade: this.eventoExistente.quantidade ?? 1,
        minuto: this.eventoExistente.minuto ?? null,
        observacao: this.eventoExistente.observacao ?? '',
      });
      this.definirTempo = this.eventoExistente.minuto != null;
      this.midiasSalvas = (this.eventoExistente.midiaUrls ?? []).map(url => ({
        url,
        isVideo: this.urlEhVideo(url),
      }));
    } else {
      const eqId =
        this.ladoPadrao === 'mandante' ? this.mandante.id : this.visitante.id;
      this.form.patchValue({
        tipo: this.tipoPadrao,
        equipeId: eqId ?? '',
        // Pré-preenche o minuto com o tempo do cronômetro do jogo
        minuto: this.minutoSugerido ?? null,
      });
      // Se o cronômetro sugeriu um minuto, ativa o toggle pra mostrar o campo.
      if (this.minutoSugerido != null) {
        this.definirTempo = true;
      }
    }
    this.atualizarJogadores(this.form.value.equipeId);
    this.form.get('equipeId')!.valueChanges.subscribe(eqId => {
      this.atualizarJogadores(eqId);
      this.form.patchValue(
        { jogadorId: '', assistenteId: '' },
        { emitEvent: false },
      );
    });
  }

  // ── Getters condicionais ───────────────────────────────────
  get tipoAtual(): EventoTipo {
    return this.form.value.tipo as EventoTipo;
  }
  get mostraQuantidade(): boolean {
    return TIPOS_COM_QUANTIDADE.includes(this.tipoAtual);
  }
  get mostraAssistencia(): boolean {
    return TIPOS_COM_ASSISTENCIA.includes(this.tipoAtual);
  }
  get totalMidias(): number {
    return this.midiasPendentes.length + this.midiasSalvas.length;
  }

  get titulo(): string {
    return this.eventoExistente ? 'Editar lance' : 'Adicionar lance';
  }

  // ── Ações UI ───────────────────────────────────────────────
  selecionarTipo(tipo: EventoTipo): void {
    this.form.patchValue({ tipo });
    // Se sair de gol/gol-contra, reseta quantidade
    if (!TIPOS_COM_QUANTIDADE.includes(tipo)) {
      this.form.patchValue({ quantidade: 1 });
    }
    if (!TIPOS_COM_ASSISTENCIA.includes(tipo)) {
      this.form.patchValue({ assistenteId: '' });
    }
  }

  selecionarEquipe(id?: string): void {
    if (!id) return;
    this.form.patchValue({ equipeId: id });
  }

  equipeSelecionada(id?: string): boolean {
    return !!id && this.form.value.equipeId === id;
  }

  selecionarQuantidade(qtd: number): void {
    this.form.patchValue({ quantidade: qtd });
  }

  toggleTempo(): void {
    this.definirTempo = !this.definirTempo;
    if (!this.definirTempo) this.form.patchValue({ minuto: null });
  }

  async selecionarMidia(): Promise<void> {
    const files = await this.pickFiles();
    if (files.length === 0) return;
    for (const f of files) {
      if (f.size > 20 * 1024 * 1024) {
        await this.toast(`${f.name} excede 20MB.`, 'warning');
        continue;
      }
      this.midiasPendentes.push({
        file: f,
        preview: URL.createObjectURL(f),
        isVideo: f.type.startsWith('video/'),
      });
    }
  }

  removerMidiaPendente(i: number): void {
    const m = this.midiasPendentes[i];
    if (m) URL.revokeObjectURL(m.preview);
    this.midiasPendentes.splice(i, 1);
  }

  async removerMidiaSalva(i: number): Promise<void> {
    const m = this.midiasSalvas[i];
    if (!m) return;
    const confirm = await this.alertCtrl.create({
      header: 'Remover mídia?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: () => {
            this.midiasSalvas.splice(i, 1);
          },
        },
      ],
    });
    await confirm.present();
  }

  dismiss(): Promise<boolean> {
    this.midiasPendentes.forEach(m => URL.revokeObjectURL(m.preview));
    if (this.confirmRemoverTimer) clearTimeout(this.confirmRemoverTimer);
    return this.modalCtrl.dismiss();
  }

  // ── Save / Remove ──────────────────────────────────────────
  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Selecione tipo e equipe.', 'warning');
      return;
    }
    const v = this.form.getRawValue();
    const minutoNum =
      this.definirTempo && v.minuto != null && v.minuto !== ('' as unknown)
        ? Number(v.minuto)
        : undefined;

    // Quantidade > 1 → cria N eventos separados (1 card por gol).
    // Só vale para NOVO evento. Edição mantém o existente e não duplica.
    const quantidadeNum =
      this.mostraQuantidade && v.quantidade > 1 ? Number(v.quantidade) : 1;
    const ehNovoLote = !this.eventoExistente && quantidadeNum > 1;

    // Tempo (período) da partida — pega do evento existente (em edição) ou
    // do tempo sugerido pelo painel ao vivo (em criação durante o jogo).
    // Quando ausente em ambos, fica indefinido (fluxo antigo, sem período).
    const tempoFinal = this.eventoExistente?.tempo ?? this.tempoSugerido;

    // Payload base — SEM o campo `quantidade` (vamos criar N eventos).
    const payloadBase: Omit<EventoJogo, 'id' | 'criadoEm'> = {
      tipo: v.tipo,
      equipeId: v.equipeId,
      ...(v.jogadorId ? { jogadorId: v.jogadorId } : {}),
      ...(this.mostraAssistencia && v.assistenteId
        ? { assistenteId: v.assistenteId }
        : {}),
      ...(minutoNum != null ? { minuto: minutoNum } : {}),
      ...(tempoFinal ? { tempo: tempoFinal } : {}),
      ...(v.observacao?.trim() ? { observacao: v.observacao.trim() } : {}),
      ...(this.midiasSalvas.length > 0
        ? { midiaUrls: this.midiasSalvas.map(m => m.url) }
        : {}),
    };

    this.salvando = true;
    const loader = await this.loadingCtrl.create({
      message: ehNovoLote
        ? `Salvando ${quantidadeNum} lances...`
        : this.midiasPendentes.length > 0
          ? `Enviando ${this.midiasPendentes.length} mídia(s)...`
          : 'Salvando lance...',
    });
    await loader.present();

    try {
      let eventoId = this.eventoExistente?.id;
      if (eventoId) {
        // Edição: mantém o mesmo evento (sem duplicar). Se o usuário mudou
        // quantidade na edição, preserva no campo (não dá pra "expandir" depois).
        const payloadEdicao: Omit<EventoJogo, 'id' | 'criadoEm'> = {
          ...payloadBase,
          ...(quantidadeNum > 1 ? { quantidade: quantidadeNum } : {}),
        };
        await this.jogosSrv.atualizarEvento(
          this.campeonatoId,
          this.categoriaId,
          this.jogoId,
          eventoId,
          payloadEdicao,
        );
      } else if (ehNovoLote) {
        // Novo + quantidade > 1: cria N eventos separados, um por gol.
        for (let i = 0; i < quantidadeNum; i++) {
          const id = await this.jogosSrv.adicionarEvento(
            this.campeonatoId,
            this.categoriaId,
            this.jogoId,
            payloadBase,
          );
          if (i === quantidadeNum - 1) eventoId = id; // usa o último p/ anexar mídias
        }
      } else {
        eventoId = await this.jogosSrv.adicionarEvento(
          this.campeonatoId,
          this.categoriaId,
          this.jogoId,
          payloadBase,
        );
      }

      // Upload das mídias pendentes (após ter eventoId)
      if (this.midiasPendentes.length > 0 && eventoId) {
        const novasUrls: string[] = [];
        for (const m of this.midiasPendentes) {
          try {
            const url = await this.storageSrv.uploadEventoMidia(
              this.campeonatoId,
              this.categoriaId,
              this.jogoId,
              eventoId,
              m.file,
            );
            novasUrls.push(url);
          } catch (err) {
            console.error('[Evento] upload midia erro', err);
          }
        }
        if (novasUrls.length > 0) {
          const todas = [...this.midiasSalvas.map(m => m.url), ...novasUrls];
          await this.jogosSrv.atualizarEvento(
            this.campeonatoId,
            this.categoriaId,
            this.jogoId,
            eventoId,
            { midiaUrls: todas },
          );
        }
        this.midiasPendentes.forEach(m => URL.revokeObjectURL(m.preview));
      }

      await this.toast('Lance salvo.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Evento] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
      await loader.dismiss();
    }
  }

  /**
   * Fluxo de confirmação inline (não usa AlertController pra evitar
   * problemas de z-index com alert aparecendo atrás do modal):
   *  - 1º clique: arma o estado `confirmandoRemover` (botão vira "Confirmar")
   *  - 2º clique dentro de 3s: efetiva a remoção
   *  - Sem 2º clique: timer auto-cancela o estado
   */
  async confirmarRemover(): Promise<void> {
    if (!this.eventoExistente?.id || this.salvando) return;
    if (this.confirmandoRemover) {
      // 2º clique — efetiva
      if (this.confirmRemoverTimer) clearTimeout(this.confirmRemoverTimer);
      this.confirmandoRemover = false;
      await this.remover();
      return;
    }
    // 1º clique — arma
    this.confirmandoRemover = true;
    if (this.confirmRemoverTimer) clearTimeout(this.confirmRemoverTimer);
    this.confirmRemoverTimer = setTimeout(() => {
      this.confirmandoRemover = false;
    }, 3000);
  }

  /**
   * Remove o evento da partida. O `removerEvento` do service trata o
   * recalcularPlacar com try/catch interno — então se chegar erro aqui,
   * é falha REAL no delete (Firestore Rules, rede, etc.). Mostra mensagem
   * descritiva no toast pra ajudar a diagnosticar.
   */
  async remover(): Promise<void> {
    if (!this.eventoExistente?.id) return;
    this.salvando = true;
    try {
      await this.jogosSrv.removerEvento(
        this.campeonatoId,
        this.categoriaId,
        this.jogoId,
        this.eventoExistente.id,
      );
      await this.modalCtrl.dismiss({ removed: true });
    } catch (err: unknown) {
      console.error('[Evento] remover erro', err);
      const msg = this.extrairMensagemErro(err);
      await this.toast(`Erro ao remover: ${msg}`, 'danger');
    } finally {
      this.salvando = false;
    }
  }

  /** Extrai mensagem amigável de qualquer erro (FirebaseError, Error, etc). */
  private extrairMensagemErro(err: unknown): string {
    if (!err) return 'desconhecido';
    const anyErr = err as { code?: string; message?: string };
    if (anyErr.code === 'permission-denied') {
      return 'sem permissão (verifique se você é o dono do campeonato).';
    }
    if (anyErr.code === 'unavailable') {
      return 'serviço indisponível. Verifique sua conexão.';
    }
    if (anyErr.message) return anyErr.message;
    return String(err);
  }

  // ── Helpers ────────────────────────────────────────────────
  private atualizarJogadores(equipeId: string): void {
    if (!equipeId) {
      this.jogadores$ = of([]);
      return;
    }
    this.jogadores$ = this.jogadoresSrv
      .listPorEquipe$(this.campeonatoId, this.categoriaId, equipeId)
      .pipe(
        startWith<Jogador[]>([]),
        catchError(() => of<Jogador[]>([])),
      );
  }

  private pickFiles(): Promise<File[]> {
    return new Promise<File[]>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const files = input.files ? Array.from(input.files) : [];
        if (document.body.contains(input)) document.body.removeChild(input);
        resolve(files);
      };
      window.addEventListener(
        'focus',
        () =>
          setTimeout(() => {
            if (document.body.contains(input)) {
              document.body.removeChild(input);
              resolve([]);
            }
          }, 1000),
        { once: true },
      );
      input.click();
    });
  }

  private urlEhVideo(url: string): boolean {
    return /\.(mp4|webm|mov|avi)(\?|$)/i.test(url);
  }

  trackByTipo(_i: number, t: TipoOpcao): string {
    return t.value;
  }
  trackById(_i: number, j: Jogador): string {
    return j.id ?? '';
  }
  trackByIndex(i: number): number {
    return i;
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
      color,
    });
    await t.present();
  }
}
