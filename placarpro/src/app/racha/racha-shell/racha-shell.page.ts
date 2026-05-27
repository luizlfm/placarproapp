import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AlertController, ToastController } from '@ionic/angular';
import { AuthService } from '../../auth/auth.service';
import { RachaService } from '../racha.service';
import { Racha } from '../models/racha.model';
import { NavBackService } from '../../shared/nav-back.service';

/**
 * Item do menu lateral. Quando `route` está presente, é um link de navegação;
 * quando `action` está presente, dispara uma ação (sair, modo escuro, upgrade).
 */
interface MenuItem {
  /** Texto exibido. */
  label: string;
  /** Ícone Ionicons. */
  icon: string;
  /** Rota relativa ao shell — ex: 'inicio', 'meu-racha'. */
  route?: string;
  /** Ação especial (logout, upgrade, etc.). */
  action?: 'sair' | 'upgrade';
  /** Badge opcional (ex: "NOVO" no WhatsApp). */
  badge?: string;
  /** Cor do ícone (Ionic color). Default 'medium'. */
  iconColor?: 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'danger' | 'medium';
  /** Header da seção (separador) — quando true, é só o título da seção. */
  header?: boolean;
}

/**
 * Shell da área de um racha — equivalente ao layout do FutBora quando você
 * abre um racha específico. Sidebar fixa à esquerda com todos os menus,
 * topbar com nome do racha e avatar + menu hamburger no mobile, área central
 * com router-outlet pras páginas filhas.
 *
 * Rota: `/racha/:id/*`
 */
