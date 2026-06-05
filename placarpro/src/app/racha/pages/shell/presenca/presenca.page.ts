import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, combineLatest, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { Racha, RachaJogador, RachaPresenca } from '../../../models/racha.model';

/** Status possível na lista de presença. */
type PresencaStatus = 'vou' | 'espera' | 'nao-vou' | 'sem';

/** Linha do roster: jogador + status atual na sessão. */
interface RosterItem {
  jogador: RachaJogador;
  status: PresencaStatus;
  pago: boolean;
}

/**
 * Página LISTA DE PRESENÇA — agora persistida no Firestore.
 * Mostra o elenco do racha e o organizador marca quem vai / em espera /
 * não vai. Tudo grava na sessão atual (`rachas/{id}/sessoes/atual/presencas`)
 * e sincroniza entre dispositivos. A fila aberta/fechada também é persistida.
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

  /** Fila aberta/fechada (persistido na sessão). Default: aberta. */
  filaAberta = true;

  /** Roster combinado (jogadores + status da presença). */
  roster: RosterItem[] = [];

  /** Accordion: qual painel admin está expandido. */
  accordionAberto: 'janela' | 'capacidade' | 'horario' | 'pix' | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }

    const combined$ = combineLatest([
      this.rachaSrv.get$(this.rachaId),
      this.rachaSrv.listJogadores$(this.rachaId),
      this.rachaSrv.listPresencas$(this.rachaId),
      this.rachaSrv.sessaoAtual$(this.rachaId),
    ]).pipe(
      catchError(err => {
        console.error('[Presenca] stream', err);
        return of([undefined, [], [], undefined] as [Racha | undefined, RachaJogador[], RachaPresenca[], { filaAberta?: boolean } | undefined]);
      }),
    );

    this.subs.push(combined$.subscribe(([racha, jogadores, presencas, sessao]) => {
      this.racha = racha ?? undefined;
      this.filaAberta = sessao?.filaAberta !== false; // default aberta
      const mapa = new Map<string, RachaPresenca>();
      for (const p of presencas) if (p.jogadorId) mapa.set(p.jogadorId, p);
      this.roster = (jogadores ?? [])
        .filter(j => j.ativo !== false)
        .map(j => {
          const p = j.id ? mapa.get(j.id) : undefined;
          return {
            jogador: j,
            status: (p?.status as PresencaStatus) ?? 'sem',
            pago: !!p?.pago,
          } as RosterItem;
        })
        // confirmados primeiro, depois espera, depois sem-resposta, depois não-vou
        .sort((a, b) => this.pesoStatus(a.status) - this.pesoStatus(b.status));
      this.loading = false;
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  private pesoStatus(s: PresencaStatus): number {
    return { vou: 0, espera: 1, sem: 2, 'nao-vou': 3 }[s];
  }

  // ============== Métricas (dados reais) ==============

  get capacidade(): number {
    const r = this.racha;
    if (!r) return 0;
    return (r.qtdTimes ?? 0) * (r.jogadoresPorTime ?? 0);
  }
  get confirmados(): number {
    return this.roster.filter(r => r.status === 'vou').length;
  }
  get vagasLivres(): number {
    return Math.max(0, this.capacidade - this.confirmados);
  }
  get emEspera(): number {
    return this.roster.filter(r => r.status === 'espera').length;
  }
  get naoVou(): number {
    return this.roster.filter(r => r.status === 'nao-vou').length;
  }
  get pagosCount(): number {
    return this.roster.filter(r => r.pago).length;
  }

  // ============== Ações por jogador ==============

  /**
   * Define o status de um jogador. Se clicar no status que já está ativo,
   * limpa (volta pra sem-resposta). Quando confirma "vou" e a capacidade
   * está cheia, entra automaticamente em espera.
   */
  async definir(item: RosterItem, alvo: 'vou' | 'espera' | 'nao-vou'): Promise<void> {
    const jid = item.jogador.id;
    if (!jid) return;
    if (alvo === 'vou' && !this.filaAberta) {
      this.toast('A fila está fechada no momento.', 'danger');
      return;
    }

    // Toggle: clicar no mesmo status remove a presença.
    if (item.status === alvo) {
      try {
        await this.rachaSrv.removerPresenca(this.rachaId, jid);
      } catch (e) { console.error(e); this.toast('Falha ao atualizar.', 'danger'); }
      return;
    }

    let status: 'vou' | 'espera' | 'nao-vou' = alvo;
    // Lotou? confirma como espera.
    if (alvo === 'vou' && this.confirmados >= this.capacidade && this.capacidade > 0) {
      status = 'espera';
    }
    try {
      await this.rachaSrv.setPresenca(this.rachaId, jid, {
        nome: item.jogador.apelido || item.jogador.nome,
        status,
        mensalista: !!item.jogador.mensalista,
      });
      if (status === 'espera' && alvo === 'vou') {
        this.toast('Lista cheia — entrou na lista de espera.', 'medium');
      }
    } catch (e) { console.error(e); this.toast('Falha ao salvar presença.', 'danger'); }
  }

  /** Alterna o "pago" (PIX) de um jogador confirmado. */
  async togglePago(item: RosterItem, ev: Event): Promise<void> {
    ev.stopPropagation();
    const jid = item.jogador.id;
    if (!jid) return;
    try {
      await this.rachaSrv.setPresenca(this.rachaId, jid, {
        nome: item.jogador.apelido || item.jogador.nome,
        status: item.status === 'sem' ? 'vou' : (item.status as 'vou' | 'espera' | 'nao-vou'),
        pago: !item.pago,
      });
    } catch (e) { console.error(e); }
  }

  // ============== Admin ==============

  async toggleFila(): Promise<void> {
    const novo = !this.filaAberta;
    try {
      await this.rachaSrv.setFilaAberta(this.rachaId, novo);
      this.toast(novo ? 'Fila aberta — pessoal já pode confirmar!' : 'Fila fechada.', 'success');
    } catch (e) { console.error(e); this.toast('Falha ao mudar a fila.', 'danger'); }
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

  async limparFila(): Promise<void> {
    if (this.roster.every(r => r.status === 'sem')) {
      this.toast('A lista já está vazia.', 'medium');
      return;
    }
    try {
      await this.rachaSrv.limparPresencas(this.rachaId);
      this.toast('Lista limpa.', 'success');
    } catch (e) { console.error(e); this.toast('Falha ao limpar.', 'danger'); }
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  adicionarEndereco(): void {
    this.router.navigate(['/racha', this.rachaId, 'meu-racha']);
  }

  irParaJogadores(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }

  // ============== Helpers ==============

  trackByItem(_i: number, item: RosterItem): string {
    return item.jogador.id ?? item.jogador.nome;
  }

  iniciais(nome: string): string {
    const partes = (nome || '?').trim().split(/\s+/);
    return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  diaSemanaLabel(d?: string): string {
    const map: Record<string, string> = {
      dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta',
      qui: 'Quinta', sex: 'Sexta', sab: 'Sábado',
    };
    return d ? map[d] ?? '—' : '—';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
