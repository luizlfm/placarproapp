import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { deleteField } from '@angular/fire/firestore';
import { Jogo } from '../../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { ArbitragemJogoModalComponent } from '../../../../shared/components/arbitragem-jogo-modal/arbitragem-jogo-modal.component';
import { AnexosJogoModalComponent } from '../../../../shared/components/anexos-jogo-modal/anexos-jogo-modal.component';
import { PontosExtrasModalComponent } from '../../../../shared/components/pontos-extras-modal/pontos-extras-modal.component';
import { ArteDoJogoModalComponent } from '../../../../shared/components/arte-do-jogo-modal/arte-do-jogo-modal.component';
import { SumulaPage } from '../sumula/sumula.page';
import { EquipesService } from '../../../../campeonatos/equipes.service';
import { CampeonatosService } from '../../../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../../../campeonatos/categorias.service';

@Component({
  selector: 'app-editar-informacoes-modal',
  templateUrl: './editar-informacoes-modal.component.html',
  styleUrls: ['./editar-informacoes-modal.component.scss'],
  standalone: false,
})
export class EditarInformacoesModalComponent implements OnInit {
  @Input() campeonatoId = '';
  @Input() categoriaId = '';
  @Input() jogo!: Jogo;

  private readonly fb = inject(FormBuilder);
  private readonly jogosSrv = inject(JogosService);
  private readonly equipesSrv = inject(EquipesService);
  private readonly campeonatosSrv = inject(CampeonatosService);
  private readonly categoriasSrv = inject(CategoriasService);
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);

  salvando = false;

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: [''],
    /** Data isolada — YYYY-MM-DD. Setada pelo app-date-input mode='date'. */
    data: [''],
    /** Hora isolada — HH:mm. Setada pelo app-date-input mode='time'. */
    hora: [''],
    local: [''],
    aviso: [''],
  });

  ngOnInit(): void {
    if (this.jogo) {
      // O Jogo.dataHora pode vir como ISO completo (YYYY-MM-DDTHH:mm) ou como
      // BR (dd/mm/aaaa hh:mm) em registros antigos. Normaliza pra ISO e quebra
      // em `data` (YYYY-MM-DD) + `hora` (HH:mm) pra alimentar os 2 pickers.
      const dh = this.jogo.dataHora ?? '';
      let dataIso = '';
      let horaIso = '';
      if (dh) {
        // Tenta detectar formato BR primeiro pra converter pra ISO.
        const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(dh);
        if (brMatch) {
          dataIso = `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
          if (brMatch[4]) horaIso = `${brMatch[4]}:${brMatch[5]}`;
        } else {
          // Assume ISO YYYY-MM-DD[THH:mm]
          const [d, h] = dh.split('T');
          if (d) dataIso = d.slice(0, 10);
          if (h) horaIso = h.slice(0, 5);
        }
      }
      this.form.patchValue({
        titulo: this.jogo.titulo ?? '',
        data: dataIso,
        hora: horaIso,
        local: this.jogo.local ?? '',
        aviso: this.jogo.aviso ?? '',
      });
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    if (!this.jogo?.id) return;
    const v = this.form.getRawValue();
    // Os campos `data` (YYYY-MM-DD) e `hora` (HH:mm) vêm dos pickers
    // dedicados. Combina pra montar o ISO armazenado em jogo.dataHora.
    const dataIsoCampo = (v.data as string).trim();
    const horaIsoCampo = (v.hora as string).trim();
    let dataHora = '';
    if (dataIsoCampo && horaIsoCampo) {
      dataHora = `${dataIsoCampo}T${horaIsoCampo}`;
    } else if (dataIsoCampo) {
      dataHora = dataIsoCampo;
    }
    // Firestore NÃO aceita `undefined` em updateDoc — construímos o patch
    // só com valores definidos. Pra REMOVER um campo, usa `deleteField()`.
    const titulo = (v.titulo as string).trim();
    const local = (v.local as string).trim();
    const aviso = (v.aviso as string).trim();

    const patch: { [k: string]: unknown } = {};
    if (titulo) patch['titulo'] = titulo; else if (this.jogo.titulo) patch['titulo'] = deleteField();
    if (dataHora) patch['dataHora'] = dataHora; else if (this.jogo.dataHora) patch['dataHora'] = deleteField();
    if (local) patch['local'] = local; else if (this.jogo.local) patch['local'] = deleteField();
    if (aviso) patch['aviso'] = aviso; else if (this.jogo.aviso) patch['aviso'] = deleteField();
    this.salvando = true;
    try {
      // Cast pra Partial<Jogo> — deleteField() devolve FieldValue que o
      // updateDoc do Firestore aceita, mas TypeScript não consegue inferir.
      await this.jogosSrv.atualizar(
        this.campeonatoId,
        this.categoriaId,
        this.jogo.id,
        patch as Partial<Jogo>,
      );
      await this.toast('Informações salvas.', 'success');
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[EditarInfo] salvar erro', err);
      await this.toast('Erro ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  async emBreve(label: string): Promise<void> {
    await this.toast(`"${label}" em desenvolvimento.`, 'medium');
  }

  /** Abre modal de Anexos do jogo. */
  async abrirAnexos(): Promise<void> {
    if (!this.jogo?.id) return;
    const modal = await this.modalCtrl.create({
      component: AnexosJogoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogo: this.jogo,
      },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ saved?: boolean }>();
    if (data?.saved) {
      // Atualiza referência local pra refletir no badge.
      const fresh = await firstValueFrom(
        this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogo.id!),
      );
      if (fresh) this.jogo = fresh;
    }
  }

  /**
   * Abre o modal "Arte do Jogo" — gera arte visual em 3 layouts. Carrega
   * equipes (pra escudo + nome) + campeonato + categoria (pra título e
   * subtítulo padrão).
   */
  async abrirArteDoJogo(): Promise<void> {
    if (!this.jogo?.id) return;
    const [equipes, campeonato, categoria] = await Promise.all([
      firstValueFrom(this.equipesSrv.list$(this.campeonatoId, this.categoriaId)),
      firstValueFrom(this.campeonatosSrv.get$(this.campeonatoId)),
      firstValueFrom(this.categoriasSrv.get$(this.campeonatoId, this.categoriaId)),
    ]);
    const mandante = equipes.find(e => e.id === this.jogo.mandanteId);
    const visitante = equipes.find(e => e.id === this.jogo.visitanteId);
    const modal = await this.modalCtrl.create({
      component: ArteDoJogoModalComponent,
      componentProps: {
        jogo: this.jogo,
        mandante,
        visitante,
        campeonato,
        categoria,
      },
      cssClass: 'modal-arte-jogo',
      backdropDismiss: true,
    });
    await modal.present();
  }

  /** Abre o modal de Pontos Extras (bônus/penalidades manuais do jogo). */
  async abrirPontosExtras(): Promise<void> {
    if (!this.jogo?.id) return;
    const equipes = await firstValueFrom(
      this.equipesSrv.list$(this.campeonatoId, this.categoriaId),
    );
    const modal = await this.modalCtrl.create({
      component: PontosExtrasModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogo: this.jogo,
        equipes,
      },
      backdropDismiss: true,
    });
    await modal.present();
    await modal.onDidDismiss();
    // Recarrega o jogo pra refletir mudanças no modal pai
    const fresh = await firstValueFrom(
      this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogo.id!),
    );
    if (fresh) this.jogo = fresh;
  }

  /** Abre modal de Arbitragem do jogo. */
  async abrirArbitragem(): Promise<void> {
    if (!this.jogo?.id) return;
    const modal = await this.modalCtrl.create({
      component: ArbitragemJogoModalComponent,
      componentProps: {
        campeonatoId: this.campeonatoId,
        categoriaId: this.categoriaId,
        jogo: this.jogo,
      },
      backdropDismiss: true,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{ saved?: boolean }>();
    if (data?.saved) {
      const fresh = await firstValueFrom(
        this.jogosSrv.get$(this.campeonatoId, this.categoriaId, this.jogo.id!),
      );
      if (fresh) this.jogo = fresh;
    }
  }

  /** Navega para a página de súmula imprimível do jogo. */
  async abrirSumula(): Promise<void> {
    if (!this.jogo?.id) return;
    // Abre a SumulaPage como MODAL (em vez de navegar pra rota dedicada)
    // — UX consistente com os outros itens da lista (Anexos, Arbitragem
    // etc). A própria página detecta `isModal=true` e troca o botão
    // "Voltar" por "Fechar modal", preservando a opção de imprimir.
    const modal = await this.modalCtrl.create({
      component: SumulaPage,
      cssClass: 'sumula-modal',
      componentProps: {
        isModal: true,
        campeonatoIdInput: this.campeonatoId,
        categoriaIdInput: this.categoriaId,
        jogoIdInput: this.jogo.id,
      },
      backdropDismiss: true,
    });
    await modal.present();
  }

  /** Contadores pra badge nos botões da lista. */
  qtdArbitros(): number {
    return this.jogo?.arbitros?.length ?? 0;
  }

  qtdAnexos(): number {
    return this.jogo?.anexos?.length ?? 0;
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color,
    });
    await t.present();
  }
}
