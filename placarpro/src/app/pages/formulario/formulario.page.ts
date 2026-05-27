import { Component, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { BehaviorSubject, Observable, of, switchMap } from 'rxjs';
import { map } from 'rxjs/operators';
import { CampeonatosService } from '../../campeonatos/campeonatos.service';
import { CategoriasService } from '../../campeonatos/categorias.service';
import { InscricoesService } from '../../campeonatos/inscricoes.service';
import { Campeonato } from '../../campeonatos/campeonato.model';
import { Categoria } from '../../campeonatos/categoria.model';
import { Inscricao, InscricaoStatus } from '../../campeonatos/models/inscricao.model';

@Component({
  selector: 'app-formulario',
  templateUrl: './formulario.page.html',
  styleUrls: ['./formulario.page.scss'],
  standalone: false,
  host: { class: 'ion-page' },
})
export class FormularioPage {
  private readonly campSrv = inject(CampeonatosService);
  private readonly catSrv = inject(CategoriasService);
  private readonly inscSrv = inject(InscricoesService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);

  readonly campeonatos$: Observable<Campeonato[]> = this.campSrv.listMeus$();

  campeonatoSelecionado: Campeonato | null = null;
  filtroStatus: InscricaoStatus | 'todas' = 'pendente';

  private readonly campSubject = new BehaviorSubject<string | null>(null);

  readonly inscricoes$: Observable<Inscricao[]> = this.campSubject.pipe(
    switchMap(id => id ? this.inscSrv.list$(id) : of<Inscricao[]>([])),
    map(arr => this.filtroStatus === 'todas' ? arr : arr.filter(i => i.status === this.filtroStatus)),
  );

  categorias$: Observable<Categoria[]> = of([]);

  selecionarCampeonato(c: Campeonato): void {
    this.campeonatoSelecionado = c;
    this.campSubject.next(c.id ?? null);
    if (c.id) this.categorias$ = this.catSrv.list$(c.id);
  }

  voltarLista(): void {
    this.campeonatoSelecionado = null;
    this.campSubject.next(null);
  }

  setFiltro(s: InscricaoStatus | 'todas'): void {
    this.filtroStatus = s;
    const id = this.campSubject.value;
    this.campSubject.next(id);
  }

  async copiarLink(c: Campeonato, ev?: Event): Promise<void> {
    if (ev) ev.stopPropagation();
    const slug = c.slug || c.id || '';
    const url = `${location.origin}/p/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      await this.toast('Link copiado para a área de transferência.', 'success');
    } catch {
      await this.toast(url, 'success');
    }
  }

  async novaInscricao(): Promise<void> {
    const c = this.campeonatoSelecionado;
    if (!c?.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Nova inscrição',
      message: 'Cadastre manualmente um pedido para essa equipe.',
      inputs: [
        { name: 'nomeEquipe', type: 'text',  placeholder: 'Nome da equipe *' },
        { name: 'responsavel', type: 'text', placeholder: 'Responsável *' },
        { name: 'telefone',  type: 'tel',    placeholder: 'Telefone' },
        { name: 'email',     type: 'email',  placeholder: 'E-mail' },
        { name: 'cidade',    type: 'text',   placeholder: 'Cidade' },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Adicionar',
          handler: async (data: Record<string, string>) => {
            if (!data['nomeEquipe']?.trim() || !data['responsavel']?.trim()) {
              await this.toast('Nome da equipe e responsável são obrigatórios.', 'danger');
              return false;
            }
            try {
              await this.inscSrv.criar(c.id!, {
                campeonatoId: c.id!,
                nomeEquipe: data['nomeEquipe'].trim(),
                responsavel: data['responsavel'].trim(),
                telefone: data['telefone']?.trim() || undefined,
                email: data['email']?.trim() || undefined,
                cidade: data['cidade']?.trim() || undefined,
              });
              await this.toast('Inscrição registrada.', 'success');
              return true;
            } catch (err) {
              console.error(err);
              await this.toast('Falha ao salvar.', 'danger');
              return false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async designarCategoria(insc: Inscricao): Promise<void> {
    const c = this.campeonatoSelecionado;
    if (!c?.id || !insc.id) return;
    const cats = await new Promise<Categoria[]>(resolve => {
      const sub = this.catSrv.list$(c.id!).subscribe(list => {
        resolve(list);
        setTimeout(() => sub.unsubscribe(), 0);
      });
    });
    if (cats.length === 0) {
      await this.toast('Crie uma categoria antes.', 'danger');
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Categoria',
      inputs: cats.map(cat => ({
        type: 'radio',
        label: cat.titulo,
        value: cat.id,
        checked: insc.categoriaId === cat.id,
      })),
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Salvar',
          handler: async (catId: string) => {
            if (!catId) return false;
            await this.inscSrv.atualizar(c.id!, insc.id!, { categoriaId: catId });
            await this.toast('Categoria atualizada.', 'success');
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async aprovar(insc: Inscricao): Promise<void> {
    const c = this.campeonatoSelecionado;
    if (!c?.id || !insc.id) return;
    if (!insc.categoriaId) {
      await this.designarCategoria(insc);
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Aprovar inscrição?',
      message: `A equipe "${insc.nomeEquipe}" será criada na categoria.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Aprovar',
          handler: async () => {
            try {
              await this.inscSrv.aprovar(c.id!, insc.id!, insc);
              await this.toast('Inscrição aprovada e equipe criada.', 'success');
            } catch (err) {
              console.error(err);
              await this.toast('Falha ao aprovar.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async rejeitar(insc: Inscricao): Promise<void> {
    const c = this.campeonatoSelecionado;
    if (!c?.id || !insc.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Rejeitar inscrição?',
      inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Motivo (opcional)' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Rejeitar',
          role: 'destructive',
          handler: async (data: { motivo?: string }) => {
            try {
              await this.inscSrv.rejeitar(c.id!, insc.id!, data?.motivo?.trim() || undefined);
              await this.toast('Inscrição rejeitada.', 'success');
            } catch (err) {
              console.error(err);
              await this.toast('Falha ao rejeitar.', 'danger');
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async remover(insc: Inscricao): Promise<void> {
    const c = this.campeonatoSelecionado;
    if (!c?.id || !insc.id) return;
    const alert = await this.alertCtrl.create({
      header: 'Remover inscrição?',
      message: `O pedido de "${insc.nomeEquipe}" será apagado.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Remover',
          role: 'destructive',
          handler: async () => {
            await this.inscSrv.remover(c.id!, insc.id!);
            await this.toast('Removida.', 'success');
          },
        },
      ],
    });
    await alert.present();
  }

  trackById(_i: number, x: { id?: string }): string {
    return x.id ?? `${_i}`;
  }

  badgeStatus(s: InscricaoStatus): { label: string; color: string } {
    switch (s) {
      case 'pendente':  return { label: 'Pendente',  color: '#F1B500' };
      case 'aprovada':  return { label: 'Aprovada',  color: '#7CC61D' };
      case 'rejeitada': return { label: 'Rejeitada', color: '#E55353' };
    }
  }

  private async toast(message: string, color: 'success' | 'danger' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({
      message, duration: 2200, position: 'top', color,
    });
    await t.present();
  }
}
