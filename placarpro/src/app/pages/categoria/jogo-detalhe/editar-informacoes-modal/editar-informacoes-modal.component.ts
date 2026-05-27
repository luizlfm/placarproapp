import { Component, Input, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { ModalController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { deleteField } from '@angular/fire/firestore';
import { Jogo, parseYoutubeVideoId } from '../../../../campeonatos/models/jogo.model';
import { JogosService } from '../../../../campeonatos/jogos.service';
import { PlanosService, PlanoDef } from '../../../../users/planos.service';
import { Observable } from 'rxjs';
import {
  dataHoraBrParaIso,
  dataHoraIsoParaBr,
} from '../../../../shared/directives/mask.directive';
import { ArbitragemJogoModalComponent } from '../../../../shared/components/arbitragem-jogo-modal/arbitragem-jogo-modal.component';
import { AnexosJogoModalComponent } from '../../../../shared/components/anexos-jogo-modal/anexos-jogo-modal.component';

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
  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);
  private readonly router = inject(Router);
  private readonly planosSrv = inject(PlanosService);

  salvando = false;

  /** Stream: o user logado tem plano com transmissão ao vivo? Quando
   *  false, o campo YouTube é exibido como bloqueado com CTA pra upgrade. */
  readonly podeTransmissao$: Observable<boolean> = this.planosSrv.podeTransmissaoAoVivo$();
  /** Plano mínimo necessário pra desbloquear transmissão (pra CTA). */
  readonly planoMinimo: PlanoDef = this.planosSrv.planoMinimoParaTransmissao();

  readonly form: FormGroup = this.fb.nonNullable.group({
    titulo: [''],
    dataHora: [''],
    local: [''],
    aviso: [''],
    /** Link do YouTube — pode ser URL completa ou só o video ID.
     *  Convertido em `youtubeVideoId` no save via `parseYoutubeVideoId()`. */
    youtubeUrl: [''],
  });

  ngOnInit(): void {
    if (this.jogo) {
      // Converte ISO (YYYY-MM-DDTHH:mm) → BR (dd/mm/aaaa hh:mm) ao carregar.
      const dataBr = dataHoraIsoParaBr(this.jogo.dataHora) || this.jogo.dataHora || '';
      this.form.patchValue({
        titulo: this.jogo.titulo ?? '',
        dataHora: dataBr,
        local: this.jogo.local ?? '',
        aviso: this.jogo.aviso ?? '',
        youtubeUrl: this.jogo.youtubeVideoId
          ? `https://youtu.be/${this.jogo.youtubeVideoId}`
          : '',
      });
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  async salvar(): Promise<void> {
    if (!this.jogo?.id) return;
    const v = this.form.getRawValue();
    // Tenta converter BR → ISO; se a entrada estiver incompleta, mantém o
    // texto digitado para que o usuário não perca o que escreveu.
    const dataDigitada = (v.dataHora as string).trim();
    const dataIso = dataHoraBrParaIso(dataDigitada);
    // Firestore NÃO aceita `undefined` em updateDoc — construímos o patch
    // só com valores definidos. Pra REMOVER um campo, usa `deleteField()`.
    const titulo = (v.titulo as string).trim();
    const dataHora = dataIso || dataDigitada;
    const local = (v.local as string).trim();
    const aviso = (v.aviso as string).trim();
    // YouTube: só processa se o user TEM plano com transmissão ao vivo.
    // Sem o plano, ignora qualquer link digitado (defesa client-side).
    const podeTransmissao = await firstValueFrom(this.podeTransmissao$);
    const youtubeVideoId = podeTransmissao
      ? parseYoutubeVideoId(v.youtubeUrl as string)
      : null;

    const patch: { [k: string]: unknown } = {};
    if (titulo) patch['titulo'] = titulo; else if (this.jogo.titulo) patch['titulo'] = deleteField();
    if (dataHora) patch['dataHora'] = dataHora; else if (this.jogo.dataHora) patch['dataHora'] = deleteField();
    if (local) patch['local'] = local; else if (this.jogo.local) patch['local'] = deleteField();
    if (aviso) patch['aviso'] = aviso; else if (this.jogo.aviso) patch['aviso'] = deleteField();
    if (youtubeVideoId) {
      patch['youtubeVideoId'] = youtubeVideoId;
    } else if (this.jogo.youtubeVideoId) {
      // Usuário limpou o campo — remove a transmissão do doc.
      patch['youtubeVideoId'] = deleteField();
    }
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
    await this.modalCtrl.dismiss();
    this.router.navigate([
      '/app/campeonato',
      this.campeonatoId,
      'categoria',
      this.categoriaId,
      'jogo',
      this.jogo.id,
      'sumula',
    ]);
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
