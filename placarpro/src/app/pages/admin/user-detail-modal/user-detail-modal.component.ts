import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ModalController, ToastController, AlertController } from '@ionic/angular';
import { Observable, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { ConvitesEquipeService, MeuConvite } from '../../../campeonatos/convites-equipe.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { TipoConta, UserProfile } from '../../../users/models/user-profile.model';
import { PlanosService, PlanoDef, PlanoId } from '../../../users/planos.service';
import { UsersService } from '../../../users/users.service';

/**
 * Modal de detalhes do usuário no painel Admin Master.
 *
 * Responsabilidades:
 *  - Mostrar info do user (avatar, UID, tipo, plano, isMaster, status)
 *  - **Editar dados** (nome, email, telefone, cidade, sobre, tipo) inline
 *  - **Alterar plano** (dropdown + Salvar)
 *  - **Tornar/remover Admin Master** com confirmação
 *  - **Bloquear/desbloquear** (soft block, reversível)
 *  - **Banir/desbanir** com motivo registrado
 *  - Listar campeonatos do user + fichas vinculadas
 */
@Component({
  selector: 'app-user-detail-modal',
  templateUrl: './user-detail-modal.component.html',
  styleUrls: ['./user-detail-modal.component.scss'],
  standalone: false,
})
export class UserDetailModalComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly modalCtrl = inject(ModalController);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly convitesSrv = inject(ConvitesEquipeService);
  private readonly planosSrv = inject(PlanosService);
  private readonly usersSrv = inject(UsersService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  @Input() usuario!: UserProfile;

  campeonatosDoUsuario$: Observable<Campeonato[]> = of([]);
  meusConvites$: Observable<MeuConvite[]> = of([]);

  /** Catálogo de planos pra dropdown. */
  readonly planos: ReadonlyArray<PlanoDef> = [];

  /** Plano selecionado no dropdown (controlado). */
  planoSelecionado: PlanoId = 'gratis';

  /** Flags de loading granulares — cada ação tem o seu pra não bloquear
   *  todos os botões enquanto uma operação roda. */
  salvandoPlano = false;
  salvandoAdmin = false;
  salvandoDados = false;
  alternandoBloqueio = false;
  alternandoBan = false;
  alternandoValidacaoMod = false;
  salvandoTx = false;

  /** Delta de transmissões extras a aplicar (+N / -N). Resetado após salvar. */
  deltaTransmissoes = 0;

  /** Form de edição de dados — campos liberados pro admin alterar. */
  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    email: ['', [Validators.email]],
    telefone: ['', [Validators.maxLength(30)]],
    cidade: ['', [Validators.maxLength(80)]],
    sobre: ['', [Validators.maxLength(500)]],
    tipo: ['cliente'],
  });

  readonly tiposConta: { value: TipoConta; label: string }[] = [
    { value: 'organizador', label: 'Organizador' },
    { value: 'cliente',     label: 'Cliente (espectador)' },
    { value: 'moderador',   label: 'Moderador' },
    { value: 'racha',       label: 'Racha (pelada)' },
  ];

  /** Preços unitários dos créditos (editáveis no admin → Valores). */
  get precoCreditoNormal(): number { return this.planosSrv.precoCreditoNormal; }
  get precoCreditoPremium(): number { return this.planosSrv.precoCreditoPremium; }
  get precoTransmissaoAvulsa(): number { return this.planosSrv.VALOR_TRANSMISSAO_AVULSA; }

  constructor() {
    this.planos = inject(PlanosService).planos;
  }

  ngOnInit(): void {
    if (!this.usuario) return;
    this.planoSelecionado = (this.usuario.plano ?? 'gratis') as PlanoId;

    // Patch inicial — preserva valores sem mexer no doc remoto até o
    // admin clicar em "Salvar dados".
    this.form.patchValue({
      nome: this.usuario.nome ?? '',
      email: this.usuario.email ?? '',
      telefone: this.usuario.telefone ?? '',
      cidade: this.usuario.cidade ?? '',
      sobre: this.usuario.sobre ?? this.usuario.bio ?? '',
      tipo: this.usuario.tipo ?? 'cliente',
    });

    // Campeonatos onde esse usuário é dono (filtra client-side da lista global)
    this.campeonatosDoUsuario$ = this.campsSrv.listAllSystem$().pipe(
      map(arr => arr.filter(c => c.ownerId === this.usuario.uid)),
      catchError(() => of([] as Campeonato[])),
      startWith([] as Campeonato[]),
    );

    // Convites/fichas vinculadas a esse usuário (subcoleção meusConvites)
    this.meusConvites$ = this.convitesSrv.listMeusConvites$(this.usuario.uid).pipe(
      catchError(() => of([] as MeuConvite[])),
      startWith([] as MeuConvite[]),
    );
  }

  // ============ Helpers de validação ============
  invalido(nome: string): boolean {
    const c = this.form.get(nome);
    return !!c && c.invalid && (c.touched || c.dirty);
  }
  erroDe(nome: string): string {
    const c = this.form.get(nome);
    if (!c?.errors) return '';
    if (c.errors['required'])  return 'Campo obrigatório.';
    if (c.errors['email'])     return 'Email inválido.';
    if (c.errors['minlength']) return `Mínimo ${c.errors['minlength'].requiredLength} caracteres.`;
    if (c.errors['maxlength']) return `Máximo ${c.errors['maxlength'].requiredLength} caracteres.`;
    return 'Valor inválido.';
  }

  // ============ Salvar dados do form ============
  async salvarDados(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Verifique os campos destacados.', 'danger');
      return;
    }
    this.salvandoDados = true;
    try {
      const v = this.form.getRawValue();
      const patch: Partial<UserProfile> = {
        nome: v.nome.trim(),
        email: (v.email || '').trim(),
        telefone: (v.telefone || '').trim(),
        cidade: (v.cidade || '').trim(),
        sobre: (v.sobre || '').trim(),
        tipo: v.tipo as TipoConta,
      };
      await this.usersSrv.adminAtualizarUser(this.usuario.uid, patch);
      // Espelha no objeto local pra UI refletir imediatamente.
      Object.assign(this.usuario, patch);
      await this.toast('Dados atualizados.', 'success');
    } catch (err) {
      console.error('[UserDetail] salvarDados erro', err);
      await this.toast('Falha ao salvar dados.', 'danger');
    } finally {
      this.salvandoDados = false;
    }
  }

  // ============ Plano ============
  ajustarTransmissoesExtras(delta: number): void {
    const saldoAtual = (this.usuario.transmissoesExtras ?? 0);
    // Não permite que o total final (saldo + delta proposto) fique negativo
    const novoTotal  = saldoAtual + this.deltaTransmissoes + delta;
    if (novoTotal < 0) return;
    this.deltaTransmissoes += delta;
  }

  async salvarTransmissoesExtras(): Promise<void> {
    if (this.deltaTransmissoes === 0) return;
    this.salvandoTx = true;
    try {
      await this.usersSrv.updateTransmissoesExtras(this.usuario.uid, this.deltaTransmissoes);
      this.usuario.transmissoesExtras = (this.usuario.transmissoesExtras ?? 0) + this.deltaTransmissoes;
      this.deltaTransmissoes = 0;
      await this.toast(
        `Transmissões extras atualizadas. Saldo: ${this.usuario.transmissoesExtras}`,
        'success',
      );
    } catch (err) {
      console.error('[UserDetail] erro tx extras', err);
      await this.toast('Falha ao atualizar transmissões.', 'danger');
    } finally {
      this.salvandoTx = false;
    }
  }

  // ============ Créditos de patrocínio (ads) ============
  salvandoCreditos = false;
  deltaCreditos = 0;

  ajustarCreditosPatrocinio(delta: number): void {
    const saldoAtual = (this.usuario.creditosPatrocinio ?? 0);
    const novoTotal = saldoAtual + this.deltaCreditos + delta;
    if (novoTotal < 0) return;
    this.deltaCreditos += delta;
  }

  async salvarCreditosPatrocinio(): Promise<void> {
    if (this.deltaCreditos === 0) return;
    this.salvandoCreditos = true;
    try {
      await this.usersSrv.updateCreditosPatrocinio(this.usuario.uid, this.deltaCreditos);
      this.usuario.creditosPatrocinio = (this.usuario.creditosPatrocinio ?? 0) + this.deltaCreditos;
      this.deltaCreditos = 0;
      await this.toast(
        `Créditos atualizados. Saldo: ${this.usuario.creditosPatrocinio}`,
        'success',
      );
    } catch (err) {
      console.error('[UserDetail] erro créditos', err);
      await this.toast('Falha ao atualizar créditos.', 'danger');
    } finally {
      this.salvandoCreditos = false;
    }
  }

  // ============ Créditos PREMIUM (banner vertical 9:16) ============
  salvandoCreditosPremium = false;
  deltaCreditosPremium = 0;

  ajustarCreditosPremium(delta: number): void {
    const saldoAtual = (this.usuario.creditosPatrocinioPremium ?? 0);
    const novoTotal = saldoAtual + this.deltaCreditosPremium + delta;
    if (novoTotal < 0) return;
    this.deltaCreditosPremium += delta;
  }

  async salvarCreditosPremium(): Promise<void> {
    if (this.deltaCreditosPremium === 0) return;
    this.salvandoCreditosPremium = true;
    try {
      await this.usersSrv.updateCreditosPatrocinioPremium(this.usuario.uid, this.deltaCreditosPremium);
      this.usuario.creditosPatrocinioPremium = (this.usuario.creditosPatrocinioPremium ?? 0) + this.deltaCreditosPremium;
      this.deltaCreditosPremium = 0;
      await this.toast(
        `Créditos PREMIUM atualizados. Saldo: ${this.usuario.creditosPatrocinioPremium}`,
        'success',
      );
    } catch (err) {
      console.error('[UserDetail] erro créditos premium', err);
      await this.toast('Falha ao atualizar créditos premium.', 'danger');
    } finally {
      this.salvandoCreditosPremium = false;
    }
  }

  async salvarPlano(): Promise<void> {
    const planoAtual = (this.usuario.plano ?? 'gratis') as PlanoId;
    if (this.planoSelecionado === planoAtual) {
      await this.toast('O plano selecionado já é o atual.', 'medium');
      return;
    }
    this.salvandoPlano = true;
    try {
      await this.planosSrv.alterarPlanoDoUsuario(this.usuario.uid, this.planoSelecionado);
      this.usuario.plano = this.planoSelecionado;

      // NOTA: o plano NÃO concede mais créditos de transmissão. Os créditos
      // de transmissão vêm exclusivamente da compra avulsa ("Crédito de
      // transmissão" em /app/meus-creditos), gravada em `transmissoesExtras`.
      // Por isso não mexemos em `transmissoesExtras` ao alterar o plano.
      const newDef = this.planosSrv.getPlanoDef(this.planoSelecionado);
      await this.toast(
        `Plano alterado para "${newDef.label}".`,
        'success',
      );
    } catch (err) {
      console.error('[UserDetail] erro alterando plano', err);
      await this.toast('Falha ao alterar plano. Verifique as Firestore Rules.', 'danger');
    } finally {
      this.salvandoPlano = false;
    }
  }

  // ============ Admin Master ============
  async toggleAdminMaster(): Promise<void> {
    const novoEstado = !this.usuario.isMaster;
    const alert = await this.alertCtrl.create({
      header: novoEstado ? 'Promover a Admin Master?' : 'Remover Admin Master?',
      message: novoEstado
        ? `${this.usuario.nome || this.usuario.uid} terá acesso TOTAL ao painel /app/admin e poderá ver todos os dados do sistema.`
        : `${this.usuario.nome || this.usuario.uid} perderá acesso ao painel /app/admin.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Confirmar',
          role: 'destructive',
          handler: async () => {
            this.salvandoAdmin = true;
            try {
              await this.usersSrv.toggleUserIsMaster(this.usuario.uid, novoEstado);
              this.usuario.isMaster = novoEstado;
              await this.toast(
                novoEstado ? 'Usuário promovido a Admin Master.' : 'Privilégios de admin removidos.',
                'success',
              );
            } catch (err) {
              console.error('[UserDetail] erro toggleAdmin', err);
              await this.toast('Falha ao atualizar permissões.', 'danger');
            } finally {
              this.salvandoAdmin = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ============ Validar/revogar moderador (admin master) ============
  /**
   * Liga/desliga o flag `moderadorValidado`. Quando moderador se cadastra
   * sem código de convite, fica pendente. Admin valida aqui pra ativar
   * os privilégios de moderação.
   */
  async toggleModeradorValidado(): Promise<void> {
    const novoEstado = !this.usuario.moderadorValidado;
    const alert = await this.alertCtrl.create({
      header: novoEstado ? 'Validar moderador?' : 'Revogar validação?',
      message: novoEstado
        ? `${this.usuario.nome || this.usuario.uid} passará a poder exercer ações de moderação nos campeonatos onde foi convidado.`
        : `${this.usuario.nome || this.usuario.uid} perderá privilégios de moderação até ser validado novamente.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: novoEstado ? 'Validar' : 'Revogar',
          role: novoEstado ? undefined : 'destructive',
          handler: async () => {
            this.alternandoValidacaoMod = true;
            try {
              await this.usersSrv.setModeradorValidado(this.usuario.uid, novoEstado);
              this.usuario.moderadorValidado = novoEstado;
              await this.toast(
                novoEstado ? 'Moderador validado.' : 'Validação revogada.',
                'success',
              );
            } catch (err) {
              console.error('[UserDetail] erro toggleModeradorValidado', err);
              await this.toast('Falha ao atualizar.', 'danger');
            } finally {
              this.alternandoValidacaoMod = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ============ Bloquear (soft, reversível) ============
  async toggleBloqueio(): Promise<void> {
    const novoEstado = !this.usuario.bloqueado;
    const alert = await this.alertCtrl.create({
      header: novoEstado ? 'Bloquear conta?' : 'Desbloquear conta?',
      message: novoEstado
        ? `${this.usuario.nome || this.usuario.uid} não conseguirá acessar a área autenticada até ser desbloqueado. Os dados são preservados.`
        : `${this.usuario.nome || this.usuario.uid} voltará a ter acesso normal ao sistema.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: novoEstado ? 'Bloquear' : 'Desbloquear',
          role: novoEstado ? 'destructive' : undefined,
          handler: async () => {
            this.alternandoBloqueio = true;
            try {
              await this.usersSrv.setBloqueado(this.usuario.uid, novoEstado);
              this.usuario.bloqueado = novoEstado;
              await this.toast(
                novoEstado ? 'Conta bloqueada.' : 'Conta desbloqueada.',
                'success',
              );
            } catch (err) {
              console.error('[UserDetail] erro toggleBloqueio', err);
              await this.toast('Falha ao alterar bloqueio.', 'danger');
            } finally {
              this.alternandoBloqueio = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ============ Banir (severo, com motivo) ============
  async banir(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Banir esta conta?',
      message:
        'Ação severa — o usuário não poderá mais entrar e o motivo ' +
        'fica registrado. Diferente de bloquear (reversível sem motivo).',
      inputs: [
        {
          name: 'motivo',
          type: 'textarea',
          placeholder: 'Motivo do banimento (ex.: spam, fraude, abuso...)',
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Banir',
          role: 'destructive',
          handler: async (data: { motivo: string }) => {
            const motivo = (data.motivo || '').trim();
            if (motivo.length < 5) {
              await this.toast('Informe um motivo (mínimo 5 caracteres).', 'danger');
              return false;
            }
            this.alternandoBan = true;
            try {
              await this.usersSrv.setBanido(this.usuario.uid, true, motivo);
              this.usuario.banido = true;
              this.usuario.banidoMotivo = motivo;
              await this.toast('Conta banida.', 'success');
            } catch (err) {
              console.error('[UserDetail] erro banir', err);
              await this.toast('Falha ao banir conta.', 'danger');
            } finally {
              this.alternandoBan = false;
            }
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async desbanir(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remover banimento?',
      message: `${this.usuario.nome || this.usuario.uid} voltará a ter acesso ao sistema. O motivo do banimento anterior fica no histórico.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover ban',
          handler: async () => {
            this.alternandoBan = true;
            try {
              await this.usersSrv.setBanido(this.usuario.uid, false);
              this.usuario.banido = false;
              await this.toast('Banimento removido.', 'success');
            } catch (err) {
              console.error('[UserDetail] erro desbanir', err);
              await this.toast('Falha ao remover banimento.', 'danger');
            } finally {
              this.alternandoBan = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ============ Helpers ============
  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'top',
      color,
    });
    await t.present();
  }

  fechar(abrirCampeonatoId?: string): void {
    this.modalCtrl.dismiss(abrirCampeonatoId ? { abrirCampeonatoId } : undefined);
  }

  abrirCampeonato(c: Campeonato): void {
    this.fechar(c.id);
  }

  iconTipo(tipo?: string): string {
    switch (tipo) {
      case 'organizador': return 'briefcase-outline';
      case 'moderador':   return 'shield-outline';
      case 'cliente':     return 'person-outline';
      case 'racha':       return 'football-outline';
      default:            return 'help-circle-outline';
    }
  }

  /** Copia o UID pra clipboard — útil pro admin colar em outros lugares. */
  async copiarUid(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.usuario.uid);
      await this.toast('UID copiado.', 'success');
    } catch {
      await this.toast('Falha ao copiar.', 'danger');
    }
  }
}
