import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import {
  Categoria,
  MODERADOR_PERMISSOES_PADRAO,
  Moderador,
  ModeradorPermissoes,
} from '../../../campeonatos/categoria.model';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { ConvitesModeradorService } from '../../../campeonatos/convites-moderador.service';
import { AuthService } from '../../../auth/auth.service';
import { Seguidor } from '../../../campeonatos/models/seguidor.model';
import { SelecionarSeguidorModalComponent } from '../selecionar-seguidor-modal/selecionar-seguidor-modal.component';

/**
 * Modal "Moderadores" — estilo placarpro.
 *
 * Lista os moderadores cadastrados na categoria. Cada item exibe nome
 * e foto. Clique no item → action sheet com opções:
 *   • Permissões
 *   • Copiar link de acesso único
 *   • Remover
 *
 * Botão `+` no header → adiciona um novo moderador (apenas pelo nome
 * por enquanto; o linkToken é gerado automaticamente).
 */
@Component({
  selector: 'app-moderadores-modal',
  templateUrl: './moderadores-modal.component.html',
  styleUrls: ['./moderadores-modal.component.scss'],
  standalone: false,
})
export class ModeradoresModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() categoria!: Categoria;

  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly convitesModSrv = inject(ConvitesModeradorService);
  private readonly authSrv = inject(AuthService);

  /** Lista normalizada (sempre `Moderador[]`, migrando legado string[]). */
  moderadores: Moderador[] = [];
  salvando = false;

  /** Estado do modal de permissões (aparece como overlay). */
  modPermissoes?: Moderador;
  formPermissoes: ModeradorPermissoes = { ...MODERADOR_PERMISSOES_PADRAO };
  /** Categorias disponíveis no campeonato (pra filtrar). */
  categoriasDisponiveis: { id: string; titulo: string }[] = [];

  async ngOnInit(): Promise<void> {
    this.moderadores = this.normalizar(this.categoria?.moderadores);
    // Carrega lista de categorias para filtro
    try {
      if (this.campeonatoId) {
        const camp = await firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId));
        if (camp) {
          // Mantém compatibilidade: as categorias estão num subdocument já cacheado
          // ou listamos via CategoriasService. Pra evitar dep cyclic, listamos básicas.
        }
      }
    } catch {
      /* sem-op */
    }
  }

  /** Converte legado (string[]) → Moderador[]. */
  private normalizar(raw: unknown): Moderador[] {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => {
      if (typeof item === 'string') {
        return { id: item, nome: item, criadoEm: Date.now() };
      }
      return item as Moderador;
    });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /**
   * Abre o picker de seguidores. Só usuários que já seguem o campeonato
   * (e portanto têm login) podem virar moderadores.
   */
  async adicionar(): Promise<void> {
    const jaIds = this.moderadores.map(m => m.id);
    const modal = await this.modalCtrl.create({
      component: SelecionarSeguidorModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        jaModeradores: jaIds,
      },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ seguidor?: Seguidor }>();
    const s = data?.seguidor;
    if (!s) return;
    await this.adicionarDeSeguidor(s);
  }

  /** Cria o moderador a partir de um seguidor já existente (com login). */
  private async adicionarDeSeguidor(s: Seguidor): Promise<void> {
    if (this.moderadores.some(m => m.id === s.uid)) {
      await this.toast(`${s.nome} já é moderador.`, 'warning');
      return;
    }
    const novo: Moderador = {
      id: s.uid,
      nome: s.nome,
      ...(s.email ? { email: s.email } : {}),
      ...(s.fotoUrl ? { fotoUrl: s.fotoUrl } : {}),
      linkToken: this.gerarToken(),
      permissoes: 'gerenciar',
      permissoesDetalhadas: { ...MODERADOR_PERMISSOES_PADRAO },
      criadoEm: Date.now(),
    };
    this.moderadores = [...this.moderadores, novo];
    await this.persistir();
    await this.toast(`${s.nome} adicionado como moderador.`, 'success');
  }

  /** Clique no item da lista → abre modal de permissões diretamente. */
  abrirAcoes(m: Moderador): void {
    this.abrirPermissoes(m);
  }

  /** Abre o painel de permissões granulares como overlay. */
  abrirPermissoes(m: Moderador): void {
    this.modPermissoes = m;
    this.formPermissoes = {
      ...MODERADOR_PERMISSOES_PADRAO,
      ...(m.permissoesDetalhadas ?? {}),
    };
  }

  fecharPermissoes(): void {
    this.modPermissoes = undefined;
  }

  togglePerm(campo: 'editarCampeonato' | 'editarResultados' | 'enviarMidias'): void {
    this.formPermissoes = {
      ...this.formPermissoes,
      [campo]: !this.formPermissoes[campo],
    };
  }

  async filtrarCategoria(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Filtrar por categoria',
      message: 'Cole os IDs das categorias permitidas, separados por vírgula. Deixe vazio para liberar todas.',
      inputs: [
        {
          name: 'ids',
          type: 'textarea',
          value: (this.formPermissoes.categoriasPermitidas ?? []).join(', '),
          placeholder: 'cat1, cat2, ...',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Aplicar',
          handler: (data: { ids: string }) => {
            const lista = (data.ids ?? '')
              .split(/[\s,;]+/)
              .map(s => s.trim())
              .filter(Boolean);
            this.formPermissoes = {
              ...this.formPermissoes,
              categoriasPermitidas: lista,
            };
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async salvarPermissoes(): Promise<void> {
    if (!this.modPermissoes) return;
    this.modPermissoes.permissoesDetalhadas = { ...this.formPermissoes };
    // Mantém legado em sincronia: se TODAS as 3 permissões marcadas → 'gerenciar', senão 'apenas-lances'
    const all = this.formPermissoes.editarCampeonato
      && this.formPermissoes.editarResultados
      && this.formPermissoes.enviarMidias;
    this.modPermissoes.permissoes = all ? 'gerenciar' : 'apenas-lances';
    this.moderadores = [...this.moderadores];
    await this.persistir();
    this.fecharPermissoes();
    await this.toast('Permissões salvas.', 'success');
  }

  async removerAtual(): Promise<void> {
    if (!this.modPermissoes) return;
    const m = this.modPermissoes;
    const alert = await this.alertCtrl.create({
      header: 'Remover moderador?',
      message: `${m.nome} perderá o acesso a esta categoria.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            this.moderadores = this.moderadores.filter(x => x.id !== m.id);
            await this.persistir();
            this.fecharPermissoes();
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Copia o link de acesso único do moderador para o clipboard. */
  private async copiarLink(m: Moderador): Promise<void> {
    if (!m.linkToken) {
      m.linkToken = this.gerarToken();
      await this.persistir();
    }
    const url = `${window.location.origin}/m/${m.linkToken}`;
    try {
      await navigator.clipboard.writeText(url);
      await this.toast('Link copiado para a área de transferência.', 'success');
    } catch {
      // Fallback: mostra o link num alerta para o usuário copiar manualmente
      const alert = await this.alertCtrl.create({
        header: 'Link de acesso único',
        message: url,
        buttons: ['OK'],
      });
      await alert.present();
    }
  }

  /** Remove o moderador (com confirmação). */
  private async remover(m: Moderador): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover moderador?',
      message: `${m.nome} perderá o acesso a esta categoria.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            this.moderadores = this.moderadores.filter(x => x.id !== m.id);
            await this.persistir();
            // Limpa o convite espelho — sem isso o link mágico continuaria
            // valido mesmo após remover o moderador.
            if (m.linkToken) {
              try { await this.convitesModSrv.remover(m.linkToken); }
              catch (err) { console.warn('[ModeradoresModal] remove convite falhou', err); }
            }
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** Persiste a lista de moderadores no Firestore + sincroniza convites root. */
  private async persistir(): Promise<void> {
    this.salvando = true;
    try {
      // Cast: o model aceita string[] | Moderador[] (compat)
      await this.categoriasSrv.atualizar(this.campeonatoId, this.categoriaId, {
        moderadores: this.moderadores as unknown as string[],
      });
      // Sincroniza espelho na coleção root `convitesModerador/{linkToken}`.
      // Sem isso, a página `/m/{token}` não acha o convite (Firestore não
      // consulta dentro de arrays de subcoleções com performance aceitável).
      await this.sincronizarConvites();
    } catch (err) {
      console.error('[ModeradoresModal] persistir', err);
      await this.toast('Erro ao salvar moderadores.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  /**
   * Para cada moderador com `linkToken`, cria/atualiza o doc espelho em
   * `convitesModerador/{linkToken}`. Erros individuais são logados mas não
   * abortam o fluxo (UX > atomicidade aqui — o moderador continua salvo
   * na categoria mesmo se o espelho falhar; só o link mágico não funciona).
   */
  private async sincronizarConvites(): Promise<void> {
    const uid = this.authSrv.currentUser?.uid;
    if (!uid) return;
    for (const m of this.moderadores) {
      if (!m.linkToken) continue;
      try {
        await this.convitesModSrv.upsert(m.linkToken, {
          campeonatoId: this.campeonatoId,
          categoriaId: this.categoriaId,
          moderadorId: m.id,
          nome: m.nome,
          email: m.email,
          criadoPor: uid,
        });
      } catch (err) {
        console.warn('[ModeradoresModal] sync convite falhou', m.linkToken, err);
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────
  private gerarId(): string {
    return 'mod_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  private gerarToken(): string {
    // Token mais curto/legível pra URL: 12 chars alfanuméricos
    const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 12; i++) s += alf[Math.floor(Math.random() * alf.length)];
    return s;
  }

  rotuloPermissoes(p?: Moderador['permissoes']): string {
    return p === 'apenas-lances' ? 'Apenas lances' : 'Gerenciar';
  }

  trackById(_i: number, m: Moderador): string {
    return m.id;
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'warning',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
