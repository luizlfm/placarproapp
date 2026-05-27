import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { environment } from '../../../environments/environment';

/**
 * Serviço de transmissão ao vivo via LiveKit Cloud.
 *
 * Responsabilidades:
 *  - Buscar tokens JWT da Cloud Function `gerarTokenLiveKit` (server-side
 *    valida permissões + assina com `LIVEKIT_API_SECRET`).
 *  - Expor a URL do servidor LiveKit configurada no environment.
 *  - Servir como ponto único de entrada — os componentes (broadcaster modal,
 *    viewer player) usam este serviço; nunca chamam a Cloud Function direto.
 *
 * Por que separado dos componentes:
 *  - Reutilização: o modal broadcaster e o player viewer pedem token da
 *    mesma forma (só muda o `papel`).
 *  - Testes: mockar este serviço é mais simples do que mockar a Functions SDK.
 *  - Centralização de logs/erro: qualquer falha de auth/permissão aparece
 *    aqui antes de propagar pra UI.
 */
@Injectable({ providedIn: 'root' })
export class LiveKitService {
  private readonly functions = inject(Functions);
  private readonly injector = inject(Injector);

  /** URL do WebSocket do LiveKit Cloud (wss://...). Vem do environment. */
  get url(): string {
    return environment.livekit?.url ?? '';
  }

  /** True quando a URL não está configurada (placeholder ainda). */
  get naoConfigurado(): boolean {
    return !this.url || this.url.includes('PLACEHOLDER');
  }

  /**
   * Pede um token JWT do LiveKit pra entrar numa sala.
   *
   * @param jogoId        ID do jogo (Firestore) — determina o nome da sala.
   * @param papel         'broadcaster' (publica) ou 'viewer' (só assiste).
   * @param campeonatoId  Obrigatório pra broadcaster (checagem de permissão).
   * @param categoriaId   Opcional — permite checar moderador granular.
   *
   * @returns Token JWT + nome da sala (mesma sala recebida no servidor).
   */
  async gerarToken(args: {
    jogoId: string;
    papel: 'broadcaster' | 'viewer';
    campeonatoId?: string;
    categoriaId?: string;
  }): Promise<{ token: string; roomName: string; identity: string }> {
    if (this.naoConfigurado) {
      throw new Error(
        'LiveKit não está configurado. Cole a URL real em environment.livekit.url ' +
        'e configure os secrets LIVEKIT_API_KEY e LIVEKIT_API_SECRET nas Cloud Functions.',
      );
    }

    // `httpsCallable()` PRECISA rodar dentro do injection context (Angular
    // 17+/AngularFire 18+). O player viewer dispara `gerarToken()` a partir
    // de um callback RxJS (subscription) — fora do contexto — e sem este
    // wrapper o request fica em estado indefinido: às vezes funciona, às
    // vezes a Promise nunca resolve, o `<video>` nunca recebe track e o
    // espectador vê só uma tela preta ("Conectando..." pra sempre). Mesma
    // armadilha tratada em `cobrancas.service.ts` para `criarPagamentoMP`.
    return runInInjectionContext(this.injector, async () => {
      const fn = httpsCallable<typeof args, {
        ok: boolean;
        token: string;
        roomName: string;
        papel: 'broadcaster' | 'viewer';
        identity: string;
      }>(this.functions, 'gerarTokenLiveKit');

      const res = await fn(args);
      const d = res.data;
      if (!d?.ok || !d?.token) {
        throw new Error('Falha ao gerar token de transmissão.');
      }

      return {
        token: d.token,
        roomName: d.roomName,
        identity: d.identity,
      };
    });
  }
}
