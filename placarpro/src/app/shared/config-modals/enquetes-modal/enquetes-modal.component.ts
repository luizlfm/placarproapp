import { Component, Input, OnInit, inject } from '@angular/core';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { Observable, combineLatest, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { CategoriasService } from '../../../campeonatos/categorias.service';
import { EnquetesService } from '../../../campeonatos/enquetes.service';
import { Categoria } from '../../../campeonatos/categoria.model';
import { Enquete, EnqueteAlternativa } from '../../../campeonatos/models/enquete.model';

interface CategoriaComEnquetes {
  categoria: Categoria;
  enquetes: Enquete[];
}

/**
 * Modal de gerenciamento de Enquetes do campeonato.
 *
 * Listamos categorias + suas enquetes via Observable reativo (combineLatest)
 * — quando um voto cai numa enquete, o Firestore atualiza o doc e o stream
 * empurra os novos contadores pro template sem precisar recarregar o modal.
 *
 * Voto em si é feito na página pública — aqui só admin (CRUD + toggles).
 */
@Component({
  selector: 'app-enquetes-modal',
  templateUrl: './enquetes-modal.component.html',
  styleUrls: ['./enquetes-modal.component.scss'],
  standalone: false,
})
export class EnquetesModalComponent implements OnInit {
  @Input() campeonatoId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly catSrv = inject(CategoriasService);
  private readonly enqSrv = inject(EnquetesService);
  private readonly toastCtrl = inject(ToastController);
  private readonly alertCtrl = inject(AlertController);

  /** Stream reativo de categorias + suas enquetes. Auto-atualiza com novos votos. */
  grupos$: Observable<CategoriaComEnquetes[]> = of([]);

  /** Categoria atualmente expandida (mostrando suas enquetes). */
  catExpandida = '';
  /** Enquete em edição (id) — mostra inputs em vez de leitura. */
  editando = '';
  /**
   * Cópia local da enquete em edição. Evita que um update do Firestore
   * em tempo real (ex.: novo voto chegando) sobrescreva os campos que
   * o usuário está digitando.
   */
  enqueteEditando: Enquete | null = null;

  /** Inputs do form de nova enquete (uma por categoria expandida). */
  novaPergunta = '';
  novasAlternativas: { texto: string }[] = [{ texto: '' }, { texto: '' }];

  ngOnInit(): void {
    if (!this.campeonatoId) return;
    // Stream principal: lista categorias e, para cada uma, observa suas
    // enquetes em tempo real. switchMap garante que quando uma categoria
    // mudar (ex.: nova categoria criada), todo o pipeline reaja.
    this.grupos$ = this.catSrv.list$(this.campeonatoId).pipe(
      switchMap(cats => {
        if (cats.length === 0) return of([] as CategoriaComEnquetes[]);
        const obs = cats.map(cat =>
          this.enqSrv.list$(this.campeonatoId, cat.id!).pipe(
            map(enquetes => ({ categoria: cat, enquetes })),
            catchError(() => of({ categoria: cat, enquetes: [] as Enquete[] })),
          ),
        );
        return combineLatest(obs);
      }),
      catchError(err => {
        console.warn('[Enquetes] load erro', err);
        return of([] as CategoriaComEnquetes[]);
      }),
    );
  }

  // ─────────── Expandir/fechar categoria ───────────

  toggleCategoria(catId: string): void {
    this.catExpandida = this.catExpandida === catId ? '' : catId;
    this.resetarFormNovo();
  }

  private resetarFormNovo(): void {
    this.novaPergunta = '';
    this.novasAlternativas = [{ texto: '' }, { texto: '' }];
    this.editando = '';
    this.enqueteEditando = null;
  }

  // ─────────── Criar nova enquete ───────────

  adicionarAlternativa(): void {
    this.novasAlternativas.push({ texto: '' });
  }

  removerAlternativa(idx: number): void {
    if (this.novasAlternativas.length <= 2) return; // mínimo 2
    this.novasAlternativas.splice(idx, 1);
  }

  async salvarNova(catId: string): Promise<void> {
    const pergunta = this.novaPergunta.trim();
    const alts = this.novasAlternativas
      .map(a => a.texto.trim())
      .filter(t => t.length > 0);
    if (!pergunta) { await this.toast('Informe a pergunta.', 'danger'); return; }
    if (alts.length < 2) { await this.toast('Mínimo 2 alternativas.', 'danger'); return; }

    try {
      await this.enqSrv.criar(this.campeonatoId, catId, {
        pergunta,
        alternativas: alts.map(t => ({
          id: this.genId(), texto: t, votos: 0,
        })),
        visivel: true,
        mostrarResultado: true,
        votacaoAberta: true,
        multiplaEscolha: false,
      });
      await this.toast('Enquete criada.', 'success');
      this.resetarFormNovo();
    } catch (err) {
      console.error('[Enquetes] criar erro', err);
      await this.toast('Falha ao criar enquete.', 'danger');
    }
  }

  // ─────────── Editar enquete ───────────

  /** Inicia edição com uma cópia local (evita que update reativo sobrescreva). */
  iniciarEdicao(e: Enquete): void {
    if (!e.id) return;
    this.editando = e.id;
    this.enqueteEditando = {
      ...e,
      alternativas: (e.alternativas ?? []).map(a => ({ ...a })),
    };
  }

  cancelarEdicao(): void {
    this.editando = '';
    this.enqueteEditando = null;
  }

  async salvarEdicao(catId: string): Promise<void> {
    const e = this.enqueteEditando;
    if (!e?.id) return;
    const pergunta = (e.pergunta ?? '').trim();
    const alts = (e.alternativas ?? []).map(a => ({ ...a, texto: a.texto.trim() }))
      .filter(a => a.texto.length > 0);
    if (!pergunta) { await this.toast('Pergunta vazia.', 'danger'); return; }
    if (alts.length < 2) { await this.toast('Mínimo 2 alternativas.', 'danger'); return; }
    try {
      await this.enqSrv.atualizar(this.campeonatoId, catId, e.id, {
        pergunta, alternativas: alts,
      });
      this.cancelarEdicao();
      await this.toast('Enquete atualizada.', 'success');
    } catch (err) {
      console.error('[Enquetes] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    }
  }

  adicionarAltEdicao(): void {
    if (!this.enqueteEditando) return;
    this.enqueteEditando.alternativas = [
      ...(this.enqueteEditando.alternativas ?? []),
      { id: this.genId(), texto: '', votos: 0 },
    ];
  }

  removerAltEdicao(idx: number): void {
    if (!this.enqueteEditando) return;
    if ((this.enqueteEditando.alternativas?.length ?? 0) <= 2) return;
    this.enqueteEditando.alternativas.splice(idx, 1);
  }

  // ─────────── Toggles em linha ───────────

  async toggleVisivel(catId: string, e: Enquete): Promise<void> {
    if (!e.id) return;
    try {
      await this.enqSrv.atualizar(this.campeonatoId, catId, e.id, { visivel: !e.visivel });
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  async toggleAberta(catId: string, e: Enquete): Promise<void> {
    if (!e.id) return;
    try {
      await this.enqSrv.atualizar(this.campeonatoId, catId, e.id, { votacaoAberta: !e.votacaoAberta });
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  async toggleResultado(catId: string, e: Enquete): Promise<void> {
    if (!e.id) return;
    try {
      await this.enqSrv.atualizar(this.campeonatoId, catId, e.id, { mostrarResultado: !e.mostrarResultado });
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  async toggleMultipla(catId: string, e: Enquete): Promise<void> {
    if (!e.id) return;
    try {
      await this.enqSrv.atualizar(this.campeonatoId, catId, e.id, { multiplaEscolha: !e.multiplaEscolha });
    } catch (err) {
      console.error(err);
      await this.toast('Falha ao atualizar.', 'danger');
    }
  }

  async remover(catId: string, e: Enquete): Promise<void> {
    if (!e.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover enquete?',
      message: `"<strong>${e.pergunta}</strong>" e todos os votos serão apagados.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.enqSrv.remover(this.campeonatoId, catId, e.id!);
            } catch (err) {
              console.error(err);
              await this.toast('Falha ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ─────────── Utilitários ───────────

  private genId(): string {
    return 'a-' + Math.random().toString(36).slice(2, 10);
  }

  trackByCat(_i: number, g: CategoriaComEnquetes): string { return g.categoria.id ?? ''; }
  trackByEnq(_i: number, e: Enquete): string { return e.id ?? ''; }
  trackByAlt(_i: number, a: EnqueteAlternativa): string { return a.id; }
  trackByIdx(i: number): number { return i; }

  /** % de votos de uma alternativa (denominador: total da enquete). */
  percentual(e: Enquete, a: EnqueteAlternativa): number {
    const total = e.totalVotos ?? 0;
    if (total === 0) return 0;
    return Math.round(((a.votos ?? 0) / total) * 100);
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
