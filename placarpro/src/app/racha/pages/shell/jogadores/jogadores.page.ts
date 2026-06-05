import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { ModalController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { RachaJogador } from '../../../models/racha.model';
import { JogadorModalComponent } from '../../../modals/jogador-modal/jogador-modal.component';

/**
 * Página JOGADORES (Elenco) — CRUD dos jogadores do racha.
 * Inspirado no print do FutBora:
 *  - Hero "Gerencie o elenco" + botões Voltar/Novo Jogador/Cadastrar por voz
 *  - Filtros (nome + checkbox apenas ativos)
 *  - Tabs: ELENCO / CONVIDADOS / NOTAS
 *  - Listagem ou empty state
 *
 * "Cadastrar por voz" é placeholder por enquanto (toast informativo).
 */
@Component({
  selector: 'app-racha-jogadores',
  templateUrl: './jogadores.page.html',
  styleUrls: ['./jogadores.page.scss'],
  standalone: false,
})
export class RachaJogadoresPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  rachaId = '';
  loading = true;
  jogadores: RachaJogador[] = [];

  // Filtros
  busca = '';
  apenasAtivos = true;
  tabAtiva: 'elenco' | 'convidados' | 'notas' = 'elenco';

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.carregar();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    try { this.recognition?.abort(); } catch { /* ignore */ }
  }

  private carregar(): void {
    this.sub = this.rachaSrv.listJogadores$(this.rachaId).pipe(
      startWith([] as RachaJogador[]),
      catchError(err => {
        console.error('[Jogadores] listJogadores erro', err);
        return of([] as RachaJogador[]);
      }),
    ).subscribe(arr => {
      this.jogadores = arr;
      this.loading = false;
    });
  }

  // ============== Tabs ==============

  selecionarTab(tab: 'elenco' | 'convidados' | 'notas'): void {
    this.tabAtiva = tab;
  }

  get totalElenco(): number {
    return this.jogadores.filter(j => j.ativo !== false && j.convidado !== true).length;
  }
  get totalConvidados(): number {
    return this.jogadores.filter(j => j.convidado === true).length;
  }

  // ============== Filtros ==============

  get jogadoresFiltrados(): RachaJogador[] {
    const q = this.busca.trim().toLowerCase();
    let arr = this.jogadores;
    if (this.tabAtiva === 'elenco') {
      arr = arr.filter(j => j.convidado !== true);
    } else if (this.tabAtiva === 'convidados') {
      arr = arr.filter(j => j.convidado === true);
    }
    if (this.apenasAtivos && this.tabAtiva !== 'notas') {
      arr = arr.filter(j => j.ativo !== false);
    }
    if (!q) return arr;
    return arr.filter(j =>
      (j.nome ?? '').toLowerCase().includes(q) ||
      (j.apelido ?? '').toLowerCase().includes(q),
    );
  }

  /** Jogadores ordenados por nota desc (pra tab Notas). */
  get jogadoresPorNota(): RachaJogador[] {
    return [...this.jogadores]
      .filter(j => j.ativo !== false)
      .sort((a, b) => (b.notaGeral ?? 0) - (a.notaGeral ?? 0));
  }

  limparBusca(): void {
    this.busca = '';
  }

  // ============== CRUD ==============

  /**
   * Abre modal customizado pra criar novo jogador. Quando o usuário está
   * na tab "Convidados", já marca `forcaConvidado: true` no modal pra que
   * o checkbox venha pré-selecionado.
   */
  async novoJogador(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: JogadorModalComponent,
      componentProps: {
        rachaId: this.rachaId,
        forcaConvidado: this.tabAtiva === 'convidados',
      },
    });
    await modal.present();
    // Não precisa await result — a lista atualiza via stream do Firestore
  }

  /**
   * Abre modal customizado pra editar jogador existente. Passa o objeto
   * `jogador` via componentProps — o modal entra em modo edição
   * automaticamente.
   */
  async editar(j: RachaJogador): Promise<void> {
    if (!j.id) return;
    const modal = await this.modalCtrl.create({
      component: JogadorModalComponent,
      componentProps: {
        rachaId: this.rachaId,
        jogador: j,
      },
    });
    await modal.present();
  }

  /** True enquanto o microfone está captando. */
  escutando = false;
  // Instância do SpeechRecognition (sem types oficiais).
  private recognition?: { start: () => void; stop: () => void; abort: () => void; lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; onresult: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null; onend: (() => void) | null };

  /**
   * Cadastro por voz usando a Web Speech API (nativa do navegador, sem
   * serviço pago). Fala o nome → cria o jogador. Aceita vários nomes
   * separados por vírgula ou "e" (ex.: "João, Pedro e Lucas").
   * Disponível no Chrome/Edge; em navegadores sem suporte, avisa.
   */
  cadastrarPorVoz(): void {
    if (this.escutando) { this.pararVoz(); return; }

    const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      this.toast('Reconhecimento de voz não é suportado neste navegador. Use o Chrome ou Edge.', 'medium');
      return;
    }

    const rec = new SR() as typeof this.recognition & object;
    this.recognition = rec as typeof this.recognition;
    rec.lang = 'pt-BR';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e: unknown) => {
      const ev = e as { results?: Array<Array<{ transcript?: string }>> };
      const txt = ev.results?.[0]?.[0]?.transcript ?? '';
      this.escutando = false;
      void this.processarVoz(txt);
    };
    rec.onerror = (e: unknown) => {
      this.escutando = false;
      const err = (e as { error?: string }).error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.toast('Permita o acesso ao microfone pra usar o cadastro por voz.', 'danger');
      } else if (err === 'no-speech') {
        this.toast('Não ouvi nada. Toque em "Por voz" e fale o nome.', 'medium');
      } else if (err !== 'aborted') {
        this.toast('Não consegui captar o áudio. Tenta de novo.', 'danger');
      }
    };
    rec.onend = () => { this.escutando = false; };

    this.escutando = true;
    this.toast('🎤 Pode falar o nome do jogador...', 'medium');
    try { rec.start(); } catch { this.escutando = false; }
  }

  private pararVoz(): void {
    try { this.recognition?.stop(); } catch { /* ignore */ }
    this.escutando = false;
  }

  /** Processa o texto reconhecido e cria o(s) jogador(es). */
  private async processarVoz(transcript: string): Promise<void> {
    const bruto = (transcript || '').trim();
    if (!bruto) { this.toast('Não entendi o nome. Tenta de novo.', 'medium'); return; }
    const nomes = bruto
      .split(/\s*,\s*|\s+e\s+|\s*;\s*/i)
      .map(n => this.capitalizarNome(n))
      .filter(n => n.length >= 2);
    if (nomes.length === 0) { this.toast('Não entendi o nome. Tenta de novo.', 'medium'); return; }
    try {
      for (const nome of nomes) {
        await this.rachaSrv.criarJogador(this.rachaId, {
          nome,
          apelido: nome.split(' ')[0],
          ativo: true,
          convidado: this.tabAtiva === 'convidados',
        });
      }
      this.toast(
        nomes.length === 1
          ? `Jogador "${nomes[0]}" cadastrado! ✅`
          : `${nomes.length} jogadores cadastrados! ✅`,
        'success',
      );
    } catch (e) {
      console.error('[Jogadores] cadastro por voz', e);
      this.toast('Falha ao cadastrar. Tenta de novo.', 'danger');
    }
  }

  /** Title Case simples respeitando acentuação (Unicode). */
  private capitalizarNome(s: string): string {
    return (s || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/(^|\s)\p{L}/gu, c => c.toUpperCase())
      .trim();
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  // ============== Helpers ==============

  /** Cor do badge de nota baseado no valor (verde alto, amarelo médio, vermelho baixo). */
  corNota(n: number | undefined): string {
    if (n === undefined || n === null) return '#94a3b8';
    if (n >= 8) return '#16a34a';
    if (n >= 5) return '#f59e0b';
    return '#ef4444';
  }

  inicial(j: RachaJogador): string {
    const fonte = j.apelido?.trim() || j.nome?.trim() || '?';
    return fonte.charAt(0).toUpperCase();
  }

  trackById(_i: number, j: RachaJogador): string {
    return j.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
