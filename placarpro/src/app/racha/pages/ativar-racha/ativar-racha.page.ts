import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { LoadingController, ToastController } from '@ionic/angular';
import { RachaService } from '../../racha.service';
import { Racha } from '../../models/racha.model';

/**
 * Wizard de ATIVAÇÃO do racha (3 passos):
 *  1) Times — confirmar quantidade e nomear os times
 *  2) Jogadores — sugestões iniciais (placeholder)
 *  3) Pronto — feedback final + CTA pra entrar no racha
 *
 * UX inspirada no FutBora: gradient navy→verde no topo, step indicator
 * em 3 colunas, navegação Avançar/Voltar entre passos.
 *
 * Rota: `/racha/:id/ativar`
 */
@Component({
  selector: 'app-ativar-racha',
  templateUrl: './ativar-racha.page.html',
  styleUrls: ['./ativar-racha.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class AtivarRachaPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  /** Racha atual sendo configurado (carregado via id da URL). */
  racha?: Racha;
  rachaId = '';
  loading = true;

  /** Passo atual (1, 2 ou 3). */
  passoAtual: 1 | 2 | 3 = 1;

  /** Nomes dos times (array dinâmico com qtdTimes posições). */
  nomesTimes: string[] = [];

  /** Lista de jogadores sugerida (apenas nomes — versão simples). */
  jogadoresSugeridos: string[] = [];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.rachaId) {
      this.router.navigateByUrl('/racha');
      return;
    }
    // Subscribe pra ficar reativo a mudanças (útil se o doc for editado em outra aba)
    this.sub = this.rachaSrv.get$(this.rachaId).subscribe(r => {
      if (!r) {
        // Doc não existe — volta pra listagem
        this.toast('Racha não encontrado.', 'danger');
        this.router.navigateByUrl('/racha');
        return;
      }
      this.racha = r;
      this.loading = false;
      // Preenche nomes dos times só na primeira vez (não sobrescrever edição em curso)
      if (this.nomesTimes.length === 0) {
        this.nomesTimes = Array.from({ length: r.qtdTimes }, (_, i) => `Time ${i + 1}`);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ============== Step indicator helpers ==============

  /** Total derivado pra exibir nos chips do hero. */
  get capacidadeTotal(): number {
    return this.racha?.capacidadeTotal ?? 0;
  }

  // ============== Step 1 — Times ==============

  /** Ajusta a quantidade de times (+/-) e sincroniza o array de nomes. */
  ajustarQtdTimes(delta: number): void {
    if (!this.racha) return;
    const novo = Math.max(2, Math.min(8, (this.racha.qtdTimes ?? 2) + delta));
    if (novo === this.racha.qtdTimes) return;
    this.racha.qtdTimes = novo;
    // Cresce ou encolhe o array de nomes mantendo os já preenchidos
    if (this.nomesTimes.length < novo) {
      while (this.nomesTimes.length < novo) {
        this.nomesTimes.push(`Time ${this.nomesTimes.length + 1}`);
      }
    } else {
      this.nomesTimes = this.nomesTimes.slice(0, novo);
    }
  }

  async salvarPasso1EAvancar(): Promise<void> {
    if (!this.racha) return;
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      await this.rachaSrv.atualizar(this.rachaId, {
        qtdTimes: this.racha.qtdTimes,
        // Salva nomes dos times num campo livre (não persistido como subcoleção
        // ainda — pra iteração inicial é suficiente). Futuro: subcoleção "times".
      });
      this.passoAtual = 2;
    } catch (err) {
      console.error('[AtivarRacha] salvarPasso1 erro', err);
      await this.toast('Falha ao salvar. Tente novamente.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  // ============== Step 2 — Jogadores ==============

  /** Adiciona um nome à lista de jogadores sugeridos. */
  adicionarJogador(input: HTMLInputElement): void {
    const v = (input.value ?? '').trim();
    if (!v) return;
    if (this.jogadoresSugeridos.includes(v)) {
      input.value = '';
      return;
    }
    this.jogadoresSugeridos.push(v);
    input.value = '';
    input.focus();
  }

  removerJogador(i: number): void {
    this.jogadoresSugeridos.splice(i, 1);
  }

  async salvarPasso2EAvancar(): Promise<void> {
    // Pula direto pro passo 3 (jogadores são opcionais — podem ser
    // adicionados depois pelo dashboard).
    this.passoAtual = 3;
  }

  // ============== Step 3 — Pronto ==============

  async finalizar(): Promise<void> {
    if (!this.rachaId) return;
    const loader = await this.loadingCtrl.create({ message: 'Finalizando...' });
    await loader.present();
    try {
      await this.rachaSrv.marcarAtivado(this.rachaId);
      await this.toast('Tudo pronto! Bom racha 🏆', 'success');
      // Vai direto pro dashboard do racha (shell com sidebar)
      await this.router.navigate(['/racha', this.rachaId, 'inicio']);
    } catch (err) {
      console.error('[AtivarRacha] finalizar erro', err);
      await this.toast('Falha ao finalizar. Tente novamente.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  // ============== Navegação ==============

  voltarPasso(): void {
    if (this.passoAtual === 3) this.passoAtual = 2;
    else if (this.passoAtual === 2) this.passoAtual = 1;
    else this.router.navigateByUrl('/racha');
  }

  irParaPasso(p: 1 | 2 | 3): void {
    // Permite clicar nos steps pra navegar livremente (não força sequência rígida)
    this.passoAtual = p;
  }

  /** trackBy pro *ngFor dos nomes de times — usa o index (estável durante
   *  resizes do array com ajustarQtdTimes). */
  trackByIndex(i: number): number {
    return i;
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', color });
    await t.present();
  }
}
