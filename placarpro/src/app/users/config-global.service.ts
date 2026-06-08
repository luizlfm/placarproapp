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
import { environment } from '../../environments/environment';

/**
 * Documento de configurações globais — armazenado em `config/global`.
 * Permite ao admin master editar valores que antes eram hardcoded em
 * `environment.ts` SEM precisar fazer redeploy.
 *
 * Quando o doc não existe, os valores de `environment.ts` são usados
 * como fallback. Ao salvar pela primeira vez via admin, o doc é criado.
 */
export interface ConfigGlobal {
  /** Códigos válidos para signup como organizador. */
  organizadorInviteCodes?: string[];
  /** Códigos válidos para signup como moderador. */
  moderadorInviteCodes?: string[];
  /** Modo manutenção — quando true, bloqueia logins não-admin. */
  modoManutencao?: boolean;
  /** Mensagem opcional exibida no modo manutenção. */
  mensagemManutencao?: string;
  /** URL base do Asaas para gerar cobranças. */
  asaasUrl?: string;
  /**
   * Liga/desliga TODA a transmissão ao vivo do sistema (kill switch global).
   * Quando `false`: ninguém consegue iniciar novas transmissões E qualquer
   * transmissão ativa some pra todos os espectadores (app + páginas públicas).
   * Default `true` (transmissão habilitada).
   */
  transmissoesHabilitadas?: boolean;
  /** Auditoria. */
  atualizadoEm?: Timestamp;
  atualizadoPor?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigGlobalService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);

  /** Stream do doc de configurações globais. Cai pra defaults se não existir. */
  config$(): Observable<ConfigGlobal> {
    return runInInjectionContext(this.injector, () => {
      const ref = doc(this.fs, 'config', 'global');
      return (docData(ref) as Observable<ConfigGlobal | undefined>).pipe(
        map(c => this.mergeDefaults(c)),
        catchError(err => {
          console.warn('[ConfigGlobal] leitura falhou — usando defaults', err);
          return of(this.mergeDefaults(undefined));
        }),
      );
    });
  }

  /**
   * Stream booleano do kill switch global de transmissão ao vivo.
   * `true` = habilitada (default), `false` = desabilitada pelo admin.
   * Atalho sobre `config$()` pra quem só precisa dessa flag.
   */
  transmissoesHabilitadas$(): Observable<boolean> {
    return this.config$().pipe(map(c => c.transmissoesHabilitadas !== false));
  }

  /** Atualiza o doc de config. Admin master only (rules garantem). */
  async salvar(patch: Partial<ConfigGlobal>, uidAdmin?: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'config', 'global');
      // O Firestore rejeita campos `undefined`. Só inclui `atualizadoPor`
      // quando o uid do admin for conhecido (chamadas sem uid não gravam).
      const payload: Record<string, unknown> = {
        ...patch,
        atualizadoEm: serverTimestamp() as unknown as Timestamp,
      };
      if (uidAdmin) payload['atualizadoPor'] = uidAdmin;
      await setDoc(ref, payload, { merge: true });
    });
  }

  /**
   * Mescla doc do Firestore com defaults do environment.
   * Garante que arrays sempre venham preenchidos.
   */
  private mergeDefaults(c: ConfigGlobal | undefined): ConfigGlobal {
    return {
      organizadorInviteCodes:
        c?.organizadorInviteCodes ?? environment.organizadorInviteCodes ?? [],
      moderadorInviteCodes:
        c?.moderadorInviteCodes ?? environment.moderadorInviteCodes ?? [],
      modoManutencao: c?.modoManutencao ?? false,
      mensagemManutencao: c?.mensagemManutencao ?? '',
      asaasUrl: c?.asaasUrl ?? 'https://www.asaas.com',
      transmissoesHabilitadas: c?.transmissoesHabilitadas ?? true,
      atualizadoEm: c?.atualizadoEm,
      atualizadoPor: c?.atualizadoPor,
    };
  }
}
