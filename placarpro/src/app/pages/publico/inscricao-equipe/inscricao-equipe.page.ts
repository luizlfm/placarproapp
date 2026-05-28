import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { ConvitesEquipeService, ConviteEquipe } from '../../../campeonatos/convites-equipe.service';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { JogadoresService } from '../../../campeonatos/jogadores.service';
import { EquipesService } from '../../../campeonatos/equipes.service';
import { EquipeTecnicaService } from '../../../campeonatos/equipe-tecnica.service';
import { AuthService } from '../../../auth/auth.service';
import { LoginModalComponent } from '../../../auth/login-modal/login-modal.component';
import { Campeonato } from '../../../campeonatos/campeonato.model';
import { NavBackService } from '../../../shared/nav-back.service';
import { firstValueFrom } from 'rxjs';

interface LinhaAtleta {
  ordem: number;
  /** ID do jogador no Firestore (se já existir) — quando preenchido,
   *  submit faz UPDATE; vazio = CREATE. */
  jogadorId?: string;
  nome: string;
  documento: string;
  dataNascimento: string;
  /** Snapshot original pra detectar se houve mudança no submit. */
  original?: { nome: string; documento: string; dataNascimento: string };
}

interface MembroComissao {
  funcao: 'tecnico' | 'auxiliar' | 'assistente';
  funcaoLabel: string;
  /** ID do membro técnico (igual a LinhaAtleta.jogadorId). */
  membroId?: string;
  nome: string;
  documento: string;
}

/**
 * Página pública de inscrição de equipe — preenchimento do formulário pelo
 * dono/representante via link `/inscricao/:token`. Layout espelha o
 * formulário impresso oficial (20 linhas de atletas + comissão técnica
 * + representante).
 *
 * Login é obrigatório no momento do submit. Antes disso, o usuário pode
 * preencher livremente (estado fica no componente até confirmar).
 */
