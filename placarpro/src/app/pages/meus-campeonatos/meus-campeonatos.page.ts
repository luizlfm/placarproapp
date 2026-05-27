import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable, Subscription, map, of, startWith } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { UsersService } from '../../users/users.service';
import { NovoCampeonatoModalComponent } from './novo-campeonato-modal/novo-campeonato-modal.component';
import { DuplicarCampeonatoModalComponent } from './duplicar-campeonato-modal/duplicar-campeonato-modal.component';

@Component({
  selector: 'app-meus-campeonatos',
  templateUrl: './meus-campeonatos.page.html',
  styleUrls: ['./meus-campeonatos.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class MeusCampeonatosPage implements OnInit, OnDestroy {
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly usersSrv = inject(UsersService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  /** Inclui campeonatos próprios + onde o user é moderador.
   *  Moderadores agora também enxergam os campeonatos que ajudam. */
  readonly campeonatos$: Observable<Campeonato[]> = this.campeonatosSrv.listMeusEModerados$();

  /** True se o user logado é moderador (tipo='moderador'). Usado pra
   *  esconder o botão "Novo campeonato" — moderador não cria campeonatos,
   *  só ajuda nos do dono. Inclui mensagem de empty-state diferente. */
  readonly ehModerador$: Observable<boolean> = this.usersSrv.profile$().pipe(
    map(p => p?.tipo === 'moderador'),
    startWith(false),
    catchError(() => of(false)),
  );

  /** Cache pra não rodar a migração mais de uma vez por ID. */
  private migrados = new Set<string>();
  private sub?: Subscription;

  /** Estado do diagnóstico (aberto via botão no empty-state do moderador). */
  diagAberto = false;
  diagCarregando = false;
  diagResultado?: Awaited<ReturnType<typeof this.campeonatosSrv.diagnosticarAcessoModerador>>;

  ngOnInit(): void {
    // Quando a lista chegar, migra retroativamente quem está sem o campo `publico`
    // (campeonatos criados antes do flag existir não apareciam na home pública).
    this.sub = this.campeonatos$.subscribe(list => {
      for (const c of list) {
        if (!c.id || this.migrados.has(c.id)) continue;
        if (c.publico === undefined) {
          this.migrados.add(c.id);
          this.campeonatosSrv
            .atualizar(c.id, { publico: true })
            .catch(err => console.error('[MeusCampeonatos] migração publico erro', err));
        } else {
          this.migrados.add(c.id);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async novoCampeonato(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: NovoCampeonatoModalComponent,
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ created?: boolean }>();
    if (data?.created) {
      const t = await this.toastCtrl.create({
        message: 'Campeonato criado!',
        duration: 2200,
        position: 'top',
        color: 'success',
      });
      await t.present();
    }
  }

  /**
   * Abre o modal "Criar sequência" (duplicar campeonato). O user escolhe o que
   * copiar: seguidores, equipes, jogadores (depende de equipes), partidas
   * (depende de equipes). Em sucesso, o modal já redireciona pro novo campeonato.
   *
   * Chamado pelo botão de ícone "copy-outline" na linha de cada campeonato.
   * O `stopPropagation` evita que o click bubble pra o `<a>` que envolve a row
   * (que abriria o campeonato em vez de o modal).
   */
  async duplicarCampeonato(c: Campeonato, ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const modal = await this.modalCtrl.create({
      component: DuplicarCampeonatoModalComponent,
      componentProps: { original: c },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ created?: boolean }>();
    if (data?.created) {
      const t = await this.toastCtrl.create({
        message: 'Sequência criada!',
        duration: 2200,
        position: 'top',
        color: 'success',
      });
      await t.present();
    }
  }

  trackById(_i: number, c: Campeonato): string {
    return c.id ?? '';
  }

  /**
   * Roda diagnóstico mostrando UID, email e o que cada estratégia
   * de descoberta retornou. Útil pra moderador entender por que
   * nenhum campeonato apareceu.
   */
  async diagnosticarAcesso(): Promise<void> {
    this.diagAberto = true;
    this.diagCarregando = true;
    this.diagResultado = undefined;
    try {
      const profile = await import('rxjs').then(rx =>
        rx.firstValueFrom(this.usersSrv.profile$()),
      );
      const uid = profile?.uid || '';
      const email = profile?.email || null;
      if (!uid) {
        this.diagCarregando = false;
        return;
      }
      this.diagResultado = await this.campeonatosSrv.diagnosticarAcessoModerador(uid, email);
    } catch (err) {
      console.error('[MeusCampeonatos] diag erro', err);
    } finally {
      this.diagCarregando = false;
    }
  }

  fecharDiag(): void {
    this.diagAberto = false;
  }

  /**
   * Copia a URL pública do campeonato pro clipboard.
   *
   * Prioridade do identificador da URL (mesma lógica de `slugEfetivo()`
   * em config.page.ts pra os links ficarem consistentes):
   *   1) `slug` custom definido pelo dono
   *   2) `shortCode` aleatório auto-gerado
   *   3) `id` do Firestore como fallback final
   *
   * O `stopPropagation`/`preventDefault` no template já bloqueia a
   * navegação pra dentro do campeonato — aqui só fazemos o trabalho real.
   */
  async copiarLink(c: Campeonato, ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof window === 'undefined') return;

    const id = (c.slug?.trim() || c.shortCode || c.id || '').trim();
    if (!id) {
      await this.exibirToast('Campeonato sem link público ainda.', 'warning');
      return;
    }

    const url = `${window.location.origin}/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      await this.exibirToast('Link copiado!', 'success');
    } catch {
      // Fallback: alguns browsers (ou contextos sem HTTPS) bloqueiam
      // `clipboard.writeText`. Mostra o link no toast pro usuário copiar
      // manualmente em vez de falhar silenciosamente.
      await this.exibirToast(url, 'success');
    }
  }

  private async exibirToast(message: string, color: 'success' | 'warning' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
