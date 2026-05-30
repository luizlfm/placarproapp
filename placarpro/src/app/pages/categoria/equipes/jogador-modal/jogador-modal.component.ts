import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  AlertController,
  LoadingController,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import {
  Jogador,
  JogadorEstatisticas,
  JogadorSuspensao,
} from '../../../../campeonatos/models/jogador.model';
import { JogadoresService, LimiteExcedidoError } from '../../../../campeonatos/jogadores.service';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { StorageService } from '../../../../shared/storage.service';
import { ImageCropperModalComponent } from '../../../../shared/components/image-cropper-modal/image-cropper-modal.component';
import { ImportarJogadoresModalComponent } from '../importar-jogadores-modal/importar-jogadores-modal.component';
import { ActionModalService } from '../../../../shared/components/action-modal/action-modal.service';
import { OcrImportModalComponent } from '../../../../shared/ocr/ocr-import-modal/ocr-import-modal.component';

/** Estados internos da modal:
 *  - lista: lista de jogadores da equipe
 *  - form: editar/criar dados do jogador
 *  - stats: estatísticas do campeonato (sub-tela)
 *  - suspensao: editar período de suspensão (sub-popup)
 *  - transferir: escolher nova equipe (sub-tela com lista) */
type Modo = 'lista' | 'form' | 'stats' | 'suspensao' | 'transferir';

/**
 * Modal duplo: mostra a lista de jogadores da equipe com cadastro rápido
 * (só nome). Ao clicar em um jogador, abre o form completo de edição.
 */
