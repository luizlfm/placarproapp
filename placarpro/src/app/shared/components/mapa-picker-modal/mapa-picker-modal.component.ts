import { AfterViewInit, Component, Input, OnDestroy, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import * as L from 'leaflet';

/**
 * Modal de seleção de local em mapa interativo.
 *
 * Permite:
 *   - Buscar endereço (geocode via Nominatim/OpenStreetMap, sem chave)
 *   - Clicar em qualquer ponto do mapa pra dropar um pin
 *   - Arrastar o pin pra ajustar a posição
 *   - Confirmar retorna `{ lat, lng, endereco }` ao chamador
 *
 * Usa Leaflet + tiles OSM (gratuito, sem cadastro). Pra produção alta-escala,
 * trocar tiles por Mapbox/Stamen ou self-hosted.
 */
@Component({
  selector: 'app-mapa-picker-modal',
  templateUrl: './mapa-picker-modal.component.html',
  styleUrls: ['./mapa-picker-modal.component.scss'],
  standalone: false,
})
export class MapaPickerModalComponent implements AfterViewInit, OnDestroy {
  /** Lat inicial (se nulo, usa fallback no Brasil). */
  @Input() lat: number | null = null;
  @Input() lng: number | null = null;
  /** Endereço inicial (preenche barra de busca). */
  @Input() endereco = '';

  private readonly modalCtrl = inject(ModalController);
  private readonly toastCtrl = inject(ToastController);

  // Estado UI
  busca = '';
  buscando = false;
  carregandoEndereco = false;
  /** Coordenadas atuais do pin (o que será retornado ao confirmar). */
  selLat: number | null = null;
  selLng: number | null = null;
  /** Endereço que aparece na barra após reverse-geocode. */
  enderecoSelecionado = '';

  // Leaflet
  private map?: L.Map;
  private marker?: L.Marker;
  /** Pra cancelar timeouts/debounces ao fechar. */
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

    // Fix icon paths (Leaflet por padrão referencia URLs relativas pro CSS)
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

    this.map = L.map('mapa-picker', {
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

  /** Confirma e retorna { lat, lng, endereco } pro modal pai. */
  async confirmar(): Promise<void> {
    if (this.selLat === null || this.selLng === null) {
      await this.toast('Toque no mapa pra escolher um local.', 'medium');
      return;
    }
    await this.modalCtrl.dismiss({
      lat: this.selLat,
      lng: this.selLng,
      endereco: this.enderecoSelecionado || undefined,
    });
  }

  dismiss(): Promise<boolean> {
    return this.modalCtrl.dismiss();
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

  private async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', color });
    await t.present();
  }
}