@Component({
  selector: 'app-racha-shell',
  templateUrl: './racha-shell.page.html',
  styleUrls: ['./racha-shell.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class RachaShellPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authSrv = inject(AuthService);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  /** Racha atual carregado da URL. */
  racha?: Racha;
  rachaId = '';
  loading = true;
  /** Sidebar aberta no mobile (sheet). Em desktop sempre visível. */
  sidebarAberta = false;

  /**
   * Estrutura completa do menu lateral, agrupado por seção. Pra adicionar
   * uma nova tela basta inserir um item aqui + criar a rota correspondente
   * em `racha-shell-routing.module.ts`. Layout 100% data-driven.
   */
  readonly menu: MenuItem[] = [
    { label: 'Início',         icon: 'home',              route: 'inicio',         iconColor: 'warning' },
    /* "Sortear Times" promovido pro topo — é a ação central do racha,
       todo evento começa por aqui. Antes ficava lá embaixo em JOGOS. */
    { label: 'Sortear Times',  icon: 'shuffle',           route: 'sortear',        iconColor: 'success' },
    { label: 'Lista de Presença', icon: 'person-add',     route: 'presenca',       iconColor: 'success' },
    { label: 'Rachas',         icon: 'reader',            route: 'visao-geral',    iconColor: 'success' },
    { label: 'Elenco',         icon: 'people',            route: 'jogadores',      iconColor: 'success' },
    { label: 'Financeiro',     icon: 'wallet',            route: 'financeiro',     iconColor: 'tertiary' },
    { label: 'Ranking',        icon: 'trophy',            route: 'ranking',        iconColor: 'warning' },
    { label: 'Conquistas',     icon: 'ribbon',            route: 'conquistas',     iconColor: 'warning', badge: 'NOVO' },
    { label: 'Mercado de Notas', icon: 'trending-up',     route: 'mercado',        iconColor: 'success', badge: 'NOVO' },
    { label: 'Avaliação',      icon: 'star',              route: 'avaliacao',      iconColor: 'warning', badge: 'NOVO' },
    { label: 'Ranking Mundial',icon: 'earth',             route: 'ranking-mundial',iconColor: 'success' },

    { header: true, label: 'ADMINISTRAÇÃO', icon: '' },
    { label: 'Meu Racha',      icon: 'football',          route: 'meu-racha',      iconColor: 'success' },
    { label: 'Times',          icon: 'shield',            route: 'times',          iconColor: 'success' },
    { label: 'Jogadores',      icon: 'shirt',             route: 'jogadores',      iconColor: 'success' },
    { label: 'WhatsApp',       icon: 'logo-whatsapp',     route: 'whatsapp',       iconColor: 'success', badge: 'NOVO' },

    /* Seção JOGOS — fica com as ações menos frequentes (Sortear Times e
       Lista de Presença subiram pro topo). */
    { header: true, label: 'JOGOS', icon: '' },
    { label: 'Parça do Racha', icon: 'people-circle',     route: 'parca',          iconColor: 'success' },
    { label: 'Partidas',       icon: 'flag',              route: 'partidas',       iconColor: 'warning' },
    { label: 'Ao Vivo',        icon: 'football-outline',  route: 'ao-vivo',        iconColor: 'success' },

    { header: true, label: 'CONTA', icon: '' },
    { label: 'Sair',           icon: 'log-out',           action: 'sair',          iconColor: 'danger' },
    { label: 'Upgrade Premium', icon: 'star',             action: 'upgrade',       iconColor: 'success' },
  ];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.paramMap.get('id') ?? '';
    if (!this.rachaId) {
      this.router.navigateByUrl('/racha');
      return;
    }
    this.sub = this.rachaSrv.get$(this.rachaId).subscribe(r => {
      if (!r) {
        this.toast('Racha não encontrado.', 'danger');
        this.router.navigateByUrl('/racha');
        return;
      }
      this.racha = r;
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  // ============== Sidebar interaction ==============

  toggleSidebar(): void {
    this.sidebarAberta = !this.sidebarAberta;
  }

  /** Click num item do menu — navega ou dispara ação especial. */
  async onItemClick(item: MenuItem): Promise<void> {
    if (item.header) return;
    // Em mobile, fecha o sheet ao clicar (UX padrão)
    if (window.innerWidth <= 900) this.sidebarAberta = false;

    if (item.action === 'sair') {
      await this.sair();
      return;
    }
    if (item.action === 'upgrade') {
      this.router.navigate(['/racha', this.rachaId, 'upgrade']);
      return;
    }
    if (item.route) {
      this.router.navigate(['/racha', this.rachaId, item.route]);
    }
  }

  /** Rota ativa? — usado pra destacar o item selecionado. */
  isActive(item: MenuItem): boolean {
    if (!item.route) return false;
    return this.router.url.includes(`/racha/${this.rachaId}/${item.route}`);
  }

  // ============== Avatar ==============

  get nomeUsuario(): string {
    const u = this.authSrv.currentUser;
    if (!u) return '';
    if (u.displayName) return u.displayName;
    if (u.email) return u.email.split('@')[0];
    return 'Usuário';
  }
  get inicialUsuario(): string {
    return (this.nomeUsuario.charAt(0) || '?').toUpperCase();
  }
  get fotoUsuario(): string | null {
    return this.authSrv.currentUser?.photoURL ?? null;
  }

  voltarHome(): void {
    this.router.navigateByUrl('/racha');
  }

  /**
   * Volta pra tela anterior — usa o histórico do browser (NavController do
   * Ionic) com fallback inteligente:
   *
   *  - Em `/racha/{id}/inicio` (home do racha) → volta pra lista `/racha`
   *  - Em qualquer outra sub-rota do racha → volta pra `/racha/{id}/inicio`
   *
   * Esse comportamento garante que mesmo quando o usuário entra direto via
   * URL (sem histórico), o botão "voltar" não fica sem destino.
   */
  voltar(): void {
    const url = this.router.url;
    // Se já está na home do racha, voltar leva pra lista de rachas.
    if (url.endsWith(`/racha/${this.rachaId}/inicio`)) {
      this.navBack.back('/racha');
    } else {
      // Caso geral: volta pra home do racha atual.
      this.navBack.back(`/racha/${this.rachaId}/inicio`);
    }
  }

  /** Esconde o botão de voltar quando estamos na home do racha — não faz
   *  sentido voltar pra lista de rachas via botão escondido na toolbar
   *  (o usuário tem o "Voltar" do clique na brand logo da sidebar). */
  get mostrarBotaoVoltar(): boolean {
    return !this.router.url.endsWith(`/racha/${this.rachaId}/inicio`);
  }

  // ============== Sair ==============

  private async sair(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sair da conta?',
      message: 'Você precisará fazer login novamente para acessar o painel.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Sair',
          role: 'destructive',
          handler: async () => {
            try {
              await this.authSrv.signOut();
              await this.router.navigateByUrl('/', { replaceUrl: true });
            } catch (err) {
              console.error('[RachaShell] signOut erro', err);
              await this.toast('Falha ao sair. Tente novamente.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ============== Helpers ==============

  trackByLabel(_i: number, item: MenuItem): string {
    return item.label;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
