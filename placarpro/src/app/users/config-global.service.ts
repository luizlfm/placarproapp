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

  /** Atualiza o doc de config. Admin master only (rules garantem). */
  async salvar(patch: Partial<ConfigGlobal>, uidAdmin?: string): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      const ref = doc(this.fs, 'config', 'global');
      await setDoc(
        ref,
        {
          ...patch,
          atualizadoEm: serverTimestamp() as unknown as Timestamp,
          atualizadoPor: uidAdmin,
        },
        { merge: true },
      );
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
      atualizadoEm: c?.atualizadoEm,
      atualizadoPor: c?.atualizadoPor,
    };
  }
}
