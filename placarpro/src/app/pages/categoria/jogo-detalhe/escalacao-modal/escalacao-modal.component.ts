import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Jogador } from '../../../../campeonatos/models/jogador.model';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { JogadoresService } from '../../../../campeonatos/jogadores.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';

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

  private readonly jogosSrv = inject(JogosService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  jogadores: Jogador[] = [];
  selecionados = new Set<string>();
  carregando = true;
  salvando = false;

  /** Texto de busca para filtrar a lista. */
  filtro = '';

  async ngOnInit(): Promise<void> {
    try {
      const [jogadores, ids] = await Promise.all([
        firstValueFrom(
          this.jogadoresSrv.listPorEquipe$(this.campeonatoId, this.categoriaId, this.equipeId),
        ),
        firstValueFrom(
          this.jogosSrv.escalacao$(
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
      this.selecionados = new Set(ids);
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

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  toggle(jogadorId: string): void {
    if (this.selecionados.has(jogadorId)) this.selecionados.delete(jogadorId);
    else this.selecionados.add(jogadorId);
  }

  estaSelecionado(jogadorId: string): boolean {
    return this.selecionados.has(jogadorId);
  }

  selecionarTodos(): void {
    this.selecionados = new Set(this.jogadores.map(j => j.id!).filter(Boolean));
  }

  limpar(): void {
    this.selecionados.clear();
  }

  async salvar(): Promise<void> {
    this.salvando = true;
    try {
      await this.jogosSrv.salvarEscalacao(
        this.campeonatoId,
        this.categoriaId,
        this.jogoId,
        this.equipeId,
        Array.from(this.selecionados),
      );
      await this.toast('Escalação salva.', 'success');
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

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'top', color });
    await t.present();
  }
}