@Component({
  selector: 'app-inscricao-equipe',
  templateUrl: './inscricao-equipe.page.html',
  styleUrls: ['./inscricao-equipe.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class InscricaoEquipePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly convitesSrv = inject(ConvitesEquipeService);
  private readonly campsSrv = inject(CampeonatosService);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly tecnicaSrv = inject(EquipeTecnicaService);
  private readonly authSrv = inject(AuthService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly navBack = inject(NavBackService);

  readonly token = this.route.snapshot.paramMap.get('token') ?? '';

  loading = true;
  erro: string | null = null;
  convite?: ConviteEquipe;
  campeonato?: Campeonato;
  /** True quando dados existentes da equipe foram carregados (modo edição). */
  modoEdicao = false;

  /** Stream do user logado pra mostrar/esconder o form e o login wall. */
  readonly user$ = this.authSrv.user$;

  // Form state
  contato = '';
  atletas: LinhaAtleta[] = Array.from({ length: 20 }, (_, i) => ({
    ordem: i + 1,
    nome: '',
    documento: '',
    dataNascimento: '',
  }));
  comissao: MembroComissao[] = [
    { funcao: 'tecnico',    funcaoLabel: 'Técnico',           nome: '', documento: '' },
    { funcao: 'auxiliar',   funcaoLabel: 'Auxiliar Técnico',  nome: '', documento: '' },
    { funcao: 'assistente', funcaoLabel: 'Assistente',        nome: '', documento: '' },
  ];
  representanteNome = '';
  representanteRg = '';
  termoAceito = false;

  enviando = false;

  async ngOnInit(): Promise<void> {
    if (!this.token) {
      this.erro = 'Link inválido.';
      this.loading = false;
      return;
    }

    try {
      const convite = await this.convitesSrv.getByToken(this.token);
      if (!convite) {
        this.erro = 'Convite não encontrado. Confirme o link com o organizador.';
        return;
      }
      this.convite = convite;

      // Carrega o campeonato pra mostrar logo/cores no header
      this.campeonato = await firstValueFrom(this.campsSrv.get$(convite.campeonatoId));

      // Se já estiver logado:
      //  1) VINCULA o convite ao UID do usuário (cria users/{uid}/meusConvites/{token})
      //  2) Carrega dados existentes da equipe (modo edição)
      if (this.authSrv.currentUser) {
        try {
          await this.convitesSrv.vincularAoUsuario(
            this.token, this.authSrv.currentUser.uid, convite,
          );
        } catch (err) {
          console.warn('[InscricaoEquipe] vincular ao usuário falhou', err);
        }
        await this.carregarDadosExistentes();
      }

      // Restaura rascunho do localStorage SOMENTE quando não há dados
      // existentes no Firestore. Caso contrário, o rascunho (que pode
      // estar com linhas vazias) sobrescreveria os jogadores reais e
      // confundiria o usuário. Dados do Firestore têm prioridade.
      if (!this.modoEdicao) {
        this.restaurarRascunho();
      } else {
        // Em modo edição, descarta rascunho antigo pra evitar conflito
        // em alterações futuras.
        this.limparRascunho();
      }
    } catch (err) {
      console.error('[InscricaoEquipe] init erro', err);
      this.erro = 'Falha ao carregar o convite. Tente novamente.';
    } finally {
      this.loading = false;
    }
  }

  /**
   * Carrega jogadores + comissão técnica + dados da equipe que já existem
   * no Firestore. Pré-preenche o form em modo EDIÇÃO. As 20 linhas são
   * preenchidas em ordem; o que ultrapassar fica em linhas vazias livres.
   *
   * Cada query é tratada de forma INDEPENDENTE (`allSettled`) — se uma
   * falhar (ex: rules bloqueando equipeTecnica), as outras ainda
   * pré-populam normalmente. Antes usávamos `Promise.all`, então uma
   * falha em qualquer query zerava o pré-preenchimento inteiro.
   */
  private async carregarDadosExistentes(): Promise<void> {
    if (!this.convite) return;
    const { campeonatoId, categoriaId, equipeId } = this.convite;

    console.log('[InscricaoEquipe] carregando dados existentes', {
      campeonatoId, categoriaId, equipeId, uid: this.authSrv.currentUser?.uid,
    });

    const [resJogadores, resTecnica, resEquipe] = await Promise.allSettled([
      firstValueFrom(this.jogadoresSrv.listPorEquipe$(campeonatoId, categoriaId, equipeId)),
      firstValueFrom(this.tecnicaSrv.listPorEquipe$(campeonatoId, categoriaId, equipeId)),
      firstValueFrom(this.equipesSrv.get$(campeonatoId, categoriaId, equipeId)),
    ]);

    // ─── Jogadores ───
    if (resJogadores.status === 'fulfilled') {
      const jogadores = resJogadores.value;
      console.log('[InscricaoEquipe] jogadores carregados:', jogadores.length);
      // Pré-preenche linhas de atletas (ordena por numeroCamisa quando for número, senão por nome)
      const ordenados = [...jogadores].sort((a, b) => {
        const na = parseInt(a.numeroCamisa ?? '0', 10) || 9999;
        const nb = parseInt(b.numeroCamisa ?? '0', 10) || 9999;
        if (na !== nb) return na - nb;
        return (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR');
      });
      // Garante que temos linhas suficientes — se o time tem mais de 20
      // jogadores, expande o array. Senão usa o tamanho padrão (20).
      const totalLinhas = Math.max(this.atletas.length, ordenados.length);
      while (this.atletas.length < totalLinhas) {
        this.atletas.push({
          ordem: this.atletas.length + 1,
          nome: '', documento: '', dataNascimento: '',
        });
      }
      for (let i = 0; i < ordenados.length; i++) {
        const j = ordenados[i];
        const nome = j.nome ?? '';
        const documento = j.documento ?? '';
        const dataNascimento = j.dataNascimento ?? '';
        this.atletas[i] = {
          ordem: i + 1,
          jogadorId: j.id,
          nome, documento, dataNascimento,
          original: { nome, documento, dataNascimento },
        };
      }
      if (ordenados.length > 0) this.modoEdicao = true;
    } else {
      console.warn('[InscricaoEquipe] falha ao carregar jogadores', resJogadores.reason);
    }

    // ─── Comissão técnica ───
    if (resTecnica.status === 'fulfilled') {
      const tecnica = resTecnica.value;
      console.log('[InscricaoEquipe] comissão carregada:', tecnica.length);
      // Mapeia por função; se houver múltiplos do mesmo cargo, fica o primeiro.
      const buscar = (cargo: 'tecnico' | 'auxiliar' | 'assistente') => {
        if (cargo === 'assistente') {
          return tecnica.find(m => m.funcao === 'outro' && (m.funcaoOutro ?? '').toLowerCase().includes('assist'));
        }
        if (cargo === 'auxiliar') return tecnica.find(m => m.funcao === 'auxiliar');
        return tecnica.find(m => m.funcao === 'tecnico');
      };
      for (const m of this.comissao) {
        const existente = buscar(m.funcao);
        if (existente) {
          m.membroId = existente.id;
          m.nome = existente.nome ?? '';
          m.documento = existente.documento ?? '';
        }
      }
      if (tecnica.length > 0) this.modoEdicao = true;
    } else {
      console.warn('[InscricaoEquipe] falha ao carregar comissão técnica', resTecnica.reason);
    }

    // ─── Equipe (contato + representante) ───
    if (resEquipe.status === 'fulfilled') {
      const equipe = resEquipe.value;
      if (equipe) {
        this.contato = (equipe as any).contato ?? '';
        this.representanteNome = (equipe as any).representanteNome ?? '';
        this.representanteRg = (equipe as any).representanteRg ?? '';
        if (this.contato || this.representanteNome) this.modoEdicao = true;
      }
    } else {
      console.warn('[InscricaoEquipe] falha ao carregar equipe', resEquipe.reason);
    }
  }

  /**
   * Volta pra origem (página pública do campeonato ou histórico).
   * Quando aberto a partir da seção "Minha equipe" da página pública,
   * o caller passa `?from=publico&slug=XXX` — usamos essa info pra
   * voltar exatamente pra lá. Senão, usa o navBack com fallback pra
   * home pública.
   */
  voltar(): void {
    const from = this.route.snapshot.queryParamMap.get('from');
    const slug = this.route.snapshot.queryParamMap.get('slug');
    if (from === 'publico' && slug) {
      void this.router.navigate(['/', slug]);
      return;
    }
    this.navBack.back('/');
  }

  /**
   * Abre o LoginModal e — se o login funcionar — recarrega os dados
   * existentes da equipe. Chamado pelo botão "Entrar" do login wall.
   */
  async abrirLogin(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: LoginModalComponent,
      backdropDismiss: true,
      cssClass: 'modal-login',
    });
    await modal.present();
    await modal.onDidDismiss();
    if (this.authSrv.currentUser && this.convite) {
      // Logou! Vincula o convite ao UID e carrega dados existentes
      try {
        await this.convitesSrv.vincularAoUsuario(
          this.token, this.authSrv.currentUser.uid, this.convite,
        );
      } catch (err) {
        console.warn('[InscricaoEquipe] vincular após login falhou', err);
      }
      await this.carregarDadosExistentes();
      this.restaurarRascunho();
    }
  }

  /** Chave única do rascunho em localStorage (por token). */
  private get storageKey(): string {
    return `placarpro_inscricao_${this.token}`;
  }

  /** Snapshot do form atual pra salvar no localStorage. */
  private snapshot(): unknown {
    return {
      contato: this.contato,
      atletas: this.atletas,
      comissao: this.comissao,
      representanteNome: this.representanteNome,
      representanteRg: this.representanteRg,
      termoAceito: this.termoAceito,
    };
  }

  /** Salva o estado atual do form no localStorage. Chamado a cada mudança
   *  via `(ngModelChange)` no HTML (debounce simples via requestIdleCallback). */
  private saveTimer: any = null;
  salvarRascunho(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.snapshot()));
      } catch { /* quota cheia → ignora */ }
    }, 250);
  }

  /** True quando o ngOnInit detectou rascunho salvo e restaurou. */
  rascunhoRestaurado = false;

  /** Restaura dados do localStorage (se houver). */
  private restaurarRascunho(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      let restaurou = false;
      if (data?.contato) { this.contato = data.contato; restaurou = true; }
      if (Array.isArray(data?.atletas) && data.atletas.length === this.atletas.length) {
        this.atletas = data.atletas;
        restaurou = true;
      }
      if (Array.isArray(data?.comissao) && data.comissao.length === this.comissao.length) {
        this.comissao = this.comissao.map((m, i) => ({
          ...m,
          nome: data.comissao[i]?.nome ?? '',
          documento: data.comissao[i]?.documento ?? '',
        }));
        restaurou = true;
      }
      if (data?.representanteNome) { this.representanteNome = data.representanteNome; restaurou = true; }
      if (data?.representanteRg)   { this.representanteRg = data.representanteRg; restaurou = true; }
      if (data?.termoAceito)       this.termoAceito = data.termoAceito;
      this.rascunhoRestaurado = restaurou;
    } catch (err) {
      console.warn('[InscricaoEquipe] restaurar rascunho falhou', err);
    }
  }

  /** Limpa o rascunho manualmente (caso o usuário queira começar do zero). */
  descartarRascunho(): void {
    this.limparRascunho();
    location.reload();
  }

  private limparRascunho(): void {
    try { localStorage.removeItem(this.storageKey); } catch { /* */ }
  }

  /** Conta atletas com pelo menos um campo preenchido. */
  qtdAtletasPreenchidos(): number {
    return this.atletas.filter(a => a.nome.trim() || a.documento.trim() || a.dataNascimento.trim()).length;
  }

  /** Valida que cada atleta preenchido tem nome (campo obrigatório). */
  private validarForm(): string | null {
    const preenchidos = this.atletas.filter(a => a.nome.trim() || a.documento.trim() || a.dataNascimento.trim());
    if (preenchidos.length === 0) {
      return 'Adicione pelo menos um atleta.';
    }
    for (const a of preenchidos) {
      if (!a.nome.trim()) {
        return `Atleta nº ${a.ordem}: o nome é obrigatório.`;
      }
    }
    if (!this.representanteNome.trim()) {
      return 'Informe o nome do representante.';
    }
    if (!this.termoAceito) {
      return 'Você precisa aceitar o termo de responsabilidade.';
    }
    return null;
  }

  /**
   * Submit do formulário. Garante login (modal se necessário), valida e cria
   * todas as entidades em paralelo (jogadores + comissão técnica + dados
   * da equipe). Por fim, marca o convite como usado.
   */
  async confirmar(): Promise<void> {
    const erro = this.validarForm();
    if (erro) {
      await this.toast(erro, 'danger');
      return;
    }
    if (!this.convite) return;

    // Garante autenticação
    if (!this.authSrv.currentUser) {
      await this.toast('Faça login para enviar a inscrição.', 'medium');
      const modal = await this.modalCtrl.create({
        component: LoginModalComponent,
        backdropDismiss: true,
        cssClass: 'modal-login',
      });
      await modal.present();
      await modal.onDidDismiss();
      if (!this.authSrv.currentUser) {
        await this.toast('Login necessário para enviar.', 'danger');
        return;
      }
    }

    const loader = await this.loadingCtrl.create({ message: 'Enviando inscrição...' });
    await loader.present();
    this.enviando = true;
    try {
      const { campeonatoId, categoriaId, equipeId } = this.convite;

      // ─── 1) ATLETAS: 3 caminhos por linha ───
      //   - tem id + preenchida → UPDATE (se mudou)
      //   - tem id + vazia      → skip (não deletamos no fluxo público)
      //   - sem id + preenchida → CREATE
      //   - sem id + vazia      → skip
      //
      // Helper: monta payload do atleta SEM campos `undefined` (Firestore
      // rejeita undefined em qualquer campo do doc).
      const montarPayloadAtleta = (a: LinhaAtleta, incluirEquipe: boolean): Record<string, unknown> => {
        // O `numeroCamisa` NÃO é setado pela ficha de inscrição pública —
        // a numeração é responsabilidade do organizador (tela de equipe).
        // Antes esta função gravava `numeroCamisa: String(a.ordem)` que
        // sobrescrevia o número definido pelo admin a cada salvamento.
        const p: Record<string, unknown> = {
          nome: a.nome.trim(),
          inscricaoToken: this.token,
        };
        if (incluirEquipe) p['equipeId'] = equipeId;
        const doc = a.documento.trim();
        if (doc) p['documento'] = doc;
        if (a.dataNascimento) p['dataNascimento'] = a.dataNascimento;
        return p;
      };

      // Cada operação roda dentro de um try com log próprio pra identificar
      // EXATAMENTE em qual entidade (jogador X / membro Y / equipe / convite)
      // a permissão estoura. Antes o catch externo mostrava só "Missing
      // or insufficient permissions" sem indicar onde.
      const erros: { tipo: string; id?: string; erro: unknown }[] = [];

      const operacoesAtletas: Promise<unknown>[] = [];
      for (const a of this.atletas) {
        const preenchida = !!(a.nome.trim() || a.documento.trim() || a.dataNascimento.trim());
        if (a.jogadorId && preenchida) {
          if (
            a.original?.nome !== a.nome.trim() ||
            a.original?.documento !== a.documento.trim() ||
            a.original?.dataNascimento !== a.dataNascimento
          ) {
            const payload = montarPayloadAtleta(a, false);
            console.log('[Submit] update jogador', a.jogadorId, payload);
            operacoesAtletas.push(
              this.jogadoresSrv.atualizar(campeonatoId, categoriaId, a.jogadorId, payload as any)
                .catch(err => {
                  console.error('[Submit] ❌ update jogador falhou', { id: a.jogadorId, payload, err });
                  erros.push({ tipo: 'update jogador', id: a.jogadorId, erro: err });
                }),
            );
          }
        } else if (!a.jogadorId && preenchida) {
          const payload = montarPayloadAtleta(a, true);
          console.log('[Submit] create jogador (ordem ' + a.ordem + ')', payload);
          operacoesAtletas.push(
            this.jogadoresSrv.criar(campeonatoId, categoriaId, payload as any)
              .catch(err => {
                console.error('[Submit] ❌ create jogador falhou', { ordem: a.ordem, payload, err });
                erros.push({ tipo: 'create jogador (ordem ' + a.ordem + ')', erro: err });
              }),
          );
        }
      }
      await Promise.all(operacoesAtletas);

      // ─── 2) COMISSÃO TÉCNICA: mesma lógica (update vs create) ───
      // Firestore NÃO aceita `undefined` em nenhum campo — então montamos
      // o payload incluindo só os campos preenchidos. Antes deixávamos
      // `funcaoOutro: undefined` quando não era assistente, o que causava
      // "Unsupported field value: undefined (found in field funcaoOutro)".
      const opsComissao: Promise<unknown>[] = [];
      for (const m of this.comissao) {
        const preenchido = !!m.nome.trim();
        if (!preenchido) continue; // sem nome → nada a fazer

        const payload: Record<string, unknown> = {
          equipeId,
          nome: m.nome.trim(),
          funcao: m.funcao === 'assistente' ? 'outro' : m.funcao,
          inscricaoToken: this.token,
        };
        if (m.funcao === 'assistente') {
          payload['funcaoOutro'] = 'Assistente';
        }
        const docTrim = m.documento.trim();
        if (docTrim) payload['documento'] = docTrim;

        if (m.membroId) {
          console.log('[Submit] update tecnica', m.membroId, payload);
          opsComissao.push(
            this.tecnicaSrv.atualizar(campeonatoId, categoriaId, m.membroId, payload as any)
              .catch(err => {
                console.error('[Submit] ❌ update tecnica falhou', { id: m.membroId, payload, err });
                erros.push({ tipo: 'update tecnica (' + m.funcaoLabel + ')', id: m.membroId, erro: err });
              }),
          );
        } else {
          console.log('[Submit] create tecnica', payload);
          opsComissao.push(
            this.tecnicaSrv.criar(campeonatoId, categoriaId, payload as any)
              .catch(err => {
                console.error('[Submit] ❌ create tecnica falhou', { payload, err });
                erros.push({ tipo: 'create tecnica (' + m.funcaoLabel + ')', erro: err });
              }),
          );
        }
        // Sem deletes no fluxo público (mesma razão dos atletas)
      }
      await Promise.all(opsComissao);

      // ─── 3) Atualiza equipe com contato + representante ───
      // Mesma defesa contra `undefined` — só inclui o que tem valor.
      const equipePayload: Record<string, unknown> = {
        inscricaoToken: this.token,
      };
      const contatoTrim = this.contato.trim();
      const repNomeTrim = this.representanteNome.trim();
      const repRgTrim = this.representanteRg.trim();
      const tecnicoTrim = this.comissao[0].nome.trim();
      if (contatoTrim) equipePayload['contato'] = contatoTrim;
      if (repNomeTrim) equipePayload['representanteNome'] = repNomeTrim;
      if (repRgTrim)   equipePayload['representanteRg'] = repRgTrim;
      if (tecnicoTrim) equipePayload['tecnico'] = tecnicoTrim;
      console.log('[Submit] update equipe', equipeId, equipePayload);
      try {
        await this.equipesSrv.atualizar(campeonatoId, categoriaId, equipeId, equipePayload as any);
      } catch (err) {
        console.error('[Submit] ❌ update equipe falhou', { equipeId, payload: equipePayload, err });
        erros.push({ tipo: 'update equipe', id: equipeId, erro: err });
      }

      // 4) Marca convite como usado
      try {
        await this.convitesSrv.marcarPreenchido(this.token, this.authSrv.currentUser!.uid);
      } catch (err) {
        console.error('[Submit] ❌ marcar convite falhou', { token: this.token, err });
        erros.push({ tipo: 'marcar convite preenchido', id: this.token, erro: err });
      }

      // Se houve falhas em qualquer etapa, sinaliza pro usuário com detalhe
      // e NÃO limpa o rascunho (pra ele poder tentar de novo sem perder dados).
      if (erros.length > 0) {
        console.error('[Submit] resumo dos erros:', erros);
        const tipos = erros.map(e => e.tipo).join(', ');
        await loader.dismiss();
        await this.toast(
          `Falha parcial: ${erros.length} operação(ões) deram erro. Veja o console. (${tipos})`,
          'danger',
        );
        return;
      }

      // 5) Limpa o rascunho do localStorage agora que foi enviado com sucesso
      this.limparRascunho();

      await loader.dismiss();
      await this.mostrarSucesso();
    } catch (err) {
      console.error('[InscricaoEquipe] submit erro', err);
      await this.toast('Falha ao enviar inscrição. Tente novamente.', 'danger');
    } finally {
      this.enviando = false;
      try { await loader.dismiss(); } catch { /* ignore */ }
    }
  }

  private async mostrarSucesso(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Inscrição enviada!',
      message:
        'A ficha foi recebida e os atletas cadastrados no sistema. ' +
        'Você será redirecionado em instantes.',
      buttons: ['OK'],
    });
    await alert.present();
    await alert.onDidDismiss();

    // Redirect pós-sucesso:
    //  - logado     → área do espectador (sua tela principal)
    //  - deslogado  → home pública do site
    const destino = this.authSrv.currentUser ? '/espectador' : '/';
    await this.router.navigateByUrl(destino, { replaceUrl: true });
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'top', color });
    await t.present();
  }

  trackByOrdem(_i: number, a: LinhaAtleta): number { return a.ordem; }
  trackByFuncao(_i: number, m: MembroComissao): string { return m.funcao; }
}
