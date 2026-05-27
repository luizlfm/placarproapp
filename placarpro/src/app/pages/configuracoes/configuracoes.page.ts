import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ToastController,
} from '@ionic/angular';
import {
  Auth,
  User,
  sendPasswordResetEmail,
  updateProfile,
} from '@angular/fire/auth';
import { Observable } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { StorageService } from '../../shared/storage.service';
import { NavBackService } from '../../shared/nav-back.service';
import { UsersService } from '../../users/users.service';
import { UserProfile } from '../../users/models/user-profile.model';

/**
 * Configurações Gerais do Organizador — TELA DE EDIÇÃO DE DADOS.
 *
 * Diferente da "Página do organizador" (`/app/organizador`), que é o
 * perfil PÚBLICO mostrado aos visitantes. Aqui o organizador edita
 * seus dados PESSOAIS (nome, telefone, foto, etc.) — campos visíveis
 * inline com botão "Salvar" no rodapé, em vez de popups de alerta.
 *
 * O perfil é persistido em `users/{uid}` via `UsersService.saveProfile()`
 * (merge). O `displayName` e `photoURL` do Firebase Auth também são
 * atualizados quando o usuário muda nome/foto — assim o nome novo aparece
 * em outras telas que leem direto do Auth (sidebar, mobile-header).
 */
