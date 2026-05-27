import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { Campeonato } from '../../../campeonatos/campeonato.model';

/**
 * Campos suportados pelo modal genérico de lista de strings.
 * `locaisCadastrados` foi migrado pra um modal especializado
 * (LocaisCadastradosModalComponent) com GPS, mas a chave permanece
 * aqui pra o roteador em `config.page.ts` saber qual modal abrir.
 */
export type CampoListaStr = 'arbitros' | 'locaisCadastrados';

/**
 * Modal CRUD genérico para campos do `Campeonato` que são `string[]` simples
 * (árbitros e locais de jogo). Evita criar dois componentes praticamente iguais.
 */
@Component({
  selector: 'app-lista-simples-modal',
  templateUrl: './lista-simples-modal.component.html',
  styleUrls: ['./lista-simples-modal.component.scss'],
  standalone: false,
})
export class ListaSimplesModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() campo!: CampoListaStr;
  @Input() titulo = 'Lista';
  @Input() singular = 'item';
  @Input() icone = 'list-outline';

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly toastCtrl = inject(ToastController);

  itens: string[] = [];
  novoItem = '';
  salvando = false;

  /** Índice em edição (-1 = nenhum). Apenas 1 item pode estar em edição
   *  por vez — clicar em "editar" de outro confirma/cancela o anterior. */
  editandoIdx = -1;
  /** Valor temporário do item sendo editado. */
  valorEdicao = '';

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    // Pega o snapshot atual uma única vez (evita renderizar reativo dentro de modal).
    const c = await firstValueFromIgnoringError(this.campSrv.get$(this.campeonatoId));
    const raw = (c?.[this.campo] ?? []) as Array<string | { nome?: string }>;
    // Aceita formato antigo (string) e novo (objeto com nome) — só pega o texto pra exibir.
    this.itens = raw.map(v => (typeof v === 'string' ? v : v?.nome ?? ''));
  }

  adicionar(): void {
    const v = (this.novoItem ?? '').trim();
    if (!v) return;
    if (this.itens.some(i => i.toLowerCase() === v.toLowerCase())) {
      this.toast(`"${v}" já está na lista.`, 'medium');
      return;
    }
    this.itens.push(v);
    this.novoItem = '';
  }

  remover(idx: number): void {
    // Se está editando esse item, sai do modo edição primeiro.
    if (this.editandoIdx === idx) this.cancelarEdicao();
    this.itens.splice(idx, 1);
  }

  /** Entra em modo edição inline. Se já tem outro item em edição,
   *  descarta a edição anterior (não confirma — usuário precisa ser explícito). */
  iniciarEdicao(idx: number): void {
    this.editandoIdx = idx;
    this.valorEdicao = this.itens[idx] ?? '';
    // Foca o input no próximo tick — pendente do Angular renderizar.
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('.ls-item.editando ion-input input');
      el?.focus();
      el?.select();
    }, 50);
  }

  /** Confirma a edição do item atual. Valida duplicata + vazio. */
  confirmarEdicao(): void {
    if (this.editandoIdx < 0) return;
    const v = (this.valorEdicao ?? '').trim();
    if (!v) {
      this.toast('Nome não pode ser vazio.', 'medium');
      return;
    }
    // Checa duplicata ignorando o próprio índice.
    const duplicado = this.itens.some(
      (it, i) => i !== this.editandoIdx && it.toLowerCase() === v.toLowerCase(),
    );
    if (duplicado) {
      this.toast(`"${v}" já está na lista.`, 'medium');
      return;
    }
    this.itens[this.editandoIdx] = v;
    this.editandoIdx = -1;
    this.valorEdicao = '';
  }

  cancelarEdicao(): void {
    this.editandoIdx = -1;
    this.valorEdicao = '';
  }

  async salvar(): Promise<void> {
    if (!this.campeonatoId) return;
    this.salvando = true;
    try {
      const patch: Partial<Campeonato> = { [this.campo]: this.itens } as Partial<Campeonato>;
      await this.campSrv.atualizar(this.campeonatoId, patch);
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[ListaSimples] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}

/**
 * Wrapper local para `firstValueFrom` que devolve `undefined` ao invés de
 * propagar erro (se a query falhar, abrimos com lista vazia).
 */
async function firstValueFromIgnoringError<T>(obs$: import('rxjs').Observable<T>): Promise<T | undefined> {
  try {
    return await new Promise<T>((resolve, reject) => {
      const sub = obs$.subscribe({
        next: v => { resolve(v); setTimeout(() => sub.unsubscribe(), 0); },
        error: e => { reject(e); },
      });
    });
  } catch {
    return undefined;
  }
}
