import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { ConvitesModeradorService } from '../../../campeonatos/convites-moderador.service';
import { AuthService } from '../../../auth/auth.service';
import {
  ModeradorCampeonato,
  MODERADOR_PERMISSOES_PADRAO_CAMP,
} from '../../../campeonatos/campeonato.model';
import { denormalizarPermissoesUids } from '../../moderador-permissoes.helper';

/**
 * Modal de gerenciamento de moderadores — fluxo SIMPLES.
 *
 * Em vez de pedir nome/email/permissões na hora de convidar, o organizador
 * só clica em "Gerar link de convite" e o link é criado + salvo
 * INSTANTANEAMENTE. Aí ele compartilha o link.
 *
 * Quando o convidado acessa `/m/:token`, ele:
 *   1. Loga (ou cria conta) — aí o nome dele é capturado do Auth
 *   2. Aceita o convite — o `id` do moderador é trocado pelo UID real
 *
 * Permissões: por padrão, novo moderador recebe TODAS as permissões
 * (`MODERADOR_PERMISSOES_PADRAO_CAMP`). O organizador pode ajustar depois
 * via expandir o card.
 */
@Component({
  selector: 'app-moderadores-modal',
  templateUrl: './moderadores-modal.component.html',
  styleUrls: ['./moderadores-modal.component.scss'],
  standalone: false,
})
export class ModeradoresModalComponent implements OnInit {
  @Input() campeonatoId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly convitesModSrv = inject(ConvitesModeradorService);
  private readonly authSrv = inject(AuthService);