@Component({
  selector: 'app-configuracoes',
  templateUrl: './configuracoes.page.html',
  styleUrls: ['./configuracoes.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class ConfiguracoesPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  /** `Auth` direto pra resetPassword — AuthService.auth é private. */
  private readonly fbAuth = inject(Auth);
  private readonly storage = inject(StorageService);
  private readonly usersSrv = inject(UsersService);
  private readonly router = inject(Router);
  /** Navegação "voltar" — usa histórico do browser com fallback explícito.
   *  Padrão UX adotado em todo o sistema: após salvar com sucesso, volta
   *  pra tela anterior em vez de deixar o user re-clicar no botão voltar. */
  private readonly navBack = inject(NavBackService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);

  readonly user$: Observable<User | null> = this.auth.user$;
  /** Stream do doc `users/{uid}` — fonte da verdade pros campos custom. */
  readonly profile$ = this.usersSrv.profile$();

  /** Versão do app — exibida em "Sobre". */
  readonly versao = '1.0.0';

  /** Form principal — campos espelham `UserProfile`. Email fica fora do
   *  form (só pra exibir; alterar email exige reauth + verificação).
   *
   *  Validadores opt-in nos campos opcionais: se o user PREENCHER, valida.
   *  Se deixar vazio, passa. Padrões:
   *   - telefone/whatsapp: 8-15 dígitos (qualquer formatação)
   *   - site: URL com http(s)
   *   - sobre: até 500 char
   */
  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    telefone: ['', [Validators.pattern(/^[\d\s()+-]{0,30}$/)]],
    cidade: ['', [Validators.maxLength(80)]],
    sobre: ['', [Validators.maxLength(500)]],
    instagram: ['', [Validators.maxLength(60)]],
    whatsapp: ['', [Validators.pattern(/^[\d\s()+-]{0,30}$/)]],
    facebook: ['', [Validators.maxLength(120)]],
    site: ['', [Validators.pattern(/^(https?:\/\/)?[^\s]+\.[^\s]+$/)]],
    fotoUrl: [''],
  });

  /** Lista de campos obrigatórios — usada pra hint no header do form
   *  "Campos com * são obrigatórios". Centraliza em um lugar pra evitar
   *  inconsistência entre o asterisk no label e a validação real. */
  readonly camposObrigatorios = ['nome'] as const;

  /** Helper template — retorna `true` quando o controle está inválido E
   *  já foi tocado (ou form foi submetido). Evita mostrar erro logo de
   *  cara antes do user interagir. */
  invalido(nome: string): boolean {
    const c = this.form.get(nome);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  /** Texto de erro pra cada campo — mapeado pelo tipo de validator que
   *  falhou. Adicione novos casos aqui conforme novos validators forem
   *  introduzidos no form. */
  erroDe(nome: string): string {
    const c = this.form.get(nome);
    if (!c || !c.errors) return '';
    if (c.errors['required'])  return 'Campo obrigatório.';
    if (c.errors['minlength']) {
      const min = c.errors['minlength'].requiredLength;
      return `Mínimo ${min} caracteres.`;
    }
    if (c.errors['maxlength']) {
      const max = c.errors['maxlength'].requiredLength;
      return `Máximo ${max} caracteres.`;
    }
    if (c.errors['pattern']) {
      if (nome === 'site') return 'URL inválida (ex: https://exemplo.com).';
      if (nome === 'telefone' || nome === 'whatsapp') return 'Telefone inválido.';
      return 'Formato inválido.';
    }
    return 'Valor inválido.';
  }

  /** Flag pra desabilitar o botão Salvar durante a requisição. */
  salvando = false;
  /** Indica se já carregamos o profile do Firestore (evita patchValue
   *  duplicado quando o stream emite várias vezes). */
  private carregado = false;

  ngOnInit(): void {
    this.profile$.subscribe(p => {
      if (this.carregado) return;
      const u = this.auth.currentUser;
      this.form.patchValue({
        // Prioridade: profile.nome (Firestore) → Auth.displayName → email.
        nome: p?.nome ?? u?.displayName ?? '',
        telefone: p?.telefone ?? '',
        cidade: p?.cidade ?? '',
        sobre: p?.sobre ?? p?.bio ?? '',
        instagram: p?.redes?.instagram ?? '',
        whatsapp: p?.redes?.whatsapp ?? '',
        facebook: p?.redes?.facebook ?? '',
        site: p?.redes?.site ?? '',
        // logoUrl/fotoUrl — preferimos logoUrl (mais novo) mas caímos
        // no fotoUrl legacy ou no photoURL do Auth.
        fotoUrl: p?.logoUrl ?? p?.fotoUrl ?? u?.photoURL ?? '',
      });
      this.carregado = true;
    });
  }

  // ============ Foto avatar ============

  /** Abre file picker → upload pro Storage → atualiza form + Auth.
   *  O `Auth.photoURL` é atualizado pra o nome/foto novos refletirem
   *  imediatamente em qualquer tela que leia `auth.user$.photoURL`
   *  (sidebar, mobile-header, etc.) sem precisar de reload. */
  async trocarFoto(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    const file = await new Promise<File | null>(resolve => {
      input.onchange = () => {
        const f = input.files?.[0] ?? null;
        document.body.removeChild(input);
        resolve(f);
      };
      window.addEventListener(
        'focus',
        () => setTimeout(() => {
          if (document.body.contains(input)) {
            document.body.removeChild(input);
            resolve(null);
          }
        }, 1000),
        { once: true },
      );
      input.click();
    });
    if (!file) return;

    const loader = await this.loadingCtrl.create({ message: 'Enviando foto...' });
    await loader.present();
    try {
      const url = await this.storage.uploadUserAsset('avatar', file);
      this.form.patchValue({ fotoUrl: url });
      // Auth photoURL — pra refletir imediatamente nas outras telas.
      await updateProfile(user, { photoURL: url });
      await this.toast('Foto enviada! Não esqueça de salvar.', 'success');
    } catch (err) {
      console.error('[Config] trocarFoto erro', err);
      await this.toast('Falha no upload (verifique permissões).', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  // ============ Salvar form ============
  async salvar(): Promise<void> {
    if (this.form.invalid) {
      // Marca tudo como `touched` pra os erros aparecerem (sem isso, só
      // os campos que o user tocou exibem mensagem).
      this.form.markAllAsTouched();
      // Lista de campos com erro pra mostrar quais são, no toast.
      const invalidos = Object.keys(this.form.controls)
        .filter(k => this.form.get(k)?.invalid)
        .map(k => this.rotuloDe(k));
      const lista = invalidos.slice(0, 3).join(', ');
      const sufixo = invalidos.length > 3 ? ` e mais ${invalidos.length - 3}` : '';
      await this.toast(
        `Verifique: ${lista}${sufixo}.`,
        'danger',
      );
      // Scroll pro primeiro campo inválido (UX: o user vê onde o erro está).
      this.scrollParaPrimeiroInvalido();
      return;
    }
    const user = this.auth.currentUser;
    if (!user) return;

    const v = this.form.getRawValue();
    // Firestore rejeita `undefined` em qualquer field — gera o patch
    // OMITINDO campos vazios em vez de enviar `undefined`. Use string
    // vazia '' como "limpo" pros casos onde o user quis APAGAR o valor;
    // pra distinguir "não preencheu" de "esvaziou", aqui sempre sobrescreve
    // com a string trimada (vazia se o input está vazio).
    const patch: Partial<UserProfile> = {
      nome: v.nome.trim(),
      telefone: (v.telefone || '').trim(),
      cidade: (v.cidade || '').trim(),
      sobre: (v.sobre || '').trim(),
      redes: {
        instagram: (v.instagram || '').trim(),
        whatsapp: (v.whatsapp || '').trim(),
        facebook: (v.facebook || '').trim(),
        site: (v.site || '').trim(),
      },
    };
    // Só inclui `logoUrl` quando há valor — evita gravar `undefined` ou
    // sobrescrever uma URL existente com string vazia (que apagaria a foto
    // sem o user pedir explicitamente).
    if (v.fotoUrl) {
      patch.logoUrl = v.fotoUrl;
    }

    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    this.salvando = true;
    try {
      await this.usersSrv.saveProfile(patch);
      // displayName do Auth — espelha o nome pra outras telas (sidebar
      // mostra `user.displayName`, não lê do users/{uid}).
      if (user.displayName !== patch.nome) {
        await updateProfile(user, { displayName: patch.nome });
      }
      await this.toast('Configurações salvas!', 'success');
      // Volta pra tela anterior — padrão UX: salvou, encerra o fluxo de
      // edição. Fallback `/app/meus-campeonatos` cobre o caso do user
      // ter entrado direto via URL/bookmark (sem histórico).
      this.navBack.back('/app/meus-campeonatos');
    } catch (err) {
      console.error('[Config] salvar erro', err);
      await this.toast('Não foi possível salvar.', 'danger');
    } finally {
      this.salvando = false;
      await loader.dismiss();
    }
  }

  // ============ Segurança ============

  async resetarSenha(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user?.email) {
      await this.toast('Conta sem email (login Google/Apple) — sem senha pra alterar.', 'medium');
      return;
    }
    const confirm = await this.alertCtrl.create({
      header: 'Redefinir senha',
      message: `Enviaremos um link pra <strong>${user.email}</strong> pra você criar uma nova senha.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Enviar link',
          handler: async () => {
            try {
              await sendPasswordResetEmail(this.fbAuth, user.email!);
              await this.toast('Link enviado! Confira o email.', 'success');
            } catch (err) {
              console.error('[Config] resetarSenha erro', err);
              await this.toast('Não foi possível enviar.', 'danger');
            }
            return true;
          },
        },
      ],
    });
    await confirm.present();
  }

  async sair(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sair da conta?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Sair',
          role: 'destructive',
          handler: async () => {
            await this.auth.signOut();
            await this.router.navigateByUrl('/', { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }

  // ============ Zona de perigo ============
  async deletarConta(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Deletar conta?',
      message:
        'Esta ação NÃO PODE ser desfeita. Todos os seus dados ' +
        '(campeonatos, equipes, jogadores, mídias) serão removidos.<br><br>' +
        '<strong>Em breve</strong> — a deleção segura requer reautenticação ' +
        'e exclusão em cascata dos dados; aguarde a próxima atualização.',
      buttons: [{ text: 'Entendi', role: 'cancel' }],
    });
    await alert.present();
  }

  // ============ Suporte ============
  abrirSuporte(): void {
    window.open('mailto:suporte@placarpro.app?subject=Suporte%20PlacarPro', '_blank');
  }

  abrirWhatsApp(): void {
    window.open('https://wa.me/5582991027052?text=Olá!%20Preciso%20de%20suporte%20no%20PlacarPro.', '_blank');
  }

  // ============ Helpers ============
  initials(user: User | null): string {
    return (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  }

  /** Mapeia chave do form → rótulo amigável (usado no toast de erro). */
  private rotuloDe(chave: string): string {
    const labels: Record<string, string> = {
      nome: 'Nome',
      telefone: 'Telefone',
      cidade: 'Cidade',
      sobre: 'Sobre você',
      instagram: 'Instagram',
      whatsapp: 'WhatsApp',
      facebook: 'Facebook',
      site: 'Site',
    };
    return labels[chave] ?? chave;
  }

  /** Rola a viewport até o primeiro `[formControlName]` cujo controle
   *  está inválido. Procura no DOM via querySelector e usa `scrollIntoView`
   *  com block:'center' pra deixar o campo no meio da tela (mais visível
   *  do que no topo, onde fica colado no header). */
  private scrollParaPrimeiroInvalido(): void {
    const primeiroInvalido = Object.keys(this.form.controls).find(
      k => this.form.get(k)?.invalid,
    );
    if (!primeiroInvalido) return;
    setTimeout(() => {
      const el = document.querySelector(
        `[formControlName="${primeiroInvalido}"]`,
      ) as HTMLElement | null;
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Tenta focar o input nativo dentro do ion-input pra abrir o teclado.
        const native = el.querySelector('input, textarea') as HTMLElement | null;
        native?.focus?.();
      }
    }, 50);
  }

  private async toast(
    message: string,
    color: 'success' | 'danger' | 'medium' = 'success',
  ): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2500, position: 'top', color,
    });
    await t.present();
  }
}
