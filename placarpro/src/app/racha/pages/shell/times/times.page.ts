import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { AlertController, ToastController } from '@ionic/angular';
import { RachaService } from '../../../racha.service';
import { RachaTime } from '../../../models/racha.model';

/**
 * Página TIMES — CRUD dos times do racha. Cada time tem escudo colorido,
 * nome e estado (ativo/arquivado). Inspirado no print do FutBora:
 *  - Hero "Organize seus escudos"
 *  - Filtros (nome + checkbox "Mostrando apenas ativos")
 *  - Grid de cards 4 colunas com escudo SVG + nome + Ativo/Editar
 */
@Component({
  selector: 'app-racha-times',
  templateUrl: './times.page.html',
  styleUrls: ['./times.page.scss'],
  standalone: false,
})
export class RachaTimesPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  rachaId = '';
  loading = true;
  times: RachaTime[] = [];

  /** Filtros locais. */
  busca = '';
  apenasAtivos = false;

  /** Paleta padrão de cores pros escudos (ciclada quando cria novo). */
  readonly paletaEscudo = [
    '#22c55e', // verde
    '#3b82f6', // azul
    '#f59e0b', // âmbar
    '#ef4444', // vermelho
    '#8b5cf6', // roxo
    '#14b8a6', // teal
    '#ec4899', // rosa
    '#64748b', // slate
  ];

  private sub?: Subscription;

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
    if (!this.rachaId) {
      this.router.navigateByUrl('/racha');
      return;
    }
    this.carregar();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private carregar(): void {
    this.sub = this.rachaSrv.listTimes$(this.rachaId).pipe(
      startWith([] as RachaTime[]),
      catchError(err => {
        console.error('[Times] listTimes erro', err);
        return of([] as RachaTime[]);
      }),
    ).subscribe(arr => {
      this.times = arr;
      this.loading = false;
    });
  }

  // ============== Filtros ==============

  get timesFiltrados(): RachaTime[] {
    const q = this.busca.trim().toLowerCase();
    return this.times.filter(t => {
      if (this.apenasAtivos && t.ativo === false) return false;
      if (!q) return true;
      return (t.nome ?? '').toLowerCase().includes(q);
    });
  }

  get totalAtivos(): number {
    return this.times.filter(t => t.ativo !== false).length;
  }

  limparFiltros(): void {
    this.busca = '';
    this.apenasAtivos = false;
  }

  // ============== CRUD ==============

  /**
   * Modal simples (Alert do Ionic) pra criar um novo time. Captura nome,
   * gera cor da paleta cíclica baseada no índice. Pra UI mais rica
   * podemos extrair pra um RachaTimeModalComponent depois.
   */
  async novoTime(): Promise<void> {
    const sugestao = `Time ${this.times.length + 1}`;
    const corPadrao = this.paletaEscudo[this.times.length % this.paletaEscudo.length];
    const alert = await this.alertCtrl.create({
      header: 'Novo time',
      inputs: [
        { name: 'nome', type: 'text', placeholder: 'Nome do time', value: sugestao },
        // Color input nativo dentro do Alert (alguns devices simplificam pra
        // input text). Pra UX consistente, ideal seria modal próprio.
        { name: 'cor', type: 'text', placeholder: 'Cor (hex)', value: corPadrao, attributes: { maxlength: 7 } },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Criar',
          role: 'confirm',
          handler: async (data) => {
            const nome = (data?.nome ?? '').trim();
            if (!nome) { this.toast('Informe o nome do time.', 'danger'); return false; }
            const cor = (data?.cor ?? corPadrao).trim() || corPadrao;
            try {
              await this.rachaSrv.criarTime(this.rachaId, {
                nome,
                cor,
                ativo: true,
                ordem: this.times.length + 1,
              });
              this.toast(`Time "${nome}" criado!`, 'success');
              return true;
            } catch (err) {
              console.error('[Times] criar erro', err);
              this.toast('Falha ao criar time.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /** Edita nome + cor + ativo do time. */
  async editar(t: RachaTime): Promise<void> {
    if (!t.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Editar time',
      inputs: [
        { name: 'nome', type: 'text', placeholder: 'Nome', value: t.nome },
        { name: 'cor', type: 'text', placeholder: 'Cor (hex)', value: t.cor ?? '#22c55e' },
      ],
      buttons: [
        {
          text: 'Remover',
          role: 'destructive',
          handler: () => { this.removerComConfirmacao(t); return true; },
        },
        { text: 'Cancelar', role: 'cancel' },
        {
          text: t.ativo === false ? 'Reativar' : 'Arquivar',
          handler: async () => {
            await this.rachaSrv.atualizarTime(this.rachaId, t.id!, { ativo: t.ativo === false });
            this.toast(t.ativo === false ? 'Time reativado.' : 'Time arquivado.', 'success');
            return true;
          },
        },
        {
          text: 'Salvar',
          role: 'confirm',
          handler: async (data) => {
            const nome = (data?.nome ?? '').trim();
            const cor = (data?.cor ?? '').trim();
            if (!nome) { this.toast('Nome obrigatório.', 'danger'); return false; }
            try {
              await this.rachaSrv.atualizarTime(this.rachaId, t.id!, { nome, cor });
              this.toast('Salvo!', 'success');
              return true;
            } catch (err) {
              console.error('[Times] editar erro', err);
              this.toast('Falha ao salvar.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  private async removerComConfirmacao(t: RachaTime): Promise<void> {
    if (!t.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover time?',
      message: `Confirma remover "<b>${t.nome}</b>"? Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.rachaSrv.removerTime(this.rachaId, t.id!);
              this.toast(`Time removido.`, 'medium');
            } catch (err) {
              console.error('[Times] remover erro', err);
              this.toast('Falha ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  trackById(_i: number, t: RachaTime): string {
    return t.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const tt = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await tt.present();
  }
}