  moderadores: ModeradorCampeonato[] = [];
  /** Índice atualmente expandido (mostra permissões). -1 = nenhum. */
  expandido = -1;
  /** Loading de gerar link / remover (botão fica disabled). */
  trabalhando = false;
  /** Base URL exposta pro template. */
  readonly origin = typeof location !== 'undefined' ? location.origin : '';

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    try {
      const c = await firstValueFrom(this.campSrv.get$(this.campeonatoId));
      this.moderadores = (c?.moderadores ?? []).map(m => ({
        ...m,
        permissoes: { ...MODERADOR_PERMISSOES_PADRAO_CAMP, ...(m.permissoes ?? {}) },
      }));
    } catch (err) {
      console.warn('[Moderadores] load erro', err);
      this.moderadores = [];
    }
  }

  /**
   * Gera link de convite — fluxo NOVO simplificado:
   *  1. Cria moderador placeholder ("Aguardando aceite")
   *  2. Salva imediatamente no campeonato + cria doc espelho
   *  3. Mostra dialog com o link copiável
   *
   * O nome real é preenchido quando o convidado aceita o link.
   */
  async gerarLink(): Promise<void> {
    if (this.trabalhando) return;
    this.trabalhando = true;
    try {
      const novo: ModeradorCampeonato = {
        id: this.gerarId(),
        nome: '', // vazio = aguardando aceite (label dinâmica no template)
        email: '',
        linkToken: this.gerarLinkToken(),
        permissoes: { ...MODERADOR_PERMISSOES_PADRAO_CAMP },
        criadoEm: Date.now(),
      };
      this.moderadores = [...this.moderadores, novo];
      // Persiste no campeonato + listas planas (pra Firestore Rules).
      await this.campSrv.atualizar(this.campeonatoId, {
        moderadores: this.moderadores,
        ...denormalizarPermissoesUids(this.moderadores),
      });
      // Cria espelho na coleção root pra `/m/:token` funcionar
      const uid = this.authSrv.currentUser?.uid;
      if (uid && novo.linkToken) {
        await this.convitesModSrv.upsert(novo.linkToken, {
          campeonatoId: this.campeonatoId,
          categoriaId: '',
          moderadorId: novo.id,
          criadoPor: uid,
        });
      }
      // Abre dialog com o link pronto pra compartilhar
      await this.mostrarLinkGerado(novo);
    } catch (err) {
      console.error('[Moderadores] gerarLink erro', err);
      await this.toast('Falha ao gerar link. Tente novamente.', 'danger');
    } finally {
      this.trabalhando = false;
    }
  }

  /** Mostra alerta com o link recém-criado + botões Copiar e Compartilhar. */
  private async mostrarLinkGerado(m: ModeradorCampeonato): Promise<void> {
    const url = `${this.origin}/m/${m.linkToken}`;
    const alert = await this.alertCtrl.create({
      header: '✓ Link gerado!',
      message:
        '<strong>Envie esse link pra pessoa que vai ser moderadora.</strong>' +
        '<br><br>Ela só precisa clicar e fazer login — o nome dela será ' +
        'preenchido automaticamente.<br><br>' +
        `<code style="word-break:break-all;background:#f1f5f9;padding:6px;border-radius:4px;display:block;">${url}</code>`,
      buttons: [
        {
          text: 'Copiar',
          handler: async () => {
            try {
              await navigator.clipboard.writeText(url);
              await this.toast('Link copiado!', 'success');
            } catch {
              await this.toast('Falha ao copiar. Selecione manualmente.', 'danger');
            }
            return true;
          },
        },
        {
          text: 'Compartilhar',
          handler: async () => {
            if (navigator.share) {
              try {
                await navigator.share({
                  title: 'Convite de moderador',
                  text: 'Você foi convidado como moderador. Acesse:',
                  url,
                });
              } catch { /* user cancelou */ }
            } else {
              await navigator.clipboard.writeText(url);
              await this.toast('Link copiado!', 'success');
            }
            return true;
          },
        },
        { text: 'OK', role: 'cancel' },
      ],
    });
    await alert.present();
  }

  /** Remove moderador (com confirmação) + apaga doc espelho. */
  async remover(idx: number): Promise<void> {
    const m = this.moderadores[idx];
    if (!m) return;
    const nome = m.nome?.trim() || 'esse convite';
    const alert = await this.alertCtrl.create({
      header: 'Remover moderador?',
      message: `<strong>${nome}</strong> perderá o acesso administrativo.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            const tokenRemovido = m.linkToken;
            this.moderadores = this.moderadores.filter((_, i) => i !== idx);
            if (this.expandido === idx) this.expandido = -1;
            else if (this.expandido > idx) this.expandido--;
            try {
              await this.campSrv.atualizar(this.campeonatoId, {
                moderadores: this.moderadores,
                ...denormalizarPermissoesUids(this.moderadores),
              });
              if (tokenRemovido) {
                try { await this.convitesModSrv.remover(tokenRemovido); }
                catch (err) { console.warn('[Moderadores] del espelho falhou', err); }
              }
              await this.toast('Moderador removido.', 'success');
            } catch (err) {
              console.error('[Moderadores] remover erro', err);
              await this.toast('Falha ao remover. Tente de novo.', 'danger');
            }
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Toggle do bloco de permissões. */
  toggle(idx: number): void {
    this.expandido = this.expandido === idx ? -1 : idx;
  }

  /** Atualiza uma permissão e auto-salva. */
  async setPerm<K extends keyof ModeradorCampeonato['permissoes']>(
    idx: number,
    chave: K,
    valor: ModeradorCampeonato['permissoes'][K],
  ): Promise<void> {
    const m = this.moderadores[idx];
    if (!m) return;
    this.moderadores[idx] = {
      ...m,
      permissoes: { ...m.permissoes, [chave]: valor },
    };
    // Auto-save silencioso (sem toast)
    try {
      await this.campSrv.atualizar(this.campeonatoId, {
        moderadores: this.moderadores,
        ...denormalizarPermissoesUids(this.moderadores),
      });
    } catch (err) {
      console.warn('[Moderadores] auto-save perm falhou', err);
    }
  }

  /** Copia o link de um moderador já existente. */
  async copiarLink(m: ModeradorCampeonato): Promise<void> {
    if (!m.linkToken) return;
    const url = `${this.origin}/m/${m.linkToken}`;
    try {
      await navigator.clipboard.writeText(url);
      await this.toast('Link copiado!', 'success');
    } catch {
      await this.toast('Falha ao copiar.', 'danger');
    }
  }

  /** Compartilha via Web Share API. */
  async compartilhar(m: ModeradorCampeonato): Promise<void> {
    if (!m.linkToken) return;
    const url = `${this.origin}/m/${m.linkToken}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Convite de moderador',
          text: 'Você foi convidado como moderador. Acesse:',
          url,
        });
        return;
      } catch { /* cancelado */ }
    }
    await this.copiarLink(m);
  }

  /** Label dinâmica: nome real OU "Aguardando aceite". */
  labelNome(m: ModeradorCampeonato): string {
    return m.nome?.trim() || 'Aguardando aceite';
  }

  /** True se moderador ainda não aceitou o link (nome vazio). */
  pendente(m: ModeradorCampeonato): boolean {
    return !m.nome?.trim();
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss({ saved: true });
  }

  // ─── Helpers ─────────────────────────────────────────────
  private gerarId(): string {
    return 'mod-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  private gerarLinkToken(): string {
    const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 12; i++) s += alf[Math.floor(Math.random() * alf.length)];
    return s;
  }
  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2000, position: 'top', color,
    });
    await t.present();
  }
  trackByMod(_i: number, m: ModeradorCampeonato): string {
    return m.id;
  }
}
