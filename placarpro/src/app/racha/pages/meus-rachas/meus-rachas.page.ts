import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subscription, of } from 'rxjs';
import { catchError, startWith } from 'rxjs/operators';
import { AuthService } from '../../../auth/auth.service';
import { RachaService } from '../../racha.service';
import { Racha } from '../../models/racha.model';
import { AlertController, ToastController } from '@ionic/angular';

/**
 * Landing da área `/racha` — lista os rachas do usuário logado.
 *
 * UX:
 *  - Topo: header com brand + sair
 *  - CTA grande: "Criar novo racha" (verde) — leva pra `/racha/novo`
 *  - Cards dos rachas existentes (com status: rascunho/ativo/pausado)
 *  - Click no card de rascunho → leva pro wizard de ativação
 *  - Click no card ativo → leva pro dashboard do racha (futuro)
 *  - Vazio: empty state convidando a criar o primeiro
 */
@Component({
  selector: 'app-meus-rachas',
  templateUrl: './meus-rachas.page.html',
  styleUrls: ['./meus-rachas.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class MeusRachasPage implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly authSrv = inject(AuthService);
  private readonly rachaSrv = inject(RachaService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  /** Lista reativa de rachas. `startWith([])` evita "flicker" durante o load. */
  rachas$: Observable<Racha[]> = this.rachaSrv.listMeus$().pipe(
    startWith([] as Racha[]),
    catchError(err => {
      console.error('[MeusRachas] listMeus erro', err);
      return of([] as Racha[]);
    }),
  );

  loading = true;
  private sub?: Subscription;

  ngOnInit(): void {
    // Quando a primeira lista chega, marca loading=false
    this.sub = this.rachas$.subscribe(() => {
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** Volta pra home pública */
  voltarHome(): void {
    this.router.navigateByUrl('/');
  }

  /** Botão CTA — leva pra tela de criação rápida. */
  criarRacha(): void {
    this.router.navigate(['/racha/novo']);
  }

  /**
   * Click no card de um racha existente. Se estiver em rascunho (wizard
   * não concluído), leva pro wizard. Se já ativo, leva pro dashboard
   * (Início do shell).
   */
  abrirRacha(r: Racha): void {
    if (!r.id) return;
    if (!r.ativado) {
      this.router.navigate(['/racha', r.id, 'ativar']);
      return;
    }
    this.router.navigate(['/racha', r.id, 'inicio']);
  }

  /** Confirma + remove racha. */
  async removerRacha(r: Racha, ev: Event): Promise<void> {
    ev.stopPropagation();
    if (!r.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover racha?',
      message: `Confirma remover "<b>${r.nome}</b>"? Esta ação não pode ser desfeita.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            try {
              await this.rachaSrv.remover(r.id!);
              await this.toast(`"${r.nome}" foi removido.`, 'medium');
            } catch (err) {
              console.error('[MeusRachas] remover erro', err);
              await this.toast('Falha ao remover. Tente novamente.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async sair(): Promise<void> {
    try {
      await this.authSrv.signOut();
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err) {
      console.error('[MeusRachas] signOut erro', err);
    }
  }

  /** Label amigável do status. */
  labelStatus(s?: string): string {
    switch (s) {
      case 'rascunho':  return 'Configurar';
      case 'ativo':     return 'Ativo';
      case 'pausado':   return 'Pausado';
      case 'encerrado': return 'Encerrado';
      default:          return 'Configurar';
    }
  }

  trackById(_i: number, r: Racha): string {
    return r.id ?? '';
  }

  /** Showcase: info de um recurso já disponível.
   *  Em vez de navegar (não há racha selecionado nessa landing), mostra
   *  toast educativo com 1-frase do que o recurso faz. */
  async infoRecurso(nome: string, descricao: string): Promise<void> {
    const t = await this.toastCtrl.create({
      message: `${nome}: ${descricao}`,
      duration: 3500,
      position: 'top',
      color: 'success',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await t.present();
  }

  /** Showcase: aviso amigável pra recursos ainda em desenvolvimento. */
  async avisoEmBreve(feature: string): Promise<void> {
    const t = await this.toastCtrl.create({
      message: `${feature} chegando em breve. Fica de olho!`,
      duration: 2500,
      position: 'top',
      color: 'warning',
    });
    await t.present();
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
