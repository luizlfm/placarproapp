import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/** Resposta minimalista do Nominatim (OpenStreetMap) — endpoint /search. */
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    pedestrian?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    state_district?: string;
    postcode?: string;
    country?: string;
  };
}

/** Sugestão de endereço pronta pra preencher os campos do form. */
export interface SugestaoEndereco {
  /** Rua / logradouro (sem número). */
  endereco: string;
  /** Número do imóvel (separado). */
  numero: string;
  /** Cidade/UF formatado (ex: "São Paulo / SP"). */
  cidade: string;
  /** Display name completo (mostrado no dropdown). */
  display: string;
}

/**
 * Busca endereços via Nominatim (OpenStreetMap) — gratuito, sem API key.
 * Usado pelo autocomplete de endereço em Locais e Meu Racha.
 *
 * Fair use: 1 req/seg por origem. Já usamos debounce de 350ms no caller.
 */
@Injectable({ providedIn: 'root' })
export class AddressAutocompleteService {
  private readonly http = inject(HttpClient);

  search(termo: string): Observable<SugestaoEndereco[]> {
    const q = (termo ?? '').trim();
    if (q.length < 4) return of([]);
    const url =
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
      `&format=json&addressdetails=1&countrycodes=br&limit=6`;
    return this.http.get<NominatimResult[]>(url).pipe(
      map(arr => (arr ?? []).map(r => this.formatar(r))),
      catchError(err => {
        console.warn('[AddressAutocomplete] nominatim falhou', err);
        return of([] as SugestaoEndereco[]);
      }),
    );
  }

  private formatar(r: NominatimResult): SugestaoEndereco {
    const a = r.address ?? {};
    const rua = a.road || a.pedestrian || a.suburb || a.neighbourhood || '';
    const numero = a.house_number ?? '';
    const endereco = rua || r.display_name.split(',')[0];
    const cidade = a.city || a.town || a.village || a.municipality || '';
    const uf = a.state_district || a.state || '';
    const cidadeFmt = uf ? `${cidade} / ${this.abreviarUF(uf)}` : cidade;
    return {
      endereco,
      numero,
      cidade: cidadeFmt,
      display: r.display_name,
    };
  }

  private abreviarUF(estado: string): string {
    const m: Record<string, string> = {
      'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
      'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF',
      'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA',
      'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
      'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE',
      'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
      'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR',
      'Santa Catarina': 'SC', 'São Paulo': 'SP', 'Sergipe': 'SE',
      'Tocantins': 'TO',
    };
    return m[estado] ?? estado;
  }
}
