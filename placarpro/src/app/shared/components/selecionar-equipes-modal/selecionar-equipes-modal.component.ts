import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { Grupo } from '../../../campeonatos/models/grupo.model';
import { Jogo } from '../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../campeonatos/jogos.service';

/**
 * Modal para selecionar mandante e visitante de uma partida, mostrando
 * apenas as equipes do grupo associado ao jogo (se houver grupoId).
 * Se o jogo não tiver grupo, lista todas as equipes da categoria.
 */
@Component({
  selector: 'app-selecionar-equipes-modal',
  templateUrl: './selecionar-equipes-modal.component.html',
  styleUrls: ['./selecionar-equipes-modal.component.scss'],
  standalone: false,
})
export class SelecionarEquipesModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogo!: Jogo;
  @Input() equipes: Equipe[] = [];
  @Input() grupos: Grupo[] = [];

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly jogosSrv = inject(JogosService);

  /** Snapshot dos IDs originais para detectar mudanças. */
  private mandanteIdOriginal = '';
  private visitanteIdOriginal = '';

  /** Marca se o usuário já viu (e aceitou) o aviso de zeragem nesta sessão.
   *  Evita perguntar a cada clique — pergunta na 1ª tentativa de alterar. */
  private zeragemConfirmada = false;

  /** Equipes disponíveis para escolha — filtradas pelo grupo do jogo. */
  equipesDisponiveis: Equipe[] = [];
  /** Nome do grupo (para exibir no header). */
  nomeGrupo = '';

  mandanteId = '';
  visitanteId = '';
  salvando = false;

  ngOnInit(): void {
    this.mandanteId = this.jogo?.mandanteId ?? '';
    this.visitanteId = this.jogo?.visitanteId ?? '';
    this.mandanteIdOriginal = this.mandanteId;
    this.visitanteIdOriginal = this.visitanteId;

    const grupoIdDoJogo = this.jogo?.grupoId;
    if (grupoIdDoJogo) {
      this.equipesDisponiveis = this.equipes.filter(e => e.grupoId === grupoIdDoJogo);
      this.nomeGrupo = this.grupos.find(g => g.id === grupoIdDoJogo)?.nome ?? '';
    } else {
      this.equipesDisponiveis = [...this.equipes];
      this.nomeGrupo = '';
    }
    // Ordena por nome
    this.equipesDisponiveis.sort((a, b) =>
      (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
    );
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async selecionarMandante(eq: Equipe): Promise<void> {
    if (!eq.id) return;
    if (eq.id === this.mandanteId) return; // já está selecionado
    // Se vai mudar de equipe e a partida tem resultado, pergunta antes
    if (!(await this.confirmarSeNecessario(eq.id, 'mandante'))) return;
    if (this.visitanteId === eq.id) {
      this.visitanteId = this.mandanteId;
    }
    this.mandanteId = eq.id;
  }

  async selecionarVisitante(eq: Equipe): Promise<void> {
    if (!eq.id) return;
    if (eq.id === this.visitanteId) return;
    if (!(await this.confirmarSeNecessario(eq.id, 'visitante'))) return;
    if (this.mandanteId === eq.id) {
      this.mandanteId = this.visitanteId;
    }
    this.visitanteId = eq.id;
  }

  /**
   * Se a partida tem resultado e o usuário está alterando uma equipe,
   * pede confirmação ANTES de aplicar a mudança. Pergunta uma única vez
   * por sessão do modal — depois disso, segue alterando sem perguntar.
   */
  private async confirmarSeNecessario(
    novaEquipeId: string,
    lado: 'mandante' | 'visitante',
  ): Promise<boolean> {
    if (!this.temResultado) return true;
    if (this.zeragemConfirmada) return true;
    // Verifica se a nova equipe é diferente da original deste lado
    const idOriginal =
      lado === 'mandante' ? this.mandanteIdOriginal : this.visitanteIdOriginal;
    if (novaEquipeId === idOriginal) return true;

    const aceitou = await this.confirmarZeragem();
    if (aceitou) {
      this.zeragemConfirmada = true;
    }
    return aceitou;
  }

  limpar(lado: 'mandante' | 'visitante'): void {
    if (lado === 'mandante') this.mandanteId = '';
    else this.visitanteId = '';
  }

  inverter(): void {
    const tmp = this.mandanteId;
    this.mandanteId = this.visitanteId;
    this.visitanteId = tmp;
  }

  get equipeMandante(): Equipe | undefined {
    return this.equipesDisponiveis.find(e => e.id === this.mandanteId);
  }

  get equipeVisitante(): Equipe | undefined {
    return this.equipesDisponiveis.find(e => e.id === this.visitanteId);
  }

  /** Verdadeiro se a partida tem placar ou já foi encerrada. */
  get temResultado(): boolean {
    if (!this.jogo) return false;
    return (
      this.jogo.golsMandante != null ||
      this.jogo.golsVisitante != null ||
      this.jogo.status === 'encerrado' ||
      this.jogo.status === 'em-andamento'
    );
  }

  /** Verdadeiro se o usuário mudou mandante ou visitante. */
  get equipesMudaram(): boolean {
    return (
      this.mandanteId !== this.mandanteIdOriginal ||
      this.visitanteId !== this.visitanteIdOriginal
    );
  }

  /** Placar atual formatado pra exibir no banner de aviso. */
  get placarFormatado(): string {
    const m = this.jogo?.golsMandante ?? 0;
    const v = this.jogo?.golsVisitante ?? 0;
    return `${m} × ${v}`;
  }

  async salvar(): Promise<void> {
    if (!this.jogo?.id) return;
    if (!this.mandanteId || !this.visitanteId) {
      await this.toast('Selecione mandante e visitante.', 'warning');
      return;
    }
    if (this.mandanteId === this.visitanteId) {
      await this.toast('As equipes precisam ser diferentes.', 'warning');
      return;
    }

    // Se há resultado lançado E as equipes foram alteradas, executa a zeragem.
    // A confirmação já foi mostrada no clique de seleção (zeragemConfirmada),
    // mas pede de novo aqui como fallback caso tenha sido pulada.
    if (this.temResultado && this.equipesMudaram) {
      if (!this.zeragemConfirmada) {
        const confirmado = await this.confirmarZeragem();
        if (!confirmado) return;
        this.zeragemConfirmada = true;
      }
      await this.salvarComZeragem();
      return;
    }

    // Caminho normal: só atualiza os IDs das equipes (sem mexer no placar).
    this.salvando = true;
    try {
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id!, {
        mandanteId: this.mandanteId,
        visitanteId: this.visitanteId,
      });
      await this.toast('Equipes atualizadas.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[SelecionarEquipes] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  /** Mostra alerta perguntando se o usuário quer zerar e prosseguir.
   *  Mensagem em TEXTO PURO — Ionic AlertController não renderiza HTML
   *  no campo `message` por padrão. */
  private async confirmarZeragem(): Promise<boolean> {
    return new Promise<boolean>(async resolve => {
      const alert = await this.alertCtrl.create({
        header: 'Trocar equipes desta partida?',
        message:
          `Esta partida já tem resultado lançado (${this.placarFormatado}).\n\n` +
          `Ao trocar as equipes, serão zerados:\n` +
          `• Placar (gols mandante e visitante)\n` +
          `• Lances registrados (gols, cartões, faltas)\n` +
          `• Status volta para "Agendado"`,
        buttons: [
          { text: 'Cancelar', role: 'cancel', handler: () => resolve(false) },
          {
            text: 'Trocar e zerar',
            role: 'destructive',
            handler: () => resolve(true),
          },
        ],
        cssClass: 'alerta-zerar-partida',
      });
      await alert.present();
    });
  }

  /** Aplica troca de equipes + zera placar/status/eventos do jogo. */
  private async salvarComZeragem(): Promise<void> {
    if (!this.jogo?.id) return;
    this.salvando = true;
    try {
      // 1. Limpa todos os eventos do jogo (gols, cartões, etc.)
      await this.jogosSrv.limparEventos(
        this.campeonatoId,
        this.categoriaId,
        this.jogo.id,
      );
      // 2. Atualiza equipes + zera placar/status
      await this.jogosSrv.atualizar(this.campeonatoId, this.categoriaId, this.jogo.id, {
        mandanteId: this.mandanteId,
        visitanteId: this.visitanteId,
        golsMandante: null,
        golsVisitante: null,
        status: 'agendado',
      });
      await this.toast('Equipes trocadas. Resultado zerado.', 'success');
      await this.modalCtrl.dismiss({ saved: true, zerado: true });
    } catch (err) {
      console.error('[SelecionarEquipes] zerar erro', err);
      await this.toast('Erro ao zerar partida.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  trackById(_i: number, e: Equipe): string {
    return e.id ?? '';
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
