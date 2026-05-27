import { Component, Injector, OnInit, inject, runInInjectionContext } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ModalController, ToastController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { ConvitesModeradorService, ConviteModerador } from '../../campeonatos/convites-moderador.service';
import { CategoriasService } from '../../campeonatos/categorias.service';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { AuthService } from '../../auth/auth.service';
import { LoginModalComponent } from '../../auth/login-modal/login-modal.component';
import { Campeonato } from '../../campeonatos/campeonato.model';

/** Resposta da Cloud Function `resolverConviteModerador`. */
interface ResolverConviteResult {
  ok: boolean;
  motivo?: string;
  fonte?: 'espelho' | 'retroativo';
  campeonatoId?: string;
  categoriaId?: string;
  moderadorId?: string;
  nome?: string;
  email?: string;
  aceito?: boolean;
}

/**
 * Página de aceite do link mágico do moderador (`/m/:token`).
 *
 * Fluxo:
 *  1. Lê o token da URL
 *  2. Busca o convite em `convitesModerador/{token}`
 *  3. Se anônimo → mostra info + botão "Entrar para aceitar"
 *  4. Se logado → atualiza o `id` do moderador no array `categoria.moderadores`
 *     com o UID do user (assim ele passa a ser identificado pelo UID real,
 *     não pelo ID temporário gerado quando o organizador convidou)
 *  5. Redireciona pra `/app/campeonato/:campeonatoId/inicio`
 *
 * NÃO exige código de convite — o token na URL já é o "segredo".
 */
