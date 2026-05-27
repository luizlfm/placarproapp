import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { Racha } from '../../../models/racha.model';

/**
 * Item local da fila — em iterações futuras viraria subcoleção
 * `rachas/{id}/sessoes/{sessaoId}/presencas/{jogadorId}` no Firestore.
 */
interface ItemPresenca {
  nome: string;
  status: 'vou' | 'nao-vou' | 'espera';
  mensalista?: boolean;
  pago?: boolean;
}

/**
 * Página LISTA DE PRESENÇA — usuário marca Vou/Não Vou. Admin (dono)
 * vê painel administrativo (janela de abertura, capacidade, dia/horário,
 * PIX). Estado da fila persistido localmente por enquanto — quando
 * implementarmos sessões, vira subcoleção.
 */
@Component({
  selector: 'app-racha-presenca',
  templateUrl: './presenca.page.html',
  styleUrls: ['./presenca.page.scss'],
  standalone: false,
})
export class RachaPresencaPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly toastCtrl = inject(ToastController);

  rachaId = '';
  loading = true;
  racha?: Racha;

  /** Status do usuário atual na fila — placeholder até integrarmos auth. */
  meuStatus: 'sem-resposta' | 'vou' | 'nao-vou' = 'sem-resposta';
  /** Estado da fila (admin pode abrir/fechar). */
  filaAberta = true;

  /** Lista local de presenças. Apenas demonstração — produção usaria Firestore. */
  presencas: ItemPresenca[] = [];

  /** Accordion: qual painel admin está expandido. */
  accordionAberto: 'janela' | 'capacidade' | 'horario' | 'pix' | null = null;

  /** Horário atualizado (pra mostrar "Atualizado HH:MM" no card). */
  horarioAtualizacao = this.formatHora(new Date());

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.sub = this.rachaSrv.get$(this.rachaId).pipe(
      startWith(undefined),
      catchError(err => {
        console.error('[Presenca] get racha', err);
        return of(undefined);
      }),
    ).subscribe(r => {
      this.racha = r ?? undefined;
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ============== Métricas ==============

  get capacidade(): number {
    const r = this.racha;
    if (!r) return 0;
    return (r.qtdTimes ?? 0) * (r.jogadoresPorTime ?? 0);
  }
  get confirmados(): number {
    return this.presencas.filter(p => p.status === 'vou').length;
  }
  get vagasLivres(): number {
    return Math.max(0, this.capacidade - this.confirmados);
  }
  get emEspera(): number {
    return this.presencas.filter(p => p.status === 'espera').length;
  }
  get pagosCount(): number {
    return this.presencas.filter(p => p.pago).length;
  }

  // ============== Ações do usuário ==============

  marcarVou(): void {
    if (!this.filaAberta) {
      this.toast('A fila está fechada no momento.', 'danger');
      return;
    }
    this.meuStatus = 'vou';
    this.horarioAtualizacao = this.formatHora(new Date());
    this.toast('Confirmado! Você está dentro 🎯', 'success');
  }

  marcarNaoVou(): void {
    this.meuStatus = 'nao-vou';
    this.horarioAtualizacao = this.formatHora(new Date());
    this.toast('Marcado: não vou. Fica pro próximo!', 'medium');
  }

  // ============== Admin ==============

  toggleFila(): void {
    this.filaAberta = !this.filaAberta;
    this.toast(this.filaAberta ? 'Fila aberta — pessoal já pode confirmar!' : 'Fila fechada.', 'success');
  }

  toggleAccordion(secao: 'janela' | 'capacidade' | 'horario' | 'pix'): void {
    this.accordionAberto = this.accordionAberto === secao ? null : secao;
  }

  usarFilaNoSorteio(): void {
    if (this.confirmados === 0) {
      this.toast('Nenhum jogador confirmado ainda.', 'danger');
      return;
    }
    this.router.navigate(['/racha', this.rachaId, 'sortear']);
  }

  limparFila(): void {
    if (this.presencas.length === 0) {
      this.toast('Fila já está vazia.', 'medium');
      return;
    }
    this.presencas = [];
    this.meuStatus = 'sem-resposta';
    this.toast('Fila limpa.', 'success');
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  adicionarEndereco(): void {
    this.router.navigate(['/racha', this.rachaId, 'meu-racha']);
  }

  // ============== Helpers ==============

  diaSemanaLabel(d?: string): string {
    const map: Record<string, string> = {
      dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta',
      qui: 'Quinta', sex: 'Sexta', sab: 'Sábado',
    };
    return d ? map[d] ?? '—' : '—';
  }

  private formatHora(d: Date): string {
    return d.toTimeString().slice(0, 5);
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
