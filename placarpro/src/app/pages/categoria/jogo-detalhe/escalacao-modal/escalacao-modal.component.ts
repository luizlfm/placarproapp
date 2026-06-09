import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';

/**
 * Modal de Escalação.
 *
 * Fluxo (refatorado):
 *  • Convocados = todo jogador que entra na partida (titulares + reservas).
 *    NÃO tem limite — o teto é o tamanho do plantel da equipe.
 *  • Titulares = subconjunto que começa em campo. Limitado a `limite`
 *    (jogadoresPorPartida da categoria; 0 = sem limite).
 *  • Reservas = convocados que NÃO são titulares. Disponíveis pra
 *    substituição durante a transmissão.
 *
 * UI:
 *  • Checkbox à esquerda na linha → convoca/desconvoca.
 *  • Estrela à direita → promove o convocado a titular (respeitando o limite).
 *  • Desconvocar tira da titularidade automaticamente.
 */
@Component({
  selector: 'app-escalacao-modal',
  templateUrl: './escalacao-modal.component.html',
  styleUrls: ['./escalacao-modal.component.scss'],
  standalone: false,
})
export class EscalacaoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogoId = '';
  @Input() equipeId = '';
  @Input() equipeNome = '';
  /** URL do escudo da equipe (opcional — buscado pelo equipeId se vier vazio) */
  @Input() equipeLogoUrl = '';
  /** Máximo de TITULARES por partida (0 = sem limite). Reservas não têm teto. */
  @Input() limite = 0;

  private readonly jogosSrv = inject(JogosService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  jogadores: Jogador[] = [];
  /** IDs dos jogadores convocados pra partida (titulares + reservas). */
  convocados = new Set<string>();
  /** IDs dos titulares (subconjunto de `convocados`, máx `limite`). */
  titulares = new Set<string>();
  carregando = true;
  salvando = false;

  /** Texto de busca para filtrar a lista. */
  filtro = '';

  async ngOnInit(): Promise<void> {
    try {
      const [jogadores, escalacao] = await Promise.all([
        firstValueFrom(
          this.jogadoresSrv.listPorEquipe$(this.campeonatoId, this.categoriaId, this.equipeId),
        ),
        firstValueFrom(
          this.jogosSrv.escalacaoCompleta$(
            this.campeonatoId,
            this.categoriaId,
            this.jogoId,
            this.equipeId,
          ),
        ),
      ]);
      // Ordena por nome (estável em pt-BR)
      this.jogadores = [...jogadores].sort((a, b) =>
        (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
      );
      this.convocados = new Set(escalacao.jogadorIds);
      // Migração de docs antigos: se ninguém marcado como titular E há
      // convocados, considera os N primeiros (até o limite) como titulares
      // por padrão. Mantém retrocompatibilidade pra escalações já gravadas.
      if (escalacao.titularIds.length > 0) {
        this.titulares = new Set(
          escalacao.titularIds.filter(id => this.convocados.has(id)),
        );
      } else if (this.convocados.size > 0 && this.limite > 0) {
        // Sem titulares definidos: pega os N primeiros convocados (ordem do
        // plantel, que é por nome). User pode reescolher antes de salvar.
        const ordemConvocados = this.jogadores
          .map(j => j.id!)
          .filter(id => id && this.convocados.has(id));
        this.titulares = new Set(ordemConvocados.slice(0, this.limite));
      } else {
        this.titulares = new Set();
      }
      // Se equipeNome veio vazio (ou logoUrl), busca pela equipeId
      if ((!this.equipeNome || !this.equipeLogoUrl) && this.equipeId) {
        try {
          const eq = await firstValueFrom(
            this.equipesSrv.get$(this.campeonatoId, this.categoriaId, this.equipeId),
          );
          if (eq) {
            if (!this.equipeNome) this.equipeNome = eq.nome ?? '';
            if (!this.equipeLogoUrl) this.equipeLogoUrl = eq.logoUrl ?? '';
          }
        } catch {
          /* ignora — vai mostrar fallback */
        }
      }
    } catch (err) {
      console.error('[EscalacaoModal] carregar', err);
    } finally {
      this.carregando = false;
    }
  }

  /** Lista filtrada por nome/apelido/posição/número. */
  get jogadoresFiltrados(): Jogador[] {
    const t = this.filtro.trim().toLowerCase();
    if (!t) return this.jogadores;
    return this.jogadores.filter(
      j =>
        j.nome.toLowerCase().includes(t) ||
        (j.apelido ?? '').toLowerCase().includes(t) ||
        (j.posicao ?? '').toLowerCase().includes(t) ||
        (j.numeroCamisa ?? '').toLowerCase().includes(t),
    );
  }

  /** Quantos titulares estão marcados agora (pra header/footer). */
  get qtdTitulares(): number {
    return this.titulares.size;
  }

  /** Quantos reservas estão marcados agora (convocado e não-titular). */
  get qtdReservas(): number {
    let n = 0;
    for (const id of this.convocados) if (!this.titulares.has(id)) n++;
    return n;
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** Convoca (ou desconvoca) — toggle do checkbox da linha. */
  toggleConvocar(jogadorId: string): void {
    if (this.convocados.has(jogadorId)) {
      // Desconvocar: remove da convocação E da titularidade.
      this.convocados.delete(jogadorId);
      this.titulares.delete(jogadorId);
      return;
    }
    this.convocados.add(jogadorId);
    // Se ainda há vaga de titular E nenhum titular foi marcado ainda,
    // entra direto como titular pra acelerar a escalação. Caso contrário,
    // entra como reserva.
    if (this.limite > 0 && this.titulares.size < this.limite) {
      // NÃO promove automaticamente — deixa o user decidir clicando na estrela.
      // (Comportamento antigo: titularizava automaticamente — confundia user.)
    }
  }

  /** Marca/desmarca um convocado como titular (estrela). */
  toggleTitular(jogadorId: string, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.convocados.has(jogadorId)) return; // só convocados viram titulares
    if (this.titulares.has(jogadorId)) {
      this.titulares.delete(jogadorId);
      return;
    }
    if (this.limite > 0 && this.titulares.size >= this.limite) {
      void this.toast(`Limite de ${this.limite} titulares atingido. Tire um titular antes.`, 'warning');
      return;
    }
    this.titulares.add(jogadorId);
  }

  estaConvocado(jogadorId: string): boolean {
    return this.convocados.has(jogadorId);
  }

  ehTitular(jogadorId: string): boolean {
    return this.titulares.has(jogadorId);
  }

  /** Convoca todo o plantel (sem mexer em titulares, que ficam até o limite). */
  selecionarTodos(): void {
    const ids = this.jogadores.map(j => j.id!).filter(Boolean);
    this.convocados = new Set(ids);
    // Se o user nunca marcou titulares, preenche até o limite na ordem.
    if (this.titulares.size === 0 && this.limite > 0) {
      this.titulares = new Set(ids.slice(0, this.limite));
    }
  }

  limpar(): void {
    this.convocados.clear();
    this.titulares.clear();
  }

  async salvar(): Promise<void> {
    this.salvando = true;
    try {
      await this.jogosSrv.salvarEscalacao(
        this.campeonatoId,
        this.categoriaId,
        this.jogoId,
        this.equipeId,
        Array.from(this.convocados),
        Array.from(this.titulares),
      );
      await this.toast(
        `Escalação salva (${this.qtdTitulares} titulares · ${this.qtdReservas} reservas).`,
        'success',
      );
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[EscalacaoModal] salvar', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  trackById(_i: number, j: Jogador): string {
    return j.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'top', color });
    await t.present();
  }
}