@Component({
  selector: 'app-aceitar-convite-moderador',
  templateUrl: './aceitar-convite-moderador.page.html',
  styleUrls: ['./aceitar-convite-moderador.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class AceitarConviteModeradorPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly convitesSrv = inject(ConvitesModeradorService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly authSrv = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly functions = inject(Functions);
  private readonly injector = inject(Injector);

  /** Sanitiza o token removendo caracteres não-alfanuméricos (ex: `http:` colado por engano). */
  private sanitizarToken(raw: string): string {
    return raw.replace(/[^A-Za-z0-9]/g, '');
  }

  /** Chama a Cloud Function `resolverConviteModerador` que tem privilégio admin. */
  private async chamarResolver(token: string): Promise<ResolverConviteResult> {
    return runInInjectionContext(this.injector, async () => {
      const fn = httpsCallable<{ token: string }, ResolverConviteResult>(
        this.functions, 'resolverConviteModerador',
      );
      const res = await fn({ token });
      return res.data;
    });
  }

  /**
   * Chama a CF `aceitarConviteModerador` que vincula o UID do user logado
   * ao moderador (com privilégio admin pra contornar as Firestore Rules).
   *
   * Por que via CF: o client não é dono do campeonato, então um write
   * direto em `categorias/{catId}.moderadores` ou `convitesModerador/{token}`
   * é bloqueado pelas rules. A CF roda com Admin SDK e faz todo o trabalho.
   */
  private async chamarAceitar(token: string): Promise<{
    ok: boolean;
    motivo?: string;
    campeonatoId?: string;
    categoriaId?: string;
  }> {
    return runInInjectionContext(this.injector, async () => {
      const fn = httpsCallable<
        { token: string },
        { ok: boolean; motivo?: string; campeonatoId?: string; categoriaId?: string }
      >(this.functions, 'aceitarConviteModerador');
      const res = await fn({ token });
      return res.data;
    });
  }

  loading = true;
  erro = false;
  errorMsg = '';
  aceitando = false;
  jaAceito = false;

  convite?: ConviteModerador;
  campeonato?: Campeonato;
  /** Email logado (mostrado na UI). */
  emailLogado?: string;

  async ngOnInit(): Promise<void> {
    const rawToken = this.route.snapshot.paramMap.get('token') ?? '';
    const token = this.sanitizarToken(rawToken);
    if (!token || token.length < 8) {
      this.erro = true;
      this.errorMsg = 'Token inválido.';
      this.loading = false;
      return;
    }

    try {
      // 1) Tenta direct read (caminho rápido — link novo com doc espelho)
      let conv = await firstValueFrom(this.convitesSrv.get$(token));

      // 2) Fallback — chama Cloud Function que varre via Admin SDK e cria
      //    o espelho retroativamente quando acha em um array antigo.
      if (!conv) {
        const result = await this.chamarResolver(token);
        if (!result.ok || !result.campeonatoId) {
          this.erro = true;
          this.errorMsg = result.motivo
            ?? 'Convite não encontrado ou expirado. Peça um novo link ao organizador.';
          return;
        }
        // Re-lê o espelho que a CF acabou de criar
        conv = await firstValueFrom(this.convitesSrv.get$(token));
        if (!conv) {
          // Cria objeto manual a partir da resposta da CF
          conv = {
            linkToken: token,
            campeonatoId: result.campeonatoId,
            categoriaId: result.categoriaId,
            moderadorId: result.moderadorId ?? '',
            nome: result.nome,
            email: result.email,
            criadoPor: '',
          };
        }
      }

      this.convite = conv;
      this.jaAceito = !!conv.aceitoEm;

      // 3) Busca o campeonato pra mostrar nome/info na UI
      this.campeonato = await firstValueFrom(this.campsSrv.get$(conv.campeonatoId));

      // 4) Se logado, mostra o email no card
      await this.authSrv.waitForAuthInit();
      this.emailLogado = this.authSrv.currentUser?.email ?? undefined;
    } catch (err) {
      console.error('[AceitarConviteMod] erro', err);
      this.erro = true;
      this.errorMsg = 'Não foi possível carregar o convite. Tente novamente em alguns segundos.';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Aceita o convite — vincula o UID do user logado ao `id` do moderador
   * no array da categoria. Sem login, abre o modal de login antes.
   */
  async aceitar(): Promise<void> {
    if (!this.convite) return;
    if (this.aceitando) return;

    // Sem login → abre login modal e retorna; o user clica de novo depois
    let userAtual = this.authSrv.currentUser;
    if (!userAtual) {
      const modal = await this.modalCtrl.create({
        component: LoginModalComponent,
        cssClass: 'modal-login',
        backdropDismiss: true,
      });
      await modal.present();
      await modal.onDidDismiss();
      userAtual = this.authSrv.currentUser;
      if (!userAtual) return; // user fechou sem logar
      this.emailLogado = (userAtual.email as string | null | undefined) ?? undefined;
    }

    this.aceitando = true;
    try {
      const { linkToken } = this.convite;
      if (!linkToken) {
        await this.toast('Token de convite inválido.', 'danger');
        return;
      }

      // Chama a CF — ela tem privilégio admin e faz TODO o trabalho:
      //  - Marca o convite como aceito
      //  - Atualiza o array `moderadores` na categoria/campeonato
      //    trocando o `mod-xxx` antigo pelo UID real do user logado
      //
      // Antes esse trabalho era feito direto no client (this.convitesSrv +
      // categoriasSrv/campsSrv), mas as Firestore Rules bloqueavam o write
      // porque o user moderador novo não é dono do campeonato.
      const result = await this.chamarAceitar(linkToken);
      if (!result.ok || !result.campeonatoId) {
        await this.toast(
          result.motivo ?? 'Erro ao aceitar convite. Tente novamente.',
          'danger',
        );
        return;
      }

      await this.toast('Acesso liberado! Você agora é moderador.', 'success');
      // Redireciona pro campeonato (área admin)
      await this.router.navigate(
        ['/app/campeonato', result.campeonatoId, 'inicio'],
        { replaceUrl: true },
      );
    } catch (err) {
      console.error('[AceitarConviteMod] aceitar erro', err);
      await this.toast('Erro ao aceitar convite. Tente novamente.', 'danger');
    } finally {
      this.aceitando = false;
    }
  }

  /**
   * Lê o doc da categoria, encontra o moderador com `moderadorId` original,
   * troca o `id` pelo UID real, e salva. Se moderador não existe mais
   * (organizador removeu), faz um insert.
   */
  private async vincularUidAoModeradorNaCategoria(
    campId: string, catId: string, moderadorIdAntigo: string, uid: string,
    nomeReal: string, emailReal: string | null | undefined,
  ): Promise<void> {
    const cat = await firstValueFrom(this.categoriasSrv.get$(campId, catId));
    if (!cat) throw new Error('Categoria não encontrada');
    const lista = Array.isArray(cat.moderadores) ? [...cat.moderadores] : [];
    const idx = lista.findIndex(m => typeof m !== 'string' && m.id === moderadorIdAntigo);
    if (idx >= 0) {
      const atual = lista[idx] as { id: string; nome?: string; email?: string };
      // Se já tem UID válido (alguém aceitou antes), só atualiza nome/email
      // se ainda estiverem vazios.
      const jaTinhaUid = !atual.id.startsWith('mod-') && !atual.id.startsWith('mod_');
      (lista[idx] as { id: string }).id = jaTinhaUid ? atual.id : uid;
      if (!atual.nome?.trim()) (lista[idx] as { nome: string }).nome = nomeReal;
      if (!atual.email && emailReal) (lista[idx] as { email: string }).email = emailReal;
      await this.categoriasSrv.atualizar(campId, catId, {
        moderadores: lista as unknown as string[],
      });
    }
  }

  /**
   * Versão pra moderador a nível de CAMPEONATO (não categoria).
   * Atualiza o array `campeonato.moderadores`.
   */
  private async vincularUidAoModeradorNoCampeonato(
    campId: string, moderadorIdAntigo: string, uid: string,
    nomeReal: string, emailReal: string | null | undefined,
  ): Promise<void> {
    const camp = await firstValueFrom(this.campsSrv.get$(campId));
    if (!camp) throw new Error('Campeonato não encontrado');
    const lista = Array.isArray(camp.moderadores) ? [...camp.moderadores] : [];
    const idx = lista.findIndex(m => m.id === moderadorIdAntigo);
    if (idx >= 0) {
      const atual = lista[idx];
      const jaTinhaUid = !atual.id.startsWith('mod-') && !atual.id.startsWith('mod_');
      lista[idx] = {
        ...atual,
        id: jaTinhaUid ? atual.id : uid,
        nome: atual.nome?.trim() || nomeReal,
        email: atual.email || emailReal || undefined,
      };
      await this.campsSrv.atualizar(campId, { moderadores: lista });
    }
  }

  voltarHome(): void {
    void this.router.navigate(['/']);
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2400, position: 'top', color,
    });
    await t.present();
  }
}
