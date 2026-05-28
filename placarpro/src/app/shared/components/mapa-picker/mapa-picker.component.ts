import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input,
  OnDestroy, Output, ViewChild, inject,
} from '@angular/core';
import { ToastController } from '@ionic/angular';
import * as L from 'leaflet';

/**
 * Componente **embeddable** de seleção de local em mapa interativo.
 *
 * Diferente do modal: não tem header/footer próprios — apenas o corpo
 * (busca + endereço + mapa + footer com coords + botões). Pode ser
 * usado inline dentro de outro modal (ex: LocaisCadastrados) OU
 * envelopado por um modal wrapper (MapaPickerModalComponent).
 *
 * Usa Leaflet + tiles OSM (gratuito, sem cadastro).
 */
@Component({
  selector: 'app-mapa-picker',
  templateUrl: './mapa-picker.component.html',
  styleUrls: ['./mapa-picker.component.scss'],
  standalone: false,
})
export class MapaPickerComponent implements AfterViewInit, OnDestroy {
  /** Lat inicial (se nulo, usa fallback no Brasil). */
  @Input() lat: number | null = null;
  @Input() lng: number | null = null;
  /** Endereço inicial (preenche barra de busca). */
  @Input() endereco = '';
  /** Quando true, exibe botões Cancelar/Confirmar no rodapé do próprio
   *  componente. Quando false, esconde — o wrapper externo (ex: modal)
   *  cuida dos botões e escuta os outputs `confirmar`/`cancelar`. */
  @Input() exibirBotoes = true;

  /** Emite { lat, lng, endereco } quando o user clica Confirmar. */
  @Output() confirmar = new EventEmitter<{
    lat: number; lng: number; endereco?: string;
  }>();
  /** Emite quando o user clica Cancelar. */
  @Output() cancelar = new EventEmitter<void>();

  @ViewChild('mapaEl', { static: true }) mapaEl!: ElementRef<HTMLDivElement>;

  private readonly toastCtrl = inject(ToastController);

  // Estado UI
  busca = '';
  buscando = false;
  carregandoEndereco = false;
  /** Coordenadas atuais do pin. */
  selLat: number | null = null;
  selLng: number | null = null;
  /** Endereço após reverse-geocode. */
  enderecoSelecionado = '';

  // Leaflet
  private map?: L.Map;
  private marker?: L.Marker;
  private destruido = false;

  ngAfterViewInit(): void {
    // Aguarda um tick pro div #mapa entrar no DOM.
    setTimeout(() => this.iniciarMapa(), 50);
  }

  ngOnDestroy(): void {
    this.destruido = true;
    this.map?.remove();
  }

  /** Cria o mapa Leaflet e configura interações. */
  private iniciarMapa(): void {
    if (this.destruido) return;

    // Fix icon paths (Leaflet por padrão referencia URLs relativas do CSS)
    const defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });
    L.Marker.prototype.options.icon = defaultIcon;

    // Posição inicial: passada como input, ou Brasil (Brasília).
    const inicioLat = this.lat ?? -15.793889;
    const inicioLng = this.lng ?? -47.882778;
    const zoom = this.lat != null ? 16 : 4;

    // Usa o elemento via ViewChild (em vez de getElementById) — assim
    // funciona mesmo com várias instâncias na mesma página, e não
    // depende de um ID global único.
    this.map = L.map(this.mapaEl.nativeElement, {
      zoomControl: true,
      attributionControl: true,
    }).setView([inicioLat, inicioLng], zoom);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    // Se tem coords iniciais, já coloca o pin
    if (this.lat != null && this.lng != null) {
      this.colocarPin(this.lat, this.lng);
      if (this.endereco) this.enderecoSelecionado = this.endereco;
    }

    // Click no mapa: move o pin
    this.map.on('click', (ev: L.LeafletMouseEvent) => {
      this.colocarPin(ev.latlng.lat, ev.latlng.lng);
      this.reverseGeocode(ev.latlng.lat, ev.latlng.lng);
    });

    // Inicializa busca com endereço passado (se tiver)
    if (this.endereco && this.lat == null) {
      this.busca = this.endereco;
      setTimeout(() => this.buscarEndereco(), 200);
    }

    // Força refresh do tamanho do mapa após render (importante quando o
    // componente é embedded em containers com height dinâmico).
    setTimeout(() => this.map?.invalidateSize(), 200);
  }

  /** Cria/move o pin pra (lat, lng). */
  private colocarPin(lat: number, lng: number): void {
    if (!this.map) return;
    this.selLat = +lat.toFixed(6);
    this.selLng = +lng.toFixed(6);

    if (this.marker) {
      this.marker.setLatLng([lat, lng]);
    } else {
      this.marker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
      this.marker.on('dragend', (ev: L.LeafletEvent) => {
        const pos = (ev.target as L.Marker).getLatLng();
        this.selLat = +pos.lat.toFixed(6);
        this.selLng = +pos.lng.toFixed(6);
        this.reverseGeocode(pos.lat, pos.lng);
      });
    }
  }

  /** Geocode forward — endereço → lat/lng via Nominatim. */
  async buscarEndereco(): Promise<void> {
    const q = (this.busca ?? '').trim();
    if (!q) return;
    this.buscando = true;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      if (!r.ok) throw new Error('Falha na busca');
      const arr = (await r.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!arr.length) {
        await this.toast('Endereço não encontrado. Tente ser mais específico.', 'medium');
        return;
      }
      const lat = parseFloat(arr[0].lat);
      const lng = parseFloat(arr[0].lon);
      this.map?.setView([lat, lng], 17);
      this.colocarPin(lat, lng);
      this.enderecoSelecionado = arr[0].display_name;
    } catch (err) {
      console.error('[MapaPicker] busca erro', err);
      await this.toast('Erro ao buscar endereço.', 'danger');
    } finally {
      this.buscando = false;
    }
  }

  /** Reverse geocode — lat/lng → endereço via Nominatim. */
  private async reverseGeocode(lat: number, lng: number): Promise<void> {
    this.carregandoEndereco = true;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      if (!r.ok) return;
      const data = (await r.json()) as { display_name?: string };
      if (data.display_name) this.enderecoSelecionado = data.display_name;
    } catch (err) {
      console.warn('[MapaPicker] reverse geocode falhou', err);
    } finally {
      this.carregandoEndereco = false;
    }
  }

  /** Botão Confirmar interno. Emite o evento `confirmar` pro pai. */
  async onConfirmar(): Promise<void> {
    if (this.selLat === null || this.selLng === null) {
      await this.toast('Toque no mapa pra escolher um local.', 'medium');
      return;
    }
    this.confirmar.emit({
      lat: this.selLat,
      lng: this.selLng,
      endereco: this.enderecoSelecionado || undefined,
    });
  }

  /** Botão Cancelar interno. Emite o evento `cancelar` pro pai. */
  onCancelar(): void {
    this.cancelar.emit();
  }

  /** Botão "Limpar seleção" — remove o pin do mapa. */
  limparPin(): void {
    if (this.marker && this.map) {
      this.map.removeLayer(this.marker);
      this.marker = undefined;
    }
    this.selLat = null;
    this.selLng = null;
    this.enderecoSelecionado = '';
  }

  /** Permite ao pai forçar refresh do tamanho do mapa quando o
   *  container muda de tamanho (ex: ao abrir/fechar o picker inline). */
  invalidarTamanho(): void {
    setTimeout(() => this.map?.invalidateSize(), 100);
  }

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
