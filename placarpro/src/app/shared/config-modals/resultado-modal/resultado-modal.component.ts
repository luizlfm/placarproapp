import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { Equipe } from '../../../campeonatos/models/equipe.model';
import { ResultadoFinalEquipe } from '../../../campeonatos/categoria.model';

interface LinhaResultado {
  equipe: Equipe;
  posicao: number;
  titulo?: string;
}

/**
 * Modal "Resultado do campeonato": permite ao organizador declarar
 * manualmente a classificação final das equipes (campeão, vice, 3º, ...).
 *
 * Diferente da classificação calculada (`ClassificacaoService`), este
 * resultado é DECLARATIVO — usado quando o campeonato tem mata-mata
 * (eliminatórias) e o ranking automático por pontos não reflete o
 * resultado real da final.
 *
 * Reordenação por setas ↑/↓ (mais simples que drag-and-drop pra mobile).
 */
@Component({
  selector: 'app-resultado-modal',
  templateUrl: './resultado-modal.component.html',
  styleUrls: ['./resultado-modal.component.scss'],
  standalone: false,
})
export class ResultadoModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly catSrv = inject(CategoriasService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  /** Linhas ordenadas pela posição declarada (1º na frente). */
  linhas: LinhaResultado[] = [];
  loading = true;
  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId || !this.categoriaId) return;
    try {
      const [cat, equipes] = await Promise.all([
        firstValueFrom(this.catSrv.get$(this.campeonatoId, this.categoriaId)),
        firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
      ]);
      const salvas: ResultadoFinalEquipe[] = cat?.resultadoFinal ?? [];

      // Mapa equipeId → posição salva (se houver)
      const posSalva = new Map<string, number>();
      const tituloSalvo = new Map<string, string | undefined>();
      for (const r of salvas) {
        posSalva.set(r.equipeId, r.posicao);
        tituloSalvo.set(r.equipeId, r.titulo);
      }

      // Equipes com resultado salvo (ordenadas pela posição) + equipes sem (no fim).
      const comResultado: LinhaResultado[] = [];
      const semResultado: LinhaResultado[] = [];
      for (const eq of equipes) {
        if (!eq.id) continue;
        if (posSalva.has(eq.id)) {
          comResultado.push({
            equipe: eq,
            posicao: posSalva.get(eq.id)!,
            titulo: tituloSalvo.get(eq.id),
          });
        } else {
          semResultado.push({ equipe: eq, posicao: 0 });
        }
      }
      comResultado.sort((a, b) => a.posicao - b.posicao);
      // Reatribui posições contínuas 1..n + concatena equipes sem resultado no fim.
      semResultado.forEach((l, i) => { l.posicao = comResultado.length + i + 1; });
      this.linhas = [...comResultado, ...semResultado];
      this.normalizarPosicoes();
    } catch (err) {
      console.warn('[Resultado] load erro', err);
    } finally {
      this.loading = false;
    }
  }

  /** Reatribui posições 1..n na ordem atual do array. */
  private normalizarPosicoes(): void {
    this.linhas.forEach((l, i) => { l.posicao = i + 1; });
  }

  /** Sobe a equipe uma posição (troca com a anterior). */
  subir(idx: number): void {
    if (idx <= 0) return;
    [this.linhas[idx - 1], this.linhas[idx]] = [this.linhas[idx], this.linhas[idx - 1]];
    this.normalizarPosicoes();
  }

  /** Desce a equipe uma posição (troca com a próxima). */
  descer(idx: number): void {
    if (idx >= this.linhas.length - 1) return;
    [this.linhas[idx + 1], this.linhas[idx]] = [this.linhas[idx], this.linhas[idx + 1]];
    this.normalizarPosicoes();
  }

  setTitulo(idx: number, v: string): void {
    if (this.linhas[idx]) {
      this.linhas[idx] = { ...this.linhas[idx], titulo: v };
    }
  }

  /** Limpa todos os resultados (volta a "não definido"). */
  async limparTudo(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Limpar resultado?',
      message: 'Todas as posições serão removidas. Você poderá reordenar depois.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Limpar',
          role: 'destructive',
          handler: async () => {
            try {
              await this.catSrv.atualizar(this.campeonatoId, this.categoriaId, { resultadoFinal: [] });
              await this.modalCtrl.dismiss({ saved: true });
            } catch (err) {
              console.error('[Resultado] limpar erro', err);
              await this.toast('Falha ao limpar.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async salvar(): Promise<void> {
    this.normalizarPosicoes();
    const payload: ResultadoFinalEquipe[] = this.linhas.map(l => {
      const out: ResultadoFinalEquipe = { equipeId: l.equipe.id!, posicao: l.posicao };
      if (l.titulo?.trim()) out.titulo = l.titulo.trim();
      return out;
    });
    this.salvando = true;
    try {
      await this.catSrv.atualizar(this.campeonatoId, this.categoriaId, { resultadoFinal: payload });
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[Resultado] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** Medalha emoji pras 3 primeiras posições. */
  medalhaEmoji(pos: number): string {
    if (pos === 1) return '🥇';
    if (pos === 2) return '🥈';
    if (pos === 3) return '🥉';
    return '';
  }

  /** Classe CSS por posição (pra fundo gradiente das medalhas). */
  classePosicao(pos: number): string {
    if (pos === 1) return 'pos-ouro';
    if (pos === 2) return 'pos-prata';
    if (pos === 3) return 'pos-bronze';
    return '';
  }

  trackByEquipe(_i: number, l: LinhaResultado): string {
    return l.equipe.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
