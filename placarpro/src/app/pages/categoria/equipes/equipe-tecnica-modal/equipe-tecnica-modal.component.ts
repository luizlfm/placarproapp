import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AlertController, ModalController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { catchError, map, startWith } from 'rxjs/operators';
import { Equipe } from '../../../../campeonatos/models/equipe.model';
import {
  FUNCAO_TECNICA_LABEL,
  FuncaoTecnica,
  MembroTecnico,
} from '../../../../campeonatos/models/membro-tecnico.model';
import { EquipeTecnicaService } from '../../../../campeonatos/equipe-tecnica.service';

type Modo = 'lista' | 'form';

@Component({
  selector: 'app-equipe-tecnica-modal',
  templateUrl: './equipe-tecnica-modal.component.html',
  styleUrls: ['./equipe-tecnica-modal.component.scss'],
  standalone: false,
})
export class EquipeTecnicaModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() equipe!: Equipe;

  private readonly fb = inject(FormBuilder);
  private readonly tecnicaSrv = inject(EquipeTecnicaService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  modo: Modo = 'lista';
  membroEditando?: MembroTecnico;
  loading = false;

  readonly funcaoLabel = FUNCAO_TECNICA_LABEL;
  readonly funcoes: FuncaoTecnica[] = [
    'tecnico',
    'auxiliar',
    'preparador-fisico',
    'preparador-goleiros',
    'analista',
    'fisioterapeuta',
    'medico',
    'massagista',
    'gerente',
    'outro',
  ];

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

  membros$!: Observable<MembroTecnico[]>;

  readonly form: FormGroup = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.minLength(2)]],
    apelido: [''],
    funcao: ['tecnico' as FuncaoTecnica, Validators.required],
    funcaoOutro: [''],
    documento: [''],
    telefone: [''],
    dataNascimento: [''],
  });

  ngOnInit(): void {
    const lista$ = this.tecnicaSrv
      .listPorEquipe$(this.campeonatoId, this.categoriaId, this.equipe.id!)
      .pipe(
        startWith<MembroTecnico[]>([]),
        catchError(err => {
          console.error('[EquipeTecnicaModal] list erro', err);
          return of<MembroTecnico[]>([]);
        }),
      );
    this.membros$ = combineLatest([
      lista$,
      this.buscaSubject.pipe(startWith('')),
    ]).pipe(
      map(([ms, busca]) => {
        const t = busca.trim().toLowerCase();
        return t
          ? ms.filter(
              m =>
                m.nome.toLowerCase().includes(t) ||
                (m.apelido ?? '').toLowerCase().includes(t) ||
                this.funcaoLabel[m.funcao].toLowerCase().includes(t),
            )
          : ms;
      }),
    );
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async adicionarRapido(): Promise<void> {
    const nome = this.novoNome.trim();
    if (nome.length < 2) {
      await this.toast('Nome muito curto.', 'danger');
      return;
    }
    this.criando = true;
    try {
      await this.tecnicaSrv.criar(this.campeonatoId, this.categoriaId, {
        nome,
        funcao: 'tecnico',
        equipeId: this.equipe.id!,
      });
      this.novoNome = '';
    } catch (err) {
      console.error('[EquipeTecnicaModal] criar erro', err);
      await this.toast('Erro ao cadastrar.', 'danger');
    } finally {
      this.criando = false;
    }
  }

  novoMembro(): void {
    this.membroEditando = undefined;
    this.form.reset({
      nome: '',
      apelido: '',
      funcao: 'tecnico',
      funcaoOutro: '',
      documento: '',
      telefone: '',
      dataNascimento: '',
    });
    this.modo = 'form';
  }

  editar(m: MembroTecnico): void {
    this.membroEditando = m;
    this.form.patchValue({
      nome: m.nome,
      apelido: m.apelido ?? '',
      funcao: m.funcao,
      funcaoOutro: m.funcaoOutro ?? '',
      documento: m.documento ?? '',
      telefone: m.telefone ?? '',
      dataNascimento: m.dataNascimento ?? '',
    });
    this.modo = 'form';
  }

  voltar(): void {
    this.modo = 'lista';
    this.membroEditando = undefined;
    this.form.reset();
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
      if (this.membroEditando?.id) {
        await this.tecnicaSrv.atualizar(
          this.campeonatoId,
          this.categoriaId,
          this.membroEditando.id,
          sanitized as Partial<MembroTecnico>,
        );
      } else {
        await this.tecnicaSrv.criar(
          this.campeonatoId,
          this.categoriaId,
          sanitized as Omit<MembroTecnico, 'id' | 'criadoEm' | 'atualizadoEm'>,
        );
      }
      await this.toast('Membro salvo.', 'success');
      this.voltar();
    } catch (err) {
      console.error('[EquipeTecnicaModal] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async remover(): Promise<void> {
    if (!this.membroEditando?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover membro?',
      message: `"${this.membroEditando.nome}" será removido da equipe técnica.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.tecnicaSrv.remover(
                this.campeonatoId,
                this.categoriaId,
                this.membroEditando!.id!,
              );
              this.voltar();
            } catch (err) {
              console.error('[EquipeTecnicaModal] remover erro', err);
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async removerInline(m: MembroTecnico, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!m.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover membro?',
      message: `"${m.nome}" será removido.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.tecnicaSrv.remover(this.campeonatoId, this.categoriaId, m.id!);
            } catch {
              await this.toast('Erro ao remover.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  limparBusca(): void {
    this.busca = '';
  }

  trackById(_i: number, m: MembroTecnico): string {
    return m.id ?? '';
  }

  private async toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
