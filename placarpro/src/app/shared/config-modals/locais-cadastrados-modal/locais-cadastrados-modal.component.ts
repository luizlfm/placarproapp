import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { Campeonato, LocalCadastrado } from '../../../campeonatos/campeonato.model';
import { CampeonatosService } from '../../../campeonatos/campeonatos.service';
import { MapaPickerModalComponent } from '../../components/mapa-picker-modal/mapa-picker-modal.component';

/**
 * Modal especializado pra `campeonato.locaisCadastrados`.
 *
 * Diferenças do ListaSimplesModal (genérico): cada local tem nome,
 * endereço opcional e lat/lng opcional. Há botão pra capturar a
 * geolocalização do dispositivo via `navigator.geolocation`.
 *
 * Suporta retrocompat com itens antigos guardados como `string`:
 * ao carregar, qualquer string é normalizada em `{ nome }`.
 */
@Component({
  selector: 'app-locais-cadastrados-modal',
  templateUrl: './locais-cadastrados-modal.component.html',
  styleUrls: ['./locais-cadastrados-modal.component.scss'],
  standalone: false,
})
export class LocaisCadastradosModalComponent implements OnInit {
  @Input() campeonatoId = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly campSrv = inject(CampeonatosService);
  private readonly toastCtrl = inject(ToastController);

  itens: LocalCadastrado[] = [];

  // Form de novo / edição
  editandoIdx: number | null = null;
  nome = '';
  endereco = '';
  lat: number | null = null;
  lng: number | null = null;

  salvando = false;

  async ngOnInit(): Promise<void> {
    if (!this.campeonatoId) return;
    const c = await firstValueFromIgnoringError(this.campSrv.get$(this.campeonatoId));
    this.itens = this.normalizar(c?.locaisCadastrados);
  }

  /**
   * Abre o picker visual de mapa. O usuário pode buscar por endereço,
   * clicar no mapa pra dropar pin, ou arrastar o pin pra ajustar. O modal
   * retorna `{ lat, lng, endereco }` que aplicamos aos campos atuais.
   */
  async selecionarNoMapa(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: MapaPickerModalComponent,
      componentProps: {
        lat: this.lat,
        lng: this.lng,
        endereco: this.endereco,
      },
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<{
      lat?: number; lng?: number; endereco?: string;
    }>();
    if (!data) return;
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      this.lat = data.lat;
      this.lng = data.lng;
    }
    // Substitui endereço só se o usuário não tinha digitado algo OU se aceitar.
    if (data.endereco && !this.endereco?.trim()) {
      this.endereco = data.endereco;
    } else if (data.endereco && data.endereco !== this.endereco) {
      // Já tinha endereço — pergunta se quer substituir? Aqui simplificamos:
      // só substitui se for completamente diferente (heurística simples).
      if (!this.endereco.includes(data.endereco.slice(0, 20))) {
        this.endereco = data.endereco;
      }
    }
  }

  /** Adiciona um novo item à lista (ou salva edição se editandoIdx !== null). */
  adicionar(): void {
    const v = (this.nome ?? '').trim();
    if (!v) return;

    const item: LocalCadastrado = { nome: v };
    if (this.endereco?.trim()) item.endereco = this.endereco.trim();
    if (this.lat !== null && this.lng !== null) {
      item.lat = this.lat;
      item.lng = this.lng;
    }

    if (this.editandoIdx !== null) {
      this.itens[this.editandoIdx] = item;
    } else {
      // Evita duplicar mesmo nome
      const ja = this.itens.findIndex(i => i.nome.toLowerCase() === v.toLowerCase());
      if (ja >= 0) {
        this.itens[ja] = item;
      } else {
        this.itens.push(item);
      }
    }
    this.limparForm();
  }

  /** Coloca o item no form pra editar (e remove da lista até confirmar). */
  editar(idx: number): void {
    const it = this.itens[idx];
    this.editandoIdx = idx;
    this.nome = it.nome;
    this.endereco = it.endereco ?? '';
    this.lat = it.lat ?? null;
    this.lng = it.lng ?? null;
  }

  remover(idx: number): void {
    this.itens.splice(idx, 1);
    if (this.editandoIdx === idx) this.limparForm();
  }

  cancelarEdicao(): void {
    this.limparForm();
  }

  /** Reseta o form sem mexer na lista. */
  private limparForm(): void {
    this.nome = '';
    this.endereco = '';
    this.lat = null;
    this.lng = null;
    this.editandoIdx = null;
  }

  /** Persiste no Firestore como `LocalCadastrado[]` (string antigo já foi normalizado). */
  async salvar(): Promise<void> {
    if (!this.campeonatoId) return;
    this.salvando = true;
    try {
      const patch: Partial<Campeonato> = { locaisCadastrados: this.itens };
      await this.campSrv.atualizar(this.campeonatoId, patch);
      await this.modalCtrl.dismiss({ saved: true });
    } catch (err) {
      console.error('[LocaisCadastrados] salvar erro', err);
      await this.toast('Falha ao salvar.', 'danger');
    } finally {
      this.salvando = false;
    }
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
  }

  /** True se o local tem coordenadas GPS gravadas. */
  temGps(it: LocalCadastrado): boolean {
    return typeof it.lat === 'number' && typeof it.lng === 'number';
  }

  /** Abre o mapa externo (Google Maps no Android, Apple Maps no iOS, etc.). */
  abrirNoMapa(it: LocalCadastrado, ev: Event): void {
    ev.stopPropagation();
    if (!this.temGps(it)) return;
    const url = `https://www.google.com/maps?q=${it.lat},${it.lng}`;
    window.open(url, '_blank');
  }

  /** Normaliza itens vindos do Firestore (alguns são strings legadas). */
  private normalizar(raw: (string | LocalCadastrado)[] | undefined): LocalCadastrado[] {
    if (!raw) return [];
    return raw.map(v => typeof v === 'string' ? { nome: v } : v);
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}

/** Lê 1ª emissão de um Observable, ignorando erros. */
async function firstValueFromIgnoringError<T>(obs$: Observable<T>): Promise<T | undefined> {
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
