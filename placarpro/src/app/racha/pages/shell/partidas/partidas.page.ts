import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AlertController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { RachaPartida } from '../../../models/racha.model';

/**
 * Página PARTIDAS — lista, cria e remove partidas do racha.
 *
 * Cada partida vira um doc em `rachas/{id}/partidas/{partidaId}` com gols
 * de cada time + status (rascunho|finalizada). Eventos individuais (gol,
 * assist, cartão) ficam na subcoleção `eventos` da partida — registrados
 * via tela Ao Vivo (futuro) ou diretamente.
 */
@Component({
  selector: 'app-racha-partidas',
  templateUrl: './partidas.page.html',
  styleUrls: ['./partidas.page.scss'],
  standalone: false,
})
export class RachaPartidasPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  rachaId = '';
  loading = true;
  partidas: RachaPartida[] = [];
  filtroAtivo: 'todas' | 'rascunho' | 'finalizadas' = 'todas';
  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) return;
    this.sub = this.rachaSrv.listPartidas$(this.rachaId).subscribe(lista => {
      this.partidas = lista;
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Partidas filtradas conforme `filtroAtivo`. */
  get partidasFiltradas(): RachaPartida[] {
    if (this.filtroAtivo === 'todas') return this.partidas;
    if (this.filtroAtivo === 'rascunho') {
      return this.partidas.filter(p => (p.status ?? 'rascunho') === 'rascunho');
    }
    return this.partidas.filter(p => p.status === 'finalizada');
  }

  /** Contadores pra mostrar nos chips de filtro. */
  get contagem() {
    return {
      todas: this.partidas.length,
      rascunho: this.partidas.filter(p => (p.status ?? 'rascunho') === 'rascunho').length,
      finalizadas: this.partidas.filter(p => p.status === 'finalizada').length,
    };
  }

  selecionarFiltro(f: 'todas' | 'rascunho' | 'finalizadas'): void {
    this.filtroAtivo = f;
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  irSorteio(): void {
    this.router.navigate(['/racha', this.rachaId, 'sortear']);
  }

  irAoVivo(): void {
    this.router.navigate(['/racha', this.rachaId, 'ao-vivo']);
  }

  /** Cria uma nova partida via alert prompt simples. */
  async novaPartida(): Promise<void> {
    const hoje = new Date().toISOString().slice(0, 10);
    const alert = await this.alertCtrl.create({
      header: 'Nova partida',
      inputs: [
        { name: 'data', type: 'date', value: hoje, placeholder: 'Data' },
        { name: 'timeA', type: 'text', placeholder: 'Time A (ex: Vermelhos)' },
        { name: 'timeB', type: 'text', placeholder: 'Time B (ex: Azuis)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Criar',
          role: 'confirm',
          handler: async (d) => {
            const data = (d?.data ?? hoje).trim();
            const timeA = (d?.timeA ?? '').trim() || 'Time A';
            const timeB = (d?.timeB ?? '').trim() || 'Time B';
            try {
              await this.rachaSrv.criarPartida(this.rachaId, {
                data,
                timeANome: timeA,
                timeBNome: timeB,
                golsA: 0,
                golsB: 0,
                status: 'rascunho',
              });
              this.toast('Partida criada!', 'success');
              return true;
            } catch (err) {
              console.error('[Partidas] criar', err);
              this.toast('Erro ao criar partida.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Atualiza placar e finaliza (toggle status). */
  async editarPlacar(p: RachaPartida): Promise<void> {
    if (!p.id) return;
    const alert = await this.alertCtrl.create({
      header: `${p.timeANome} × ${p.timeBNome}`,
      inputs: [
        { name: 'golsA', type: 'number', value: String(p.golsA ?? 0), placeholder: `Gols ${p.timeANome}`, attributes: { min: 0 } },
        { name: 'golsB', type: 'number', value: String(p.golsB ?? 0), placeholder: `Gols ${p.timeBNome}`, attributes: { min: 0 } },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: p.status === 'finalizada' ? 'Salvar' : 'Finalizar',
          role: 'confirm',
          handler: async (d) => {
            const golsA = Math.max(0, Number(d?.golsA ?? 0));
            const golsB = Math.max(0, Number(d?.golsB ?? 0));
            try {
              await this.rachaSrv.atualizarPartida(this.rachaId, p.id!, {
                golsA,
                golsB,
                status: 'finalizada',
              });
              this.toast('Placar salvo.', 'success');
              return true;
            } catch (err) {
              console.error('[Partidas] atualizar', err);
              this.toast('Erro ao salvar placar.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async removerPartida(p: RachaPartida, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!p.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover partida?',
      message: `${p.timeANome} ${p.golsA} × ${p.golsB} ${p.timeBNome} (${this.formatarData(p.data)})`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.rachaSrv.removerPartida(this.rachaId, p.id!);
              this.toast('Partida removida.', 'medium');
              return true;
            } catch (err) {
              console.error('[Partidas] remover', err);
              this.toast('Erro ao remover.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Formata "2026-05-23" → "23/05/2026". */
  formatarData(iso: string): string {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  }

  trackByPartida(_i: number, p: RachaPartida): string {
    return p.id ?? `${_i}`;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'top', color });
    await t.present();
  }
}
