import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  Timestamp,
  doc,
  docData,
  setDoc,
  serverTimestamp,
} from '@angular/fire/firestore';
import { Observable, map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Override de um plano — valores que o admin pode editar pra sobrescrever
 * os defaults hardcoded em `planos.service.ts`. Campos ausentes mantêm o
 * default do código.
 */
export interface PlanoOverride {
  /** Preços por periodicidade (total cobrado em R$). */
  precos?: {
    mensal?: number;
    trimestral?: number;
    semestral?: number;
    anual?: number;
  };
  /** Limites quantitativos. -1 = ilimitado. */
  limites?: {
    maxCampeonatos?: number;
    maxCategoriasPorCampeonato?: number;
    maxJogadoresPorCategoria?: number;
    maxPatrocinadores?: number;
    maxVideoSegundos?: number;
    maxTransmisoesSimultaneas?: number;
  };
}

/**
 * Configuração COMERCIAL — preços/limites dos planos e preços dos créditos.
 * Armazenado em `config/comercial`. Permite ao admin master editar valores
 * que antes eram hardcoded SEM redeploy.
 *
 * Quando o doc (ou um campo) não existe, os defaults do código são usados
 * como fallback (ver `PlanosService`).
 */
/**
 * Configuração de um tipo de crédito (preço + parâmetros editáveis).
 * Campos ausentes mantêm o default do código.
 *
 * Compat: aceita também um `number` simples (formato legado = só o preço).
 */
export interface CreditoConfig {
  /** Preço unitário em R$. */
  preco?: number;
  /** Patrocinadores liberados:
   *  - Normal: logos por crédito (default 2)
   *  - Premium: máx. de anunciantes premium por jogo (default 3) */
  patrocinadores?: number;
  /** Tempo de exibição em minutos (Normal/transmissão). Normal default 60. */
  duracaoMin?: number;
  /** Premium: janela visível em segundos (default 6). */
  janelaSeg?: number;
  /** Premium: intervalo entre janelas em minutos (default 7). */
  intervaloMin?: number;
  /** Transmissão: validade do crédito em meses (default 12). */
  validadeMeses?: number;
}

export interface ConfigComercial {
  /** Overrides por id de plano: 'gratis' | 'pequeno' | 'medio' | 'grande' | 'profissional'. */
  planos?: { [planoId: string]: PlanoOverride };
  /** Configuração dos créditos. `number` é aceito como legado (= só o preço). */
  creditos?: {
    /** Crédito de patrocinador NORMAL. */
    patrocinioNormal?: CreditoConfig | number;
    /** Crédito de patrocinador PREMIUM. */
    patrocinioPremium?: CreditoConfig | number;
    /** Crédito de transmissão avulsa. */
    transmissaoAvulsa?: CreditoConfig | number;
  };
  atualizadoEm?: Timestamp;
  atualizadoPor?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigComercialService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  /** Stream do doc de config comercial. Cai pra `{}` quando não existe. */
  config$(): Observable<ConfigComercial> {
    return runInInjectionContext(this.injector, () => {
      const ref = doc(this.fs, 'config', 'comercial');
      return (docData(ref) as Observable<ConfigComercial | undefined>).pipe(
        map(c => c ?? {}),
        catchError(err => {
          console.warn('[ConfigComercial] leitura falhou — usando defaults', err);
          return of({} as ConfigComercial);
        }),
      );
    });
  }

  /** Atualiza o doc de config comercial. Admin master only (rules garantem). */
  async salvar(patch: Partial<ConfigComercial>, uidAdmin?: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'config', 'comercial');
      await setDoc(
        ref,
        {
          ...patch,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
          atualizadoPor: uidAdmin ?? null,
        },
        { merge: true },
      );
    });
  }
}