@Component({
  selector: 'app-jogador-modal',
  templateUrl: './jogador-modal.component.html',
  styleUrls: ['./jogador-modal.component.scss'],
  standalone: false,
})
export class JogadorModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() equipe!: Equipe;

  private readonly fb = inject(FormBuilder);
  private readonly jogadoresSrv = inject(JogadoresService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly storageSrv = inject(StorageService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly actionCtrl = inject(ActionModalService);

  @ViewChild('novoNomeInput') novoNomeInput?: ElementRef<HTMLIonInputElement>;

  modo: Modo = 'lista';
  jogadorEditando?: Jogador;
  loading = false;
  enviandoFoto = false;

  /** De qual sub-tela do form viemos pra restaurar `modo='form'` ao voltar. */
  private modoAnterior: Modo = 'form';
  /** Lista de equipes da categoria (cache pra tela de transferir). */
  equipesDisponiveis: Equipe[] = [];

  /** Quick-add inline */
  novoNome = '';
  criando = false;

  private readonly buscaSubject = new BehaviorSubject<string>('');
  set busca(v: string) {
    this.buscaSubject.next(v ?? '');
  }
  get busca(): string {
    return this.buscaSubject.value;
  }

  jogadores$!: Observable<Jogador[]>;

  fotoPendenteBlob?: Blob;
  fotoPendenteUrl?: string;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(3)]],
    apelido: [''],
    posicao: [''],
    numeroCamisa: [''],
    // CPF e RG separados (antes era um campo `documento` único combinado).
    // Continuamos populando `documento` no salvar pra retrocompat com
    // listagens antigas que leem desse campo.
    cpf: [''],
    rg: [''],
    dataNascimento: [''],
    telefone: [''],
    fotoUrl: [''],
  });

  /** Form das estatísticas (sub-tela). Valores guardados como números/strings;
   *  vazio = sem informação. Goleiro=true habilita campo "Gols tomados". */
  readonly statsForm: FormGroup = this.fb.nonNullable.group({
    gols: [0],
    jogos: [0],
    cartoesAmarelos: [0],
    cartoesVermelhos: [0],
    cartoesAzuis: [0],
    faltas: [0],
    assistencias: [0],
    goleiro: [false],
    golsTomados: [0],
    avaliacao: [''],
  });

  /** Form de suspensão (sub-popup). */
  readonly suspensaoForm: FormGroup = this.fb.nonNullable.group({
    inicio: [''],
    fim: [''],
  });

  ngOnInit(): void {
    // Usa a versão SEM orderBy do Firestore (where('equipeId','==')) para
    // não depender de índice composto que pode estar building. A ordenação
    // por nome acontece no client.
    const lista$ = this.jogadoresSrv
      .listPorEquipeSemIndex$(this.campeonatoId, this.categoriaId, this.equipe.id!)
      .pipe(
        startWith<Jogador[]>([]),
        catchError(err => {
          console.error('[JogadorModal] list$ erro', err);
          return of<Jogador[]>([]);
        }),
        map(js =>
          [...js].sort((a, b) => (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')),
        ),
      );
    this.jogadores$ = combineLatest([
      lista$,
      this.buscaSubject.pipe(startWith('')),
    ]).pipe(
      map(([js, busca]) => {
        const termo = busca.trim().toLowerCase();
        return termo
          ? js.filter(
              j =>
                j.nome.toLowerCase().includes(termo) ||
                (j.apelido ?? '').toLowerCase().includes(termo) ||
                (j.posicao ?? '').toLowerCase().includes(termo) ||
                (j.numeroCamisa ?? '').toLowerCase().includes(termo),
            )
          : js;
      }),
    );
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** Cadastro rápido — só pelo nome. Equivalente ao fluxo de Equipes. */
  async adicionarRapido(): Promise<void> {
    const nome = this.novoNome.trim();
    if (nome.length < 2) {
      await this.toast('Digite pelo menos 2 letras.', 'warning');
      return;
    }
    this.criando = true;
    try {
      await this.jogadoresSrv.criar(this.campeonatoId, this.categoriaId, {
        nome,
        equipeId: this.equipe.id!,
      });
      this.novoNome = '';
      await this.toast(`"${nome}" adicionado!`, 'success');
      // Mantém foco no campo pra cadastrar vários em sequência.
      setTimeout(() => {
        const el = this.novoNomeInput?.nativeElement as unknown as HTMLIonInputElement | undefined;
        el?.setFocus?.();
      }, 50);
    } catch (err) {
      console.error('[JogadorModal] criar erro', err);
      const msg =
        err instanceof LimiteExcedidoError
          ? err.message
          : (err as { code?: string })?.code === 'permission-denied'
            ? 'Sem permissão. Verifique as Firestore Rules.'
            : 'Erro ao cadastrar jogador.';
      await this.toast(msg, 'danger');
    } finally {
      this.criando = false;
    }
  }

  voltar(): void {
    this.modo = 'lista';
    this.jogadorEditando = undefined;
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;
    this.form.reset({
      nome: '',
      apelido: '',
      posicao: '',
      numeroCamisa: '',
      cpf: '',
      rg: '',
      dataNascimento: '',
      telefone: '',
      fotoUrl: '',
    });
  }

  novoJogador(): void {
    this.jogadorEditando = undefined;
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;
    this.form.reset({
      nome: '',
      apelido: '',
      posicao: '',
      numeroCamisa: '',
      cpf: '',
      rg: '',
      dataNascimento: '',
      telefone: '',
      fotoUrl: '',
    });
    this.modo = 'form';
  }

  editar(j: Jogador): void {
    this.jogadorEditando = j;
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;

    // Migração suave do campo `documento` legado (formato "CPF / RG")
    // pros campos novos `cpf` e `rg`. Se o jogador já tem `cpf`/`rg`
    // separados, usa direto. Senão, tenta splitar o `documento` antigo.
    const cpf = j.cpf ?? this.extrairCpfDoLegado(j.documento);
    const rg  = j.rg  ?? this.extrairRgDoLegado(j.documento);

    this.form.patchValue({
      nome: j.nome,
      apelido: j.apelido ?? '',
      posicao: j.posicao ?? '',
      numeroCamisa: j.numeroCamisa ?? '',
      cpf: cpf ?? '',
      rg: rg ?? '',
      dataNascimento: j.dataNascimento ?? '',
      telefone: j.telefone ?? '',
      fotoUrl: j.fotoUrl ?? '',
    });
    // Pré-carrega forms das sub-telas com o que o jogador já tem.
    const stats = j.estatisticas ?? {};
    this.statsForm.reset({
      gols: stats.gols ?? 0,
      jogos: stats.jogos ?? 0,
      cartoesAmarelos: stats.cartoesAmarelos ?? 0,
      cartoesVermelhos: stats.cartoesVermelhos ?? 0,
      cartoesAzuis: stats.cartoesAzuis ?? 0,
      faltas: stats.faltas ?? 0,
      assistencias: stats.assistencias ?? 0,
      goleiro: !!stats.goleiro,
      golsTomados: stats.golsTomados ?? 0,
      avaliacao: stats.avaliacao ?? '',
    });
    const susp = j.suspensao;
    this.suspensaoForm.reset({
      inicio: susp?.inicio ?? '',
      fim: susp?.fim ?? '',
    });
    this.modo = 'form';
  }

  // ──────────────────────────────────────────────────────────────────
  // Sub-tela: Estatísticas do campeonato
  // ──────────────────────────────────────────────────────────────────

  /** Abre a sub-tela de estatísticas (vinda do form do jogador). */
  abrirEstatisticas(): void {
    if (!this.jogadorEditando) return;
    this.modoAnterior = 'form';
    this.modo = 'stats';
  }

  /** Persiste as estatísticas no Firestore e volta pro form. */
  async salvarEstatisticas(): Promise<void> {
    if (!this.jogadorEditando?.id) return;
    this.loading = true;
    try {
      const raw = this.statsForm.getRawValue();
      const stats: JogadorEstatisticas = {
        gols: Number(raw.gols) || 0,
        jogos: Number(raw.jogos) || 0,
        cartoesAmarelos: Number(raw.cartoesAmarelos) || 0,
        cartoesVermelhos: Number(raw.cartoesVermelhos) || 0,
        cartoesAzuis: Number(raw.cartoesAzuis) || 0,
        faltas: Number(raw.faltas) || 0,
        assistencias: Number(raw.assistencias) || 0,
        goleiro: !!raw.goleiro,
        golsTomados: raw.goleiro ? (Number(raw.golsTomados) || 0) : 0,
        avaliacao: (raw.avaliacao ?? '').toString().trim(),
      };
      await this.jogadoresSrv.atualizar(
        this.campeonatoId,
        this.categoriaId,
        this.jogadorEditando.id,
        { estatisticas: stats } as Partial<Jogador>,
      );
      // Atualiza cache local (sem refetch — o stream em listPorEquipe$ já
      // vai trazer a nova versão na próxima emissão).
      this.jogadorEditando = { ...this.jogadorEditando, estatisticas: stats };
      await this.toast('Estatísticas salvas.', 'success');
      this.modo = 'form';
    } catch (err) {
      console.error('[JogadorModal] salvar stats erro', err);
      await this.toast('Erro ao salvar estatísticas.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Sub-tela: Suspensão
  // ──────────────────────────────────────────────────────────────────

  abrirSuspensao(): void {
    if (!this.jogadorEditando) return;
    // Salva pra voltar à tela que abriu (stats ou form).
    this.modoAnterior = this.modo === 'stats' ? 'stats' : 'form';
    this.modo = 'suspensao';
  }

  async salvarSuspensao(): Promise<void> {
    if (!this.jogadorEditando?.id) return;
    const raw = this.suspensaoForm.getRawValue();
    const inicio = (raw.inicio ?? '').trim();
    if (!inicio) {
      await this.toast('Informe a data de início.', 'warning');
      return;
    }
    const fim = (raw.fim ?? '').trim();
    if (fim && fim < inicio) {
      await this.toast('Data de término deve ser igual ou após o início.', 'warning');
      return;
    }
    this.loading = true;
    try {
      const susp: JogadorSuspensao = fim ? { inicio, fim } : { inicio };
      await this.jogadoresSrv.atualizar(
        this.campeonatoId,
        this.categoriaId,
        this.jogadorEditando.id,
        { suspensao: susp } as Partial<Jogador>,
      );
      this.jogadorEditando = { ...this.jogadorEditando, suspensao: susp };
      await this.toast('Suspensão salva.', 'success');
      this.modo = this.modoAnterior;
    } catch (err) {
      console.error('[JogadorModal] salvar suspensão erro', err);
      await this.toast('Erro ao salvar suspensão.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  /** Remove a suspensão atual. */
  async removerSuspensao(): Promise<void> {
    if (!this.jogadorEditando?.id) return;
    this.loading = true;
    try {
      // Usa null pra apagar o campo no Firestore (FieldValue.delete() seria
      // mais correto, mas updateDoc com null funciona pra apagar key).
      await this.jogadoresSrv.atualizar(
        this.campeonatoId,
        this.categoriaId,
        this.jogadorEditando.id,
        { suspensao: null as unknown as JogadorSuspensao } as Partial<Jogador>,
      );
      this.jogadorEditando = { ...this.jogadorEditando, suspensao: undefined };
      this.suspensaoForm.reset({ inicio: '', fim: '' });
      await this.toast('Suspensão removida.', 'success');
      this.modo = this.modoAnterior;
    } catch (err) {
      console.error('[JogadorModal] remover suspensão erro', err);
      await this.toast('Erro ao remover.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Sub-tela: Transferir jogador
  // ──────────────────────────────────────────────────────────────────

  async abrirTransferir(): Promise<void> {
    if (!this.jogadorEditando) return;
    this.modoAnterior = 'form';
    // Carrega equipes da categoria (cache curto — uma vez por abertura).
    if (this.equipesDisponiveis.length === 0) {
      try {
        const lista = await firstValueFrom(
          this.equipesSrv.list$(this.campeonatoId, this.categoriaId),
        );
        this.equipesDisponiveis = lista ?? [];
      } catch (err) {
        console.error('[JogadorModal] carregar equipes erro', err);
        await this.toast('Erro ao carregar equipes.', 'danger');
        return;
      }
    }
    this.modo = 'transferir';
  }

  async transferirPara(novaEquipe: Equipe | null): Promise<void> {
    if (!this.jogadorEditando?.id) return;
    const novoId = novaEquipe?.id ?? '';
    if (novoId === this.jogadorEditando.equipeId) {
      // Mesma equipe, só fecha.
      this.modo = 'form';
      return;
    }
    const nomeAtual = this.equipe.nome;
    const nomeNova = novaEquipe?.nome ?? 'Equipe Indefinida';
    const alert = await this.alertCtrl.create({
      header: 'Transferir jogador?',
      message: `Mover "${this.jogadorEditando.nome}" de "${nomeAtual}" para "${nomeNova}"?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Transferir',
          role: 'confirm',
          handler: async () => {
            this.loading = true;
            try {
              await this.jogadoresSrv.atualizar(
                this.campeonatoId,
                this.categoriaId,
                this.jogadorEditando!.id!,
                { equipeId: novoId } as Partial<Jogador>,
              );
              await this.toast('Jogador transferido.', 'success');
              // Após transferir, o jogador sai do escopo desta equipe.
              // Volta direto pra lista da equipe atual.
              this.voltar();
            } catch (err) {
              console.error('[JogadorModal] transferir erro', err);
              await this.toast('Erro ao transferir.', 'danger');
            } finally {
              this.loading = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Volta da sub-tela atual pra anterior.
   *  - stats / transferir → sempre voltam pro form
   *  - suspensão → volta pra stats se veio de stats, senão form
   *
   *  Antes lia direto de `this.modoAnterior` mas isso travava num loop:
   *  ao entrar em stats → suspensão → voltar pra stats, o `modoAnterior`
   *  ficava como 'stats' e o botão voltar não saía mais de lá. */
  voltarSubTela(): void {
    if (this.modo === 'suspensao') {
      this.modo = this.modoAnterior === 'stats' ? 'stats' : 'form';
    } else {
      this.modo = 'form';
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Helpers UI
  // ──────────────────────────────────────────────────────────────────

  /** Formata data ISO ou Timestamp pra exibição BR ("dd/MM/yyyy"). */
  formatarDataBR(valor: unknown): string {
    if (!valor) return '';
    let date: Date | null = null;
    if (typeof valor === 'string') {
      // ISO YYYY-MM-DD
      const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) {
        date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else {
        const d = new Date(valor);
        if (!Number.isNaN(d.getTime())) date = d;
      }
    } else if (valor && typeof (valor as { toDate?: () => Date }).toDate === 'function') {
      // Firestore Timestamp
      date = (valor as { toDate: () => Date }).toDate();
    }
    if (!date) return '';
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${date.getFullYear()}`;
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    try {
      const raw = this.form.getRawValue();
      const sanitized: Record<string, unknown> = { equipeId: this.equipe.id! };
      Object.entries(raw).forEach(([k, v]) => {
        if (typeof v === 'string' && v.trim() === '') return;
        sanitized[k] = v;
      });

      // Retro-compat: também popula o campo legado `documento` com
      // "CPF / RG" combinados. Assim listagens/CSV/relatórios antigos
      // que leem só `documento` continuam funcionando.
      const cpf = (raw.cpf ?? '').trim();
      const rg = (raw.rg ?? '').trim();
      const combinado = [cpf, rg].filter(Boolean).join(' / ');
      if (combinado) {
        sanitized['documento'] = combinado;
      }

      let jogadorId = this.jogadorEditando?.id;
      if (jogadorId) {
        await this.jogadoresSrv.atualizar(
          this.campeonatoId,
          this.categoriaId,
          jogadorId,
          sanitized as Partial<Jogador>,
        );
      } else {
        jogadorId = await this.jogadoresSrv.criar(
          this.campeonatoId,
          this.categoriaId,
          sanitized as { nome: string; equipeId: string },
        );
      }

      if (this.fotoPendenteBlob && jogadorId) {
        await this.uploadFotoBlob(jogadorId, this.fotoPendenteBlob);
        this.fotoPendenteBlob = undefined;
        this.fotoPendenteUrl = undefined;
      }

      await this.toast('Jogador salvo.', 'success');
      this.voltar();
    } catch (err) {
      console.error('[JogadorModal] salvar erro', err);
      await this.toast(
        err instanceof LimiteExcedidoError ? err.message : 'Erro ao salvar.',
        'danger',
      );
    } finally {
      this.loading = false;
    }
  }

  async remover(): Promise<void> {
    if (!this.jogadorEditando?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover jogador?',
      message: `"${this.jogadorEditando.nome}" será removido da equipe.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.jogadoresSrv.remover(
                this.campeonatoId,
                this.categoriaId,
                this.jogadorEditando!.id!,
              );
              this.voltar();
            } catch (err) {
              console.error('[JogadorModal] remover erro', err);
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Remove rápido (inline na lista) com confirmação. */
  async removerJogador(j: Jogador): Promise<void> {
    if (!j.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover jogador?',
      message: `"${j.nome}" será removido da equipe.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.jogadoresSrv.remover(this.campeonatoId, this.categoriaId, j.id!);
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async removerTodos(): Promise<void> {
    // Usa a query bruta do Firestore (sem o `startWith([])` que vive na
    // pipeline do `jogadores$`). Se usássemos `firstValueFrom(this.jogadores$)`,
    // a primeira emissão seria o array vazio do startWith e a função abortaria
    // pensando que a equipe não tem jogadores.
    const lista = await firstValueFrom(
      this.jogadoresSrv.listPorEquipeSemIndex$(
        this.campeonatoId,
        this.categoriaId,
        this.equipe.id!,
      ),
    );
    if (lista.length === 0) {
      await this.toast('Esta equipe ainda não possui jogadores.', 'success');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Remover todos?',
      message: `Os ${lista.length} jogador(es) desta equipe serão apagados. Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover todos',
          role: 'destructive',
          handler: async () => {
            const loader = await this.loadingCtrl.create({ message: 'Removendo...' });
            await loader.present();
            try {
              for (const j of lista) {
                if (j.id)
                  await this.jogadoresSrv.remover(this.campeonatoId, this.categoriaId, j.id);
              }
              await this.toast('Jogadores removidos.', 'success');
            } catch (err) {
              console.error('[JogadorModal] removerTodos erro', err);
              await this.toast('Erro ao remover.', 'danger');
            } finally {
              await loader.dismiss();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async exportarCsv(): Promise<void> {
    // Mesmo cuidado de `removerTodos`: pegar a lista do Firestore direto,
    // não do `jogadores$` (que começa com `[]` por causa do startWith).
    const lista = await firstValueFrom(
      this.jogadoresSrv.listPorEquipeSemIndex$(
        this.campeonatoId,
        this.categoriaId,
        this.equipe.id!,
      ),
    );
    if (lista.length === 0) {
      await this.toast('Nenhum jogador para exportar.', 'success');
      return;
    }
    const header = ['Nome', 'Apelido', 'Posição', 'Nº', 'Documento', 'Nascimento', 'Telefone'];
    const rows = lista.map(j => [
      j.nome,
      j.apelido ?? '',
      j.posicao ?? '',
      j.numeroCamisa ?? '',
      j.documento ?? '',
      j.dataNascimento ?? '',
      j.telefone ?? '',
    ]);
    const csv = [header, ...rows]
      .map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jogadores-${this.equipe.nome.replace(/\s+/g, '_').toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await this.toast('CSV exportado.', 'success');
  }

  async abrirMenu(): Promise<void> {
    const sheet = await this.actionCtrl.create({
      header: this.equipe.nome,
      buttons: [
        {
          text: 'Importar de Excel/CSV',
          icon: 'cloud-upload-outline',
          handler: () => this.importar(),
        },
        {
          text: 'Exportar CSV',
          icon: 'download-outline',
          handler: () => this.exportarCsv(),
        },
        {
          text: 'Remover todos os jogadores',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => this.removerTodos(),
        },
        { text: 'Cancelar', icon: 'close-outline', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  async importar(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ImportarJogadoresModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        equipe: this.equipe,
      },
      backdropDismiss: false,
    });
    await modal.present();
  }

  /**
   * Abre o modal de escaneamento OCR (foto do RG/CNH → extração automática
   * de campos). Quando o user confirma, os dados retornam aqui e
   * pré-preenchem o form de cadastro/edição via `patchValue`.
   *
   * - CPF e RG são concatenados no campo `documento` (form tem um campo só)
   * - Se já tinha algum valor no form, ele é SOBRESCRITO pelo OCR (intencional —
   *   user clicou explicitamente "Escanear" pra esse fim)
   * - Se o toggle "usar como foto do jogador" estava ligado no OCR modal,
   *   a imagem capturada também é seta como `fotoUrl`:
   *     - Editando: faz upload imediato pro Storage
   *     - Criando: guarda em `fotoPendenteBlob`/`fotoPendenteUrl` (uploadado no salvar)
   */
  async escanearDocumento(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: OcrImportModalComponent,
      backdropDismiss: false,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{
      saved?: boolean;
      dados?: {
        nome?: string;
        cpf?: string;
        rg?: string;
        dataNascimento?: string;
        fotoDataUrl?: string;
      };
    }>();
    if (!data?.saved || !data.dados) return;

    const { nome, cpf, rg, dataNascimento, fotoDataUrl } = data.dados;

    // Patcheia CADA campo separadamente (form agora tem `cpf` e `rg`
    // separados, em vez do antigo `documento` combinado).
    this.form.patchValue({
      ...(nome ? { nome } : {}),
      ...(cpf ? { cpf } : {}),
      ...(rg ? { rg } : {}),
      ...(dataNascimento ? { dataNascimento } : {}),
    });

    // Se OCR devolveu foto, abre o cropper pro user recortar SÓ a foto
    // do rosto (não a folha inteira do documento). Mesmo aspecto 5:6 e
    // fluxo do `selecionarFoto()`. Sai depois com `fotoPendenteBlob` ou
    // upload imediato (se editando).
    if (fotoDataUrl) {
      await this.cortarFotoDoDocumento(fotoDataUrl);
    }

    const t = await this.toastCtrl.create({
      message: 'Dados importados do documento. Revise e salve.',
      duration: 2200,
      position: 'top',
      color: 'success',
    });
    await t.present();
  }

  /**
   * Recebe a imagem capturada do documento e abre o ImageCropper pro user
   * recortar SÓ a área da foto do rosto (que vira a foto-perfil do jogador).
   * Não salva a folha inteira como foto — usa o mesmo cropper do botão
   * "Selecionar foto" pra consistência visual.
   */
  private async cortarFotoDoDocumento(fotoDataUrl: string): Promise<void> {
    try {
      const blob = await this.dataUrlParaBlob(fotoDataUrl);
      const file = new File([blob], 'documento.png', { type: blob.type || 'image/png' });

      const modal = await this.modalCtrl.create({
        component: ImageCropperModalComponent,
        componentProps: {
          file,
          aspectRatio: 5 / 6,
          title: 'Recortar foto do jogador',
          roundCropper: false,
        },
      });
      await modal.present();
      const { data } = await modal.onDidDismiss<{ blob?: Blob; dataUrl?: string }>();
      if (!data?.blob) return;

      // Mesmo fluxo do selecionarFoto: novo → pendente; editando → upload.
      if (this.jogadorEditando?.id) {
        await this.uploadFotoBlob(this.jogadorEditando.id, data.blob);
      } else {
        this.fotoPendenteBlob = data.blob;
        this.fotoPendenteUrl = data.dataUrl;
        this.form.patchValue({ fotoUrl: data.dataUrl ?? '' });
      }
    } catch (err) {
      console.warn('[cortarFotoDoDocumento] falha', err);
    }
  }

  /** Converte uma data URL (base64) em Blob — necessário pro upload
   *  da foto do OCR pro Firebase Storage (que aceita Blob/File, não dataUrl). */
  private async dataUrlParaBlob(dataUrl: string): Promise<Blob> {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  /**
   * Tenta extrair o CPF de um campo `documento` legado (formato
   * antigo "CPF / RG" ou só "CPF"). Identifica pelo padrão de 11
   * dígitos com pontuação típica de CPF.
   */
  private extrairCpfDoLegado(documento?: string): string | undefined {
    if (!documento) return undefined;
    const m = /(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{2})/.exec(documento);
    return m ? `${m[1]}.${m[2]}.${m[3]}-${m[4]}` : undefined;
  }

  /**
   * Tenta extrair o RG de um campo `documento` legado. Estratégia:
   *   - Se tem " / ", pega o que vem DEPOIS (formato "CPF / RG")
   *   - Se NÃO bate o pattern de CPF, considera o conteúdo inteiro como RG
   */
  private extrairRgDoLegado(documento?: string): string | undefined {
    if (!documento) return undefined;
    if (documento.includes(' / ')) {
      const partes = documento.split(' / ').map(p => p.trim()).filter(Boolean);
      // O CPF normalmente vem primeiro — pega tudo que não é CPF
      const rgParte = partes.find(p => !/\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}/.test(p));
      return rgParte || partes[partes.length - 1];
    }
    // Sem separador: se for CPF puro, não há RG. Se não for CPF, é RG.
    const ehCpf = /\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}/.test(documento);
    return ehCpf ? undefined : documento.trim();
  }

  async selecionarFoto(): Promise<void> {
    const file = await this.pickFile();
    if (!file) return;
    const modal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: {
        file,
        aspectRatio: 5 / 6,
        title: 'Ajustar foto',
        roundCropper: false,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ blob?: Blob; dataUrl?: string }>();
    if (!data?.blob) return;

    if (!this.jogadorEditando?.id) {
      this.fotoPendenteBlob = data.blob;
      this.fotoPendenteUrl = data.dataUrl;
      this.form.patchValue({ fotoUrl: data.dataUrl ?? '' });
      return;
    }
    await this.uploadFotoBlob(this.jogadorEditando.id, data.blob);
  }

  removerFoto(): void {
    this.form.patchValue({ fotoUrl: '' });
    this.fotoPendenteBlob = undefined;
    this.fotoPendenteUrl = undefined;
  }

  limparBusca(): void {
    this.busca = '';
  }

  trackById(_i: number, j: Jogador): string {
    return j.id ?? '';
  }

  /** Inicial pra avatar quando o jogador não tem foto. */
  inicial(j: Jogador): string {
    const fonte = (j.apelido?.trim() || j.nome?.trim() || '?');
    return fonte.charAt(0).toUpperCase();
  }

  trackByEquipeId(_i: number, e: Equipe): string {
    return e.id ?? '';
  }

  private async uploadFotoBlob(jogadorId: string, blob: Blob): Promise<void> {
    this.enviandoFoto = true;
    const loader = await this.loadingCtrl.create({ message: 'Enviando foto...' });
    await loader.present();
    try {
      const url = await this.storageSrv.uploadJogadorFoto(
        this.campeonatoId,
        this.categoriaId,
        jogadorId,
        blob,
      );
      this.form.patchValue({ fotoUrl: url });
      await this.jogadoresSrv.atualizar(this.campeonatoId, this.categoriaId, jogadorId, {
        fotoUrl: url,
      });
      await this.toast('Foto atualizada.', 'success');
    } catch (err) {
      console.error('[JogadorModal] upload foto erro', err);
      await this.toast('Erro ao enviar foto.', 'danger');
    } finally {
      this.enviandoFoto = false;
      await loader.dismiss();
    }
  }

  private pickFile(): Promise<File | null> {
    return new Promise<File | null>(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const f = input.files?.[0] ?? null;
        if (document.body.contains(input)) document.body.removeChild(input);
        resolve(f);
      };
      window.addEventListener(
        'focus',
        () =>
          setTimeout(() => {
            if (document.body.contains(input)) {
              document.body.removeChild(input);
              resolve(null);
            }
          }, 1000),
        { once: true },
      );
      input.click();
    });
  }

  private async toast(message: string, color: 'success' | 'danger' | 'warning'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2500,
      position: 'bottom',
      color,
    });
    await t.present();
  }
}
