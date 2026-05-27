import { Timestamp } from '@angular/fire/firestore';

export interface Patrocinador {
  id?: string;
  ownerId: string;
  nome: string;
  logoUrl?: string;
  /** Path no Storage do logo (para deletar). */
  logoPath?: string;
  /** Banner aplicativo versão WEB (805×453, landscape) — usado em
   *  desktop / telas largas onde os cards têm formato horizontal. */
  bannerAppUrl?: string;
  bannerAppPath?: string;
  /** Banner aplicativo versão MOBILE (600×600, quadrado) — usado em
   *  telas estreitas (≤767px) onde os cards empilham vertical e o
   *  formato landscape fica esticado/feio. Fallback: usa bannerAppUrl. */
  bannerAppMobileUrl?: string;
  bannerAppMobilePath?: string;
  /** Banner jogos versão WEB (970×90) — usado em telas largas (>767px). */
  bannerSiteUrl?: string;
  bannerSitePath?: string;
  /** Banner jogos versão MOBILE (640×200) — usado em telas estreitas
   *  (≤767px). Aspect-ratio mais quadrado pra ficar legível no celular,
   *  onde 970×90 fica apertado. Fallback: usa bannerSiteUrl se vazio. */
  bannerSiteMobileUrl?: string;
  bannerSiteMobilePath?: string;
  /** Tempo (em segundos) que cada banner aparece no slider. */
  tempoBanner?: number;
  site?: string;
  telefone?: string;
  /** Link clicável quando o logo aparecer publicamente. */
  link?: string;
  /** "patrocinador", "apoiador", "organizador". */
  tipo?: 'patrocinador' | 'apoiador' | 'organizador';

  // ============ Escopo de visibilidade ============

  /**
   * IDs dos campeonatos onde esse patrocinador deve aparecer.
   *
   * - `undefined`/`[]` (default legacy): aparece em **TODOS** os campeonatos
   *   do organizador — comportamento histórico, não quebra patrocinadores
   *   já cadastrados sem escopo.
   * - Array com IDs: aparece **APENAS** nos campeonatos listados.
   *
   * Útil quando um patrocinador apoia só um campeonato específico (ex: copa
   * patrocinada por marca local que não tem nada a ver com outros eventos).
   */
  campeonatosVisivel?: string[];

  /**
   * Pares "campeonatoId:categoriaId" onde esse patrocinador deve aparecer
   * **apenas dentro daquela categoria** específica.
   *
   * - `undefined`/`[]`: aparece na home do campeonato E em todas as
   *   categorias do(s) campeonato(s) liberado(s) em `campeonatosVisivel`.
   * - Lista com pares: aparece SOMENTE quando o usuário está nessa
   *   categoria exata (ex: patrocinador específico do SUB7 que não vai
   *   pro SUB9 do mesmo campeonato).
   *
   * Formato: `["iGJP8l5...:V1vXeuR...", "iGJP8l5...:OutraCatId"]`.
   */
  categoriasVisivel?: string[];

  criadoEm?: Timestamp;
}
