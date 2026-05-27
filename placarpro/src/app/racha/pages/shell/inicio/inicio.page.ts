import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { Racha } from '../../../models/racha.model';

/**
 * Card de atalho do grid de menu (parte inferior da Início).
 */
interface AtalhoCard {
  label: string;
  icon: string;
  iconColor?: 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'danger';
  route: string;
  badge?: string;
}

/**
 * Item da lista "Ative seu racha em 4 passos". `concluido` é calculado
 * a partir do estado atual do racha (qtd jogadores, etc.).
 */
interface PassoAtivacao {
  id: 'times' | 'elenco' | 'cadastro' | 'jogo';
  label: string;
  /** Texto descritivo do progresso (ex: "4/4 times"). */
  meta: string;
  concluido: boolean;
  bloqueado?: boolean;
  /** Sub-itens (aparecem expandidos quando ainda não concluído). */
  subItens?: string[];
}

/**
 * Página INÍCIO do shell do racha — dashboard com:
 *  - Hero "Bem-vindo / Seu futebol organizado"
 *  - Card amarelo "Ative seu racha em 4 passos"
 *  - Grid 4×4 de atalhos
 *  - Card "Planos por Racha"
 */
@Component({
  selector: 'app-racha-inicio',
  templateUrl: './inicio.page.html',
  styleUrls: ['./inicio.page.scss'],
  standalone: false,
})
export class RachaInicioPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly toastCtrl = inject(ToastController);

  racha?: Racha;
  rachaId = '';
  /** Total de jogadores cadastrados na subcoleção `rachas/{id}/jogadores`.
   *  Atualizado reativamente — usado pelo passo "Elenco mínimo" e pelos
   *  bloqueios dos passos seguintes. */
  totalJogadores = 0;
  private sub?: Subscription;
  private jogadoresSub?: Subscription;

  /** Grid de atalhos — espelho do menu lateral (versão visual mais rica). */
  readonly atalhos: AtalhoCard[] = [
    { label: 'RACHAS',          icon: 'reader',          iconColor: 'success', route: 'visao-geral' },
    { label: 'ELENCO',          icon: 'people',          iconColor: 'success', route: 'jogadores' },
    { label: 'MEU RACHA',       icon: 'football',        iconColor: 'success', route: 'meu-racha' },
    { label: 'TIMES',           icon: 'shield',          iconColor: 'success', route: 'times' },
    { label: 'JOGADORES',       icon: 'shirt',           iconColor: 'success', route: 'jogadores' },
    { label: 'SORTEAR TIMES',   icon: 'shuffle',         iconColor: 'success', route: 'sortear' },
    { label: 'PARÇA DO RACHA',  icon: 'people-circle',   iconColor: 'success', route: 'parca' },
    { label: 'LISTA DE PRESENÇA', icon: 'person-add',    iconColor: 'success', route: 'presenca' },
    { label: 'FINANCEIRO',      icon: 'wallet',          iconColor: 'tertiary',route: 'financeiro' },
    { label: 'PARTIDAS',        icon: 'flag',            iconColor: 'warning', route: 'partidas' },
    { label: 'AO VIVO',         icon: 'football-outline',iconColor: 'success', route: 'ao-vivo' },
    { label: 'RANKING',         icon: 'trophy',          iconColor: 'warning', route: 'ranking' },
    { label: 'RANKING MUNDIAL', icon: 'earth',           iconColor: 'success', route: 'ranking-mundial' },
    { label: 'WHATSAPP',        icon: 'logo-whatsapp',   iconColor: 'success', route: 'whatsapp', badge: 'NOVO' },
  ];

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) {
      this.router.navigateByUrl('/racha');
      return;
    }
    this.sub = this.rachaSrv.get$(this.rachaId).subscribe(r => {
      this.racha = r;
    });
    // Stream de jogadores — reage em tempo real conforme o usuário adiciona/remove.
    // O passo "Elenco mínimo" e os bloqueios dos passos seguintes dependem
    // dessa contagem (antes estava chumbada em 0).
    this.jogadoresSub = this.rachaSrv.listJogadores$(this.rachaId).subscribe(js => {
      this.totalJogadores = js.length;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.jogadoresSub?.unsubscribe();
  }

  // ============== Passos de ativação (calculados) ==============

  /**
   * Lista de passos de ativação com estado derivado do `racha`. Permite
   * mostrar progresso real conforme o usuário completa cada etapa.
   * Por enquanto a contagem de jogadores é mockada — quando integrarmos
   * a subcoleção `jogadores`, troca pra contagem real.
   */
  get passos(): PassoAtivacao[] {
    const r = this.racha;
    if (!r) return [];
    const qtdTimes = r.qtdTimes ?? 0;
    const capacidade = r.capacidadeTotal ?? 0;
    // Contagem real da subcoleção `rachas/{id}/jogadores` — atualizada
    // reativamente pelo subscribe no ngOnInit. Antes estava chumbada em 0,
    // o que travava permanentemente os passos 2/3/4 do card amarelo.
    const jogadoresCadastrados = this.totalJogadores;
    const elencoCompleto = capacidade > 0 && jogadoresCadastrados >= capacidade;
    return [
      {
        id: 'times',
        label: 'Times prontos',
        meta: `${qtdTimes}/${qtdTimes} times`,
        concluido: qtdTimes > 0,
      },
      {
        id: 'elenco',
        label: 'Elenco mínimo',
        meta: `${jogadoresCadastrados}/${capacidade} jogadores`,
        concluido: elencoCompleto,
      },
      {
        id: 'cadastro',
        label: 'Completar cadastro',
        meta: this.pendenciasCadastro() + ' pendência(s)',
        concluido: this.pendenciasCadastro() === 0,
        // Não bloqueamos mais — o usuário pode preencher cadastro a qualquer
        // momento (sem precisar ter o elenco completo). Antes ficava trancado
        // até completar 20/20 jogadores, o que não fazia sentido (dá pra
        // configurar o local antes de chamar a galera).
      },
      {
        id: 'jogo',
        label: 'Primeira ação de jogo',
        meta: '0 sorteio(s) · 0 partida(s)',
        concluido: false,
        // Continua bloqueado até ter elenco mínimo — faz sentido aqui porque
        // não dá pra sortear time sem jogadores cadastrados.
        bloqueado: !elencoCompleto,
        subItens: [
          'Escolha o dia da pelada',
          'Defina o horário de início',
        ],
      },
    ];
  }

  /** Número de campos vazios em "Meu Racha" que ainda faltam preencher. */
  private pendenciasCadastro(): number {
    const r = this.racha;
    if (!r) return 0;
    let p = 0;
    if (!r.diaSemana && !r.horario) p++;
    if (!r.horarioInicio) p++;
    if (!r.local) p++;
    if (!r.tipoCampo) p++;
    if (!r.endereco) p++;
    return p;
  }

  /** Total de passos concluídos pra mostrar "X/4 concluídos". */
  get passosConcluidos(): number {
    return this.passos.filter(p => p.concluido).length;
  }
  get progressoPct(): number {
    return Math.round((this.passosConcluidos / 4) * 100);
  }

  // ============== Card de ativação: persistência do "dispensar" ==============

  /** Janela de "snooze" do card de ativação — 7 dias. Depois disso, volta
   *  a aparecer sozinho como lembrete. */
  private readonly DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

  /** Chave do localStorage por racha. Cada racha tem seu próprio estado de
   *  dispensa — útil pra quem gerencia múltiplos rachas. */
  private get dismissKey(): string {
    return `placarpro_racha_${this.rachaId}_ativacao_dispensada_em`;
  }

  /** True quando o usuário clicou em "Deixar para depois" e ainda está
   *  dentro da janela de 7 dias. Usado no `*ngIf` do template pra esconder
   *  o card amarelo até a janela expirar OU o usuário mostrar de novo. */
  get ativacaoDispensada(): boolean {
    try {
      const ts = Number(localStorage.getItem(this.dismissKey) ?? '0');
      if (!ts) return false;
      // Se passou a janela, limpa a flag pra liberar a próxima dispensa.
      const expirado = Date.now() - ts > this.DISMISS_DURATION_MS;
      if (expirado) {
        localStorage.removeItem(this.dismissKey);
        return false;
      }
      return true;
    } catch {
      // SSR / privado / quota cheia → comportamento padrão (mostra o card)
      return false;
    }
  }

  // ============== Ações ==============

  /** Ação primária do card amarelo — leva ao próximo passo pendente.
   *  Adiciona feedback (toast) indicando qual passo está abrindo, pra
   *  o usuário não se perder após a navegação. */
  completarAgora(): void {
    const proximo = this.passos.find(p => !p.concluido && !p.bloqueado);
    if (!proximo) {
      // Tudo concluído ou todo o resto bloqueado (deve ser raro).
      this.toast('Tudo certo no momento — sem pendências acessíveis.', 'success');
      return;
    }
    // Toast antes da navegação dá contexto pro usuário
    const labelPasso = proximo.label.toLowerCase();
    this.toast(`Vamos resolver: ${labelPasso}`, 'medium');
    switch (proximo.id) {
      case 'times':    this.go('times'); break;
      case 'elenco':   this.go('jogadores'); break;
      case 'cadastro': this.go('meu-racha'); break;
      case 'jogo':     this.go('meu-racha'); break; // configurações de dia/horário ficam em meu-racha
    }
  }

  /** Salva timestamp no localStorage — esconde o card por 7 dias.
   *  Não é destrutivo: depois desse prazo o card volta naturalmente como
   *  lembrete, e o usuário pode dispensar de novo. */
  deixarParaDepois(): void {
    try {
      localStorage.setItem(this.dismissKey, String(Date.now()));
    } catch {
      // Quota cheia ou privacy mode — segue sem persistir, ainda dá toast
    }
    this.toast(
      'Avisos pausados por 7 dias. Continue pelo menu lateral quando quiser.',
      'success',
    );
  }

  /** Reabre o card de ativação manualmente (limpa o snooze).
   *  Não tem botão na UI ainda — exposto pra desenvolvedor ou caso futuro
   *  de adicionar opção "Reativar dicas" em config. */
  reabrirAtivacao(): void {
    try { localStorage.removeItem(this.dismissKey); } catch { /* ignore */ }
  }

  irParaAtalho(a: AtalhoCard): void {
    this.go(a.route);
  }

  irParaUpgrade(): void {
    this.go('upgrade');
  }

  copiarConvite(): void {
    const codigo = this.racha?.codigoConvite || this.racha?.conviteToken;
    if (!codigo) {
      this.toast('Convite ainda não gerado.', 'medium');
      return;
    }
    const url = `${location.origin}/racha/c/${codigo}`;
    navigator.clipboard?.writeText(url).then(
      () => this.toast('Link copiado!', 'success'),
      () => this.toast('Falha ao copiar.', 'danger'),
    );
  }

  verRankings(): void {
    this.go('ranking');
  }

  /** Compartilha o link de convite do racha. Usa Web Share API quando
   *  disponível (mobile nativo), fallback pra cópia no clipboard. */
  async convidarAmigos(): Promise<void> {
    const codigo = this.racha?.codigoConvite || this.racha?.conviteToken;
    if (!codigo) {
      this.toast('Convite ainda não gerado. Termine de ativar o racha.', 'medium');
      return;
    }
    const url = `${location.origin}/racha/c/${codigo}`;
    const titulo = this.racha?.nome ?? 'Racha';
    const texto = `Vem jogar no ${titulo}! Confirme presença em:`;

    // Web Share API — mobile abre o sheet nativo (WhatsApp, etc.)
    const nav = navigator as Navigator & {
      share?: (data: { title: string; text: string; url: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ title: titulo, text: texto, url });
        return;
      } catch (err) {
        // Usuário cancelou o share — não mostra erro.
        if ((err as { name?: string })?.name === 'AbortError') return;
      }
    }
    // Fallback desktop / browsers sem share
    navigator.clipboard?.writeText(url).then(
      () => this.toast('Link copiado! Cole no WhatsApp pra convidar.', 'success'),
      () => this.toast('Falha ao copiar.', 'danger'),
    );
  }

  /** Atalho pra tela de gerenciamento do racha (dados básicos, horário, local). */
  gerenciarRacha(): void {
    this.go('meu-racha');
  }

  /** Mostra toast amigável avisando que a feature ainda não está disponível.
   *  Usado nos chips "Em breve" do card de boas-vindas. */
  avisoEmBreve(feature: string): void {
    this.toast(`${feature} chegando em breve. Fica de olho!`, 'medium');
  }

  private go(rota: string): void {
    this.router.navigate(['/racha', this.rachaId, rota]);
  }

  trackByAtalho(_i: number, a: AtalhoCard): string {
    return a.label;
  }
  trackByPasso(_i: number, p: PassoAtivacao): string {
    return p.id;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
