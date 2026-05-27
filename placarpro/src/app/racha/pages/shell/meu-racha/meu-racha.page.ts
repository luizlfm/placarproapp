import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription } from 'rxjs';
import { LoadingController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { DiaSemana, Racha, TipoCampo } from '../../../models/racha.model';

interface OpcaoSelect<T> {
  value: T;
  label: string;
}

/**
 * Página "Meu Racha" — configurações completas do racha. Equivalente ao
 * `/racha/edit/:codigo` do FutBora.
 *
 * Estrutura:
 *  - Header com nome do racha + subtítulo
 *  - Seção "Informações Básicas": nome, qtdTimes, jogadoresPorTime,
 *    dia da semana, horário de início
 *  - Seção "Personalizar regras (Opcional)": código de convite, tempo de
 *    partida, aluguel/arbitragem/custo do app, tipo de campo, estado,
 *    município, endereço
 *  - Toggles: exibir notas, código de indicação
 *  - Footer: CANCELAR / SALVAR ALTERAÇÕES
 *  - Card separado: Avaliação de jogadores (toggle + bola murcha + sliders)
 */
@Component({
  selector: 'app-racha-meu-racha',
  templateUrl: './meu-racha.page.html',
  styleUrls: ['./meu-racha.page.scss'],
  standalone: false,
})
export class RachaMeuRachaPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  racha?: Racha;
  rachaId = '';
  loading = true;
  /** True quando há mudanças pendentes (form dirty) — mostra aviso no botão. */
  get temAlteracoes(): boolean {
    return this.form.dirty;
  }
  /** Toggle "Tenho um código de indicação" — controla visibilidade do campo. */
  mostrarIndicacao = false;

  // ============== Opções de selects ==============

  readonly diasSemana: OpcaoSelect<DiaSemana>[] = [
    { value: 'dom', label: 'Domingo' },
    { value: 'seg', label: 'Segunda-feira' },
    { value: 'ter', label: 'Terça-feira' },
    { value: 'qua', label: 'Quarta-feira' },
    { value: 'qui', label: 'Quinta-feira' },
    { value: 'sex', label: 'Sexta-feira' },
    { value: 'sab', label: 'Sábado' },
  ];

  readonly tiposCampo: OpcaoSelect<TipoCampo>[] = [
    { value: 'gramado', label: 'Gramado' },
    { value: 'society', label: 'Society' },
    { value: 'salao',   label: 'Salão (Quadra)' },
    { value: 'areia',   label: 'Areia' },
    { value: 'outro',   label: 'Outro' },
  ];

  /** Lista resumida de UFs do Brasil. */
  readonly estados: OpcaoSelect<string>[] = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
    'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
  ].map(uf => ({ value: uf, label: uf }));

  // ============== Forms ==============

  /** Form principal (informações básicas + regras opcionais). */
  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
    qtdTimes: [2, [Validators.required, Validators.min(2), Validators.max(8)]],
    jogadoresPorTime: [5, [Validators.required, Validators.min(3), Validators.max(11)]],
    diaSemana: [''],
    horarioInicio: [''],
    // Regras opcionais
    codigoConvite: ['', [Validators.maxLength(5)]],
    tempoPartidaMin: [null as number | null],
    aluguelCampoRs: [null as number | null],
    arbitragemRs: [null as number | null],
    custoAppRs: [null as number | null],
    tipoCampo: ['gramado' as TipoCampo, Validators.required],
    estado: [''],
    municipio: [''],
    endereco: [''],
    // Toggles
    exibirNotas: [false],
    codigoIndicacao: [''],
  });

  /** Form separado da seção "Avaliação de jogadores". */
  readonly formAvaliacao: FormGroup = this.fb.nonNullable.group({
    ativa: [true],
    bolaMurcha: [false],
    prazoHoras: [48, [Validators.min(1), Validators.max(720)]],
    pesoAvaliacao: [60, [Validators.min(0), Validators.max(100)]],
    pesoEstatisticas: [40, [Validators.min(0), Validators.max(100)]],
  });

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) {
      this.router.navigateByUrl('/racha');
      return;
    }
    this.sub = this.rachaSrv.get$(this.rachaId).subscribe(r => {
      if (!r) {
        this.router.navigateByUrl('/racha');
        return;
      }
      this.racha = r;
      this.loading = false;
      this.popularForm(r);
    });

    /**
     * Slider de "Peso do Craque": quando muda Avaliação, ajusta
     * Estatísticas automaticamente pra somar 100 (e vice-versa). Mantém
     * os dois sempre complementares.
     */
    this.formAvaliacao.get('pesoAvaliacao')!.valueChanges.subscribe(v => {
      const novo = 100 - Number(v ?? 0);
      const atual = this.formAvaliacao.get('pesoEstatisticas')!.value;
      if (atual !== novo) {
        this.formAvaliacao.get('pesoEstatisticas')!.setValue(novo, { emitEvent: false });
      }
    });
    this.formAvaliacao.get('pesoEstatisticas')!.valueChanges.subscribe(v => {
      const novo = 100 - Number(v ?? 0);
      const atual = this.formAvaliacao.get('pesoAvaliacao')!.value;
      if (atual !== novo) {
        this.formAvaliacao.get('pesoAvaliacao')!.setValue(novo, { emitEvent: false });
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Popula os forms com dados existentes do racha (chamado on load). */
  private popularForm(r: Racha): void {
    this.form.patchValue({
      nome: r.nome ?? '',
      qtdTimes: r.qtdTimes ?? 2,
      jogadoresPorTime: r.jogadoresPorTime ?? 5,
      diaSemana: r.diaSemana ?? '',
      horarioInicio: r.horarioInicio ?? '',
      codigoConvite: r.codigoConvite ?? '',
      tempoPartidaMin: r.tempoPartidaMin ?? null,
      aluguelCampoRs: r.aluguelCampoRs ?? null,
      arbitragemRs: r.arbitragemRs ?? null,
      custoAppRs: r.custoAppRs ?? null,
      tipoCampo: r.tipoCampo ?? 'gramado',
      estado: r.estado ?? '',
      municipio: r.municipio ?? '',
      endereco: r.endereco ?? '',
      exibirNotas: r.exibirNotas ?? false,
      codigoIndicacao: r.codigoIndicacao ?? '',
    }, { emitEvent: false });
    this.form.markAsPristine();

    if (r.avaliacao) {
      this.formAvaliacao.patchValue({
        ativa: r.avaliacao.ativa ?? true,
        bolaMurcha: r.avaliacao.bolaMurcha ?? false,
        prazoHoras: r.avaliacao.prazoHoras ?? 48,
        pesoAvaliacao: r.avaliacao.pesoAvaliacao ?? 60,
        pesoEstatisticas: r.avaliacao.pesoEstatisticas ?? 40,
      }, { emitEvent: false });
      this.formAvaliacao.markAsPristine();
    }

    this.mostrarIndicacao = !!r.codigoIndicacao;
  }

  // ============== Helpers ==============

  /** Contador de chars do nome (estilo FutBora "8 / 50"). */
  get nomeLength(): number {
    return (this.form.value.nome ?? '').length;
  }

  /** Capacidade total = times × jogadores por time. */
  get capacidadeTotal(): number {
    const t = Number(this.form.value.qtdTimes ?? 0);
    const j = Number(this.form.value.jogadoresPorTime ?? 0);
    return t * j;
  }

  /** Gera código de convite aleatório (5 chars alfanuméricos, sem 0/1/O/I). */
  gerarCodigoConvite(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigo = '';
    for (let i = 0; i < 5; i++) {
      codigo += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.form.get('codigoConvite')!.setValue(codigo);
    this.form.get('codigoConvite')!.markAsDirty();
  }

  // ============== Save / Cancel ==============

  cancelar(): void {
    if (this.racha) this.popularForm(this.racha);
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  async salvar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      await this.toast('Verifique os campos obrigatórios.', 'danger');
      return;
    }
    const v = this.form.getRawValue();
    const av = this.formAvaliacao.getRawValue();

    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      await this.rachaSrv.atualizar(this.rachaId, {
        nome: v.nome.trim(),
        qtdTimes: Number(v.qtdTimes),
        jogadoresPorTime: Number(v.jogadoresPorTime),
        diaSemana: (v.diaSemana || undefined) as DiaSemana | undefined,
        horarioInicio: v.horarioInicio || '',
        codigoConvite: (v.codigoConvite || '').toUpperCase().trim() || undefined,
        tempoPartidaMin: this.nullableNumber(v.tempoPartidaMin),
        aluguelCampoRs: this.nullableNumber(v.aluguelCampoRs),
        arbitragemRs: this.nullableNumber(v.arbitragemRs),
        custoAppRs: this.nullableNumber(v.custoAppRs),
        tipoCampo: v.tipoCampo,
        estado: v.estado || '',
        municipio: v.municipio || '',
        endereco: v.endereco || '',
        exibirNotas: !!v.exibirNotas,
        codigoIndicacao: (v.codigoIndicacao || '').trim() || undefined,
        avaliacao: {
          ativa: !!av.ativa,
          bolaMurcha: !!av.bolaMurcha,
          prazoHoras: Number(av.prazoHoras) || 48,
          pesoAvaliacao: Number(av.pesoAvaliacao) || 60,
          pesoEstatisticas: Number(av.pesoEstatisticas) || 40,
        },
      });
      await this.toast('Alterações salvas!', 'success');
      this.form.markAsPristine();
      this.formAvaliacao.markAsPristine();
      // Padrão UX do sistema: salvou → volta. Fallback explícito leva pra
      // /racha/:id/inicio quando o user veio direto via URL/refresh.
      this.navBack.back('/racha/' + this.rachaId + '/inicio');
    } catch (err) {
      console.error('[MeuRacha] salvar erro', err);
      await this.toast('Falha ao salvar. Tente novamente.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  /** Helpers — number input retorna string vazia ou null quando vazio. */
  private nullableNumber(v: unknown): number | undefined {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  }

  // ============== Sliders helpers ==============

  get prazoHorasLabel(): string {
    const h = Number(this.formAvaliacao.value.prazoHoras ?? 48);
    if (h < 24) return `${h} hora(s)`;
    const dias = Math.round(h / 24);
    return `${h} horas (${dias} dia${dias > 1 ? 's' : ''})`;
  }

  get pesoAvaliacao(): number {
    return Number(this.formAvaliacao.value.pesoAvaliacao ?? 60);
  }
  get pesoEstatisticas(): number {
    return Number(this.formAvaliacao.value.pesoEstatisticas ?? 40);
  }

  // ============== Toggle indicação ==============

  toggleIndicacao(): void {
    this.mostrarIndicacao = !this.mostrarIndicacao;
    if (!this.mostrarIndicacao) {
      this.form.get('codigoIndicacao')!.setValue('');
    }
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2400, position: 'top', color,
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await t.present();
  }
  /** Volta pra tela anterior usando histórico do browser; fallback pra
   *  home do racha quando entrou direto via URL. */
  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}