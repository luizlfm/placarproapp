import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';
import { Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { Racha, RachaLancamento } from '../../../models/racha.model';

/**
 * Página FINANCEIRO — entradas/saídas do racha + custos fixos automáticos
 * + filtros + resumo WhatsApp + exportar.
 *
 * Lançamentos vivem em subcoleção `rachas/{id}/lancamentos`. Por enquanto
 * gerenciamos local-only (state em memória) — quando wire-up final, basta
 * trocar `lancamentos = []` por `rachaSrv.listLancamentos$()`.
 */
@Component({
  selector: 'app-racha-financeiro',
  templateUrl: './financeiro.page.html',
  styleUrls: ['./financeiro.page.scss'],
  standalone: false,
})
export class RachaFinanceiroPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly navBack = inject(NavBackService);

  rachaId = '';
  loading = true;
  racha?: Racha;

  /** Stream de lançamentos vindo da subcoleção `rachas/{id}/lancamentos`.
   *  Antes era um array em memória — agora persiste. */
  lancamentos: RachaLancamento[] = [];
  private lancamentosSub?: Subscription;

  /** Form de configuração dos custos fixos. */
  readonly form: FormGroup = this.fb.nonNullable.group({
    aluguelCampoRs: [null as number | null, [Validators.min(0)]],
    arbitragemRs: [null as number | null, [Validators.min(0)]],
    mensalistaPadraoRs: [null as number | null, [Validators.min(0)]],
  });

  /** Filtros (placeholder — expansível). */
  filtrosAbertos = false;

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) { this.router.navigateByUrl('/racha'); return; }
    this.sub = this.rachaSrv.get$(this.rachaId).pipe(
      startWith(undefined),
      catchError(err => { console.error('[Financeiro] get', err); return of(undefined); }),
    ).subscribe(r => {
      this.racha = r ?? undefined;
      this.loading = false;
      if (r) {
        this.form.patchValue({
          aluguelCampoRs: r.aluguelCampoRs ?? null,
          arbitragemRs: r.arbitragemRs ?? null,
          mensalistaPadraoRs: r.mensalistaPadraoRs ?? null,
        }, { emitEvent: false });
        this.form.markAsPristine();
      }
    });

    // Stream de lançamentos persistidos no Firestore.
    this.lancamentosSub = this.rachaSrv.listLancamentos$(this.rachaId)
      .pipe(catchError(err => {
        console.error('[Financeiro] listLancamentos', err);
        return of([] as RachaLancamento[]);
      }))
      .subscribe(lista => {
        this.lancamentos = lista;
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.lancamentosSub?.unsubscribe();
  }

  // ============== Métricas ==============

  get totalEntradas(): number {
    return this.lancamentos
      .filter(l => l.tipo === 'entrada')
      .reduce((acc, l) => acc + (l.valorRs ?? 0), 0);
  }
  get totalSaidas(): number {
    return this.lancamentos
      .filter(l => l.tipo === 'saida')
      .reduce((acc, l) => acc + (l.valorRs ?? 0), 0);
  }
  get saldo(): number {
    return this.totalEntradas - this.totalSaidas;
  }

  // ============== Ações ==============

  async novaEntrada(): Promise<void> {
    return this.criarLancamento('entrada');
  }
  async novaSaida(): Promise<void> {
    return this.criarLancamento('saida');
  }

  private async criarLancamento(tipo: 'entrada' | 'saida'): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: tipo === 'entrada' ? 'Nova entrada' : 'Nova saída',
      inputs: [
        { name: 'descricao', type: 'text', placeholder: 'Descrição (ex: Mensalidade Pedro)' },
        { name: 'valor', type: 'number', placeholder: 'Valor (R$)', attributes: { min: 0, step: 0.01 } },
        { name: 'categoria', type: 'text', placeholder: 'Categoria (opcional)' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          role: 'confirm',
          handler: async (data) => {
            const descricao = (data?.descricao ?? '').trim();
            const valor = Number(data?.valor ?? 0);
            if (!descricao) { this.toast('Descrição obrigatória.', 'danger'); return false; }
            if (!valor || valor <= 0) { this.toast('Valor inválido.', 'danger'); return false; }
            try {
              await this.rachaSrv.criarLancamento(this.rachaId, {
                tipo,
                descricao,
                valorRs: valor,
                categoria: (data?.categoria ?? '').trim() || undefined,
                auto: false,
              });
              this.toast(
                `${tipo === 'entrada' ? 'Entrada' : 'Saída'} de R$ ${valor.toFixed(2)} registrada!`,
                'success',
              );
              return true;
            } catch (err) {
              console.error('[Financeiro] criar lancamento', err);
              this.toast('Falha ao salvar. Tente novamente.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async removerLancamento(l: RachaLancamento, _index: number): Promise<void> {
    if (!l.id) {
      this.toast('Lançamento sem id — não foi gravado ainda.', 'danger');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Remover lançamento?',
      message: `Confirma remover "<b>${l.descricao}</b>" (R$ ${l.valorRs.toFixed(2)})?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.rachaSrv.removerLancamento(this.rachaId, l.id!);
              this.toast('Lançamento removido.', 'medium');
              return true;
            } catch (err) {
              console.error('[Financeiro] remover lancamento', err);
              this.toast('Falha ao remover.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async salvarConfiguracao(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast('Valores inválidos.', 'danger');
      return;
    }
    const v = this.form.getRawValue();
    const loader = await this.loadingCtrl.create({ message: 'Salvando...' });
    await loader.present();
    try {
      await this.rachaSrv.atualizar(this.rachaId, {
        aluguelCampoRs: this.toNum(v.aluguelCampoRs),
        arbitragemRs: this.toNum(v.arbitragemRs),
        mensalistaPadraoRs: this.toNum(v.mensalistaPadraoRs),
      });
      this.form.markAsPristine();
      this.toast('Custos fixos salvos!', 'success');
    } catch (err) {
      console.error('[Financeiro] salvar custos', err);
      this.toast('Falha ao salvar.', 'danger');
    } finally {
      await loader.dismiss();
    }
  }

  resumoWhatsApp(): void {
    const linhas: string[] = [
      '💰 *Resumo financeiro do racha*',
      `Entradas: R$ ${this.totalEntradas.toFixed(2)}`,
      `Saídas: R$ ${this.totalSaidas.toFixed(2)}`,
      `Saldo: R$ ${this.saldo.toFixed(2)}`,
      '',
    ];
    if (this.lancamentos.length > 0) {
      linhas.push('*Últimos lançamentos:*');
      this.lancamentos.slice(0, 10).forEach(l => {
        const sinal = l.tipo === 'entrada' ? '+' : '-';
        linhas.push(`${sinal} R$ ${l.valorRs.toFixed(2)} — ${l.descricao}`);
      });
    }
    navigator.clipboard?.writeText(linhas.join('\n')).then(
      () => this.toast('Resumo copiado! Cole no WhatsApp.', 'success'),
      () => this.toast('Falha ao copiar.', 'danger'),
    );
  }

  exportar(): void {
    if (this.lancamentos.length === 0) {
      this.toast('Sem lançamentos pra exportar.', 'medium');
      return;
    }
    const linhas: string[] = ['Tipo,Descrição,Valor,Categoria'];
    this.lancamentos.forEach(l => {
      linhas.push([
        l.tipo,
        `"${l.descricao.replace(/"/g, '""')}"`,
        l.valorRs.toFixed(2),
        l.categoria ?? '',
      ].join(','));
    });
    const csv = linhas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financeiro-racha-${this.rachaId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Relatório exportado!', 'success');
  }

  toggleFiltros(): void {
    this.filtrosAbertos = !this.filtrosAbertos;
  }

  // ============== Helpers ==============

  private toNum(v: unknown): number | undefined {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return isNaN(n) ? undefined : n;
  }

  formatRs(n: number): string {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  trackByIndex(i: number): number {
    return i;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
  /** Volta pra tela anterior usando histórico do browser; fallback pra
   *  home do racha quando entrou direto via URL. */
  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}