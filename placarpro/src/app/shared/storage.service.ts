import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { Storage, ref, uploadBytes, getDownloadURL, deleteObject } from '@angular/fire/storage';
import { AuthService } from '../auth/auth.service';

/**
 * Upload e remoção de arquivos no Firebase Storage.
 * Convenções de path:
 *  - `users/{uid}/avatar.{ext}`
 *  - `users/{uid}/campeonatos/{campeonatoId}/logo.{ext}`
 *  - `users/{uid}/campeonatos/{campeonatoId}/capa.{ext}`
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly storage = inject(Storage);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  /** Faz upload de um Blob/File e retorna a URL pública (pode ser usada em <img>).
   *
   *  IMPORTANTE — cache-busting:
   *  O Firebase Storage gera um token no `getDownloadURL` que NÃO muda
   *  quando o mesmo path é sobrescrito (mesma URL, mesmo token). Sem
   *  isso, o navegador trata como o mesmo recurso e mostra a IMAGEM
   *  ANTIGA do cache, mesmo depois de uploadar uma nova. Resolvemos
   *  adicionando `&cb=<timestamp>` na URL retornada — força o browser
   *  a tratar cada upload como recurso novo. */
  async upload(path: string, blob: Blob): Promise<string> {
    return runInInjectionContext(this.injector, async () => {
      const r = ref(this.storage, path);
      await uploadBytes(r, blob);
      const url = await getDownloadURL(r);
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}cb=${Date.now()}`;
    });
  }

  /** Helper: upload com path canônico do campeonato.
   *  Os tipos `logo-mobile` e `capa-mobile` armazenam a variante otimizada
   *  pra viewport estreito (proporção diferente). Quando não existem,
   *  a variante web é usada como fallback. */
  async uploadCampeonatoAsset(
    campeonatoId: string,
    tipo: 'logo' | 'logo-mobile' | 'capa' | 'capa-mobile' | 'banner-app' | 'banner-site',
    blob: Blob,
  ): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const path = `users/${uid}/campeonatos/${campeonatoId}/${tipo}.${ext}`;
    return this.upload(path, blob);
  }

  /** Helper: upload com path canônico de uma CATEGORIA.
   *  Espelha o helper de campeonato, mas o path desce mais um nível:
   *  `users/{uid}/campeonatos/{campId}/categorias/{catId}/{tipo}.{ext}`.
   *  Tipos web/mobile separados pra não sobrescrever a variante alternativa
   *  quando o organizador troca só uma delas. */
  async uploadCategoriaAsset(
    campeonatoId: string,
    categoriaId: string,
    tipo: 'logo' | 'logo-mobile' | 'capa' | 'capa-mobile' | 'banner',
    blob: Blob,
  ): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const path = `users/${uid}/campeonatos/${campeonatoId}/categorias/${categoriaId}/${tipo}.${ext}`;
    return this.upload(path, blob);
  }

  /** Helper: upload de avatar/imagem do perfil. */
  async uploadUserAsset(tipo: 'avatar' | 'banner-app' | 'banner-site', blob: Blob): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const path = `users/${uid}/${tipo}.${ext}`;
    return this.upload(path, blob);
  }

  /** Helper: upload do escudo (logo) de uma equipe. */
  async uploadEquipeLogo(
    campeonatoId: string,
    categoriaId: string,
    equipeId: string,
    blob: Blob,
  ): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const path = `users/${uid}/campeonatos/${campeonatoId}/categorias/${categoriaId}/equipes/${equipeId}/logo.${ext}`;
    return this.upload(path, blob);
  }

  /** Helper: upload da foto de um jogador. */
  async uploadJogadorFoto(
    campeonatoId: string,
    categoriaId: string,
    jogadorId: string,
    blob: Blob,
  ): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const path = `users/${uid}/campeonatos/${campeonatoId}/categorias/${categoriaId}/jogadores/${jogadorId}/foto.${ext}`;
    return this.upload(path, blob);
  }

  /** Helper: upload de mídia (foto/vídeo) de um lance de evento. */
  async uploadEventoMidia(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    eventoId: string,
    blob: Blob,
  ): Promise<string> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `users/${uid}/campeonatos/${campeonatoId}/categorias/${categoriaId}/jogos/${jogoId}/eventos/${eventoId}/${ts}-${rand}.${ext}`;
    return this.upload(path, blob);
  }

  /** Helper: logo de patrocinador vinculado a uma partida específica.
   *  Path: `users/{uid}/campeonatos/{campId}/categorias/{catId}/jogos/{jogoId}/patrocinadores/{idx}.{ext}` */
  async uploadPatrocinadorJogoLogo(
    campeonatoId: string,
    categoriaId: string,
    jogoId: string,
    idx: number,
    blob: Blob,
  ): Promise<{ url: string; path: string }> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Não autenticado');
    const ext = this.guessExt(blob.type);
    const ts = Date.now();
    const path = `users/${uid}/campeonatos/${campeonatoId}/categorias/${categoriaId}/jogos/${jogoId}/patrocinadores/${idx}-${ts}.${ext}`;
    const url = await this.upload(path, blob);
    return { url, path };
  }

  async remove(path: string): Promise<void> {
    await runInInjectionContext(this.injector, async () => {
      const r = ref(this.storage, path);
      await deleteObject(r);
    });
  }

  private guessExt(mime: string): string {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('quicktime') || mime.includes('mov')) return 'mov';
    if (mime.includes('avi')) return 'avi';
    return 'bin';
  }
}
