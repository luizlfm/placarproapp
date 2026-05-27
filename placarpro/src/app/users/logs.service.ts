import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import {
  CollectionReference,
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { LogAuditoria, LogAcao } from './models/log-auditoria.model';
import { AuthService } from '../auth/auth.service';

/**
 * Service de logs de auditoria.
 *
 * Uso típico:
 *   constructor(private logs: LogsService) {}
 *   await this.logs.registrar('campeonato_criado', `Criou campeonato ${titulo}`);
 *
 * O service tenta capturar automaticamente o usuário logado. Em caso de falha
 * de escrita (rules, offline), engole silenciosamente — log não bloqueia
 * fluxo de negócio.
 */
@Injectable({ providedIn: 'root' })
export class LogsService {
  private readonly fs = inject(Firestore);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);

  private col(): CollectionReference<LogAuditoria> {
    return collection(this.fs, 'logs') as CollectionReference<LogAuditoria>;
  }

  /** Lista os últimos N logs (default 100). */
  listRecentes$(n = 100): Observable<LogAuditoria[]> {
    return runInInjectionContext(this.injector, () => {
      const q = query(this.col(), orderBy('criadoEm', 'desc'), limit(n));
      return collectionData(q, { idField: 'id' }) as Observable<LogAuditoria[]>;
    });
  }

  /**
   * Registra uma nova entrada no log. Engole erros — logging nunca deve
   * quebrar o fluxo de negócio.
   */
  async registrar(
    acao: LogAcao,
    descricao: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return runInInjectionContext(this.injector, async () => {
      try {
        const u = this.auth.currentUser;
        const payload: LogAuditoria = {
          acao,
          descricao,
          meta,
          usuarioId: u?.uid,
          usuarioLabel: u?.displayName ?? u?.email ?? undefined,
          criadoEm: Timestamp.now(),
        };
        await addDoc(this.col(), payload);
      } catch (err) {
        // Silencioso — logging falho não deve quebrar nada
        console.warn('[Logs] registrar falhou', err);
      }
    });
  }
}
