import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ConfigComercialService, ConfigComercial } from '../users/config-comercial.service';
import { PlanoDef, PlanoPrecos } from '../users/planos.service';
import { PlanoRachaId } from '../users/models/cobranca.model';

/**
 * Definição de um plano de RACHA (pelada). É um superset de {@link PlanoDef}
 * (campos `id`/`label`/`precos`/`preco` são compatíveis) pra poder reusar o
 * modal de periodicidade e os helpers de preço do `PlanosService`.
 *
 * O `id` é um {@link PlanoRachaId} ('gratis' | 'premium' | 'pro'), distinto
 * dos planos de campeonato.
 */
export interface RachaPlanoDef extends Omit<PlanoDef, 'id'> {
  id: PlanoRachaId;
}

/** Limites neutros — planos de racha não usam os limites de campeonato. */
const LIMITES_NEUTROS: PlanoDef['limites'] = {
  maxCampeonatos: -1,
  maxCategoriasPorCampeonato: -1,
  maxJogadoresPorCategoria: -1,
  maxPatrocinadores: -1,
  maxVideoSegundos: -1,
  permiteApiPublica: false,
  permiteEmbedHtml: false,
  permiteWhiteLabel: false,
  maxTransmisoesSimultaneas: 0,
  valorTransmissaoAvulsa: 30,
};

const RACHA_GRATIS: RachaPlanoDef = {
  id: 'gratis',
  label: 'Gratuito',
  preco: 0,
  precos: { mensal: 0, trimestral: 0, semestral: 0, anual: 0 },
  cor: '#94a3b8',
  resumo: 'Pra começar a organizar a pelada',
  features: [
    { icon: 'mic-outline', titulo: 'Estatísticas por voz — 50/mês' },
    { icon: 'people-outline', titulo: 'Lista de presença — 2/mês' },
    { icon: 'wallet-outline', titulo: 'Financeiro — R$ 1.000' },
  ],
  limites: LIMITES_NEUTROS,
};

const RACHA_PREMIUM: RachaPlanoDef = {
  id: 'premium',
  label: 'Racha Premium',
  preco: 19.9,
  precos: { mensal: 19.9, trimestral: 53.9, semestral: 99.9, anual: 179.9 },
  cor: '#14b8a6',
  resumo: 'Tudo ilimitado pro seu racha',
  destaque: true,
  features: [
    { icon: 'mic-outline', titulo: 'Estatísticas por voz ilimitadas' },
    { icon: 'people-outline', titulo: 'Lista de presença ilimitada' },
    { icon: 'wallet-outline', titulo: 'Financeiro ilimitado' },
  ],
  limites: LIMITES_NEUTROS,
};

const RACHA_PRO: RachaPlanoDef = {
  id: 'pro',
  label: 'Racha Premium PRO',
  preco: 24.9,
  precos: { mensal: 24.9, trimestral: 69.9, semestral: 129.9, anual: 239.9 },
  cor: '#16a34a',
  resumo: 'Premium + WhatsApp, Ao Vivo, Mercado de Notas e Conquistas',
  features: [
    { icon: 'logo-whatsapp', titulo: 'WhatsApp do Racha — incluído' },
    { icon: 'radio-outline', titulo: 'Menu Ao Vivo — liberado para todos' },
    { icon: 'star-outline', titulo: 'Avaliação de Jogadores — Mercado de Notas' },
    { icon: 'trophy-outline', titulo: 'Conquistas & Níveis — progressão completa' },
  ],
  limites: LIMITES_NEUTROS,
};

const TODOS_RACHA_PLANOS: RachaPlanoDef[] = [RACHA_GRATIS, RACHA_PREMIUM, RACHA_PRO];

/**
 * Catálogo dos planos de RACHA, com os preços editáveis pelo admin via
 * `config/comercial` → `rachaPlanos`. Espelha o `PlanosService` dos
 * campeonatos, mas mantém os planos de racha totalmente separados.
 */
@Injectable({ providedIn: 'root' })
export class RachaPlanosService {
  private readonly configComercial = inject(ConfigComercialService);

  private cfg: ConfigComercial = {};
  private merged: RachaPlanoDef[] = TODOS_RACHA_PLANOS.map(p => this.aplicarOverride(p));

  constructor() {
    this.configComercial.config$().subscribe(c => {
      this.cfg = c ?? {};
      this.merged = TODOS_RACHA_PLANOS.map(p => this.aplicarOverride(p));
    });
  }

  private aplicarOverride(def: RachaPlanoDef): RachaPlanoDef {
    const o = this.cfg.rachaPlanos?.[def.id];
    if (!o) return def;
    const precos: PlanoPrecos = {
      mensal: o.precos?.mensal ?? def.precos.mensal,
      trimestral: o.precos?.trimestral ?? def.precos.trimestral,
      semestral: o.precos?.semestral ?? def.precos.semestral,
      anual: o.precos?.anual ?? def.precos.anual,
    };
    return { ...def, preco: precos.mensal, precos };
  }

  /** Catálogo com overrides aplicados. */
  get planos(): ReadonlyArray<RachaPlanoDef> {
    return this.merged;
  }

  /** Resolve a definição de um plano de racha pelo ID (fallback p/ gratis). */
  getRachaPlanoDef(id?: PlanoRachaId | string | null): RachaPlanoDef {
    return this.merged.find(p => p.id === id) ?? this.merged[0];
  }

  /**
   * Versão tipada como {@link PlanoDef} pra passar ao modal de periodicidade
   * (que espera um PlanoDef). Compatível em runtime — o modal só lê
   * `label`/`precos`/`preco`.
   */
  getPlanoDefCompat(id?: PlanoRachaId | string | null): PlanoDef {
    return this.getRachaPlanoDef(id) as unknown as PlanoDef;
  }

  /** Stream do catálogo (reativo a mudanças de preço no admin). */
  planos$(): Observable<ReadonlyArray<RachaPlanoDef>> {
    return this.configComercial.config$().pipe(
      map(c => {
        const cfg = c ?? {};
        return TODOS_RACHA_PLANOS.map(p => {
          const o = cfg.rachaPlanos?.[p.id];
          if (!o) return p;
          const precos: PlanoPrecos = {
            mensal: o.precos?.mensal ?? p.precos.mensal,
            trimestral: o.precos?.trimestral ?? p.precos.trimestral,
            semestral: o.precos?.semestral ?? p.precos.semestral,
            anual: o.precos?.anual ?? p.precos.anual,
          };
          return { ...p, preco: precos.mensal, precos };
        });
      }),
    );
  }
}
