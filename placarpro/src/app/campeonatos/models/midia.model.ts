import { Timestamp } from '@angular/fire/firestore';

export type MidiaTipo = 'foto' | 'video' | 'youtube' | 'link' | 'noticia';

/** Mídia anexada a um campeonato (`campeonatos/{id}/midias/{midiaId}`). */
export interface Midia {
  id?: string;
  campeonatoId: string;
  /** Definido quando a mídia é da categoria (não do campeonato). */
  categoriaId?: string;
  tipo: MidiaTipo;

  /** Título exibido no card. */
  titulo?: string;
  /** Descrição/legenda curta (link/youtube) ou subtítulo. */
  descricao?: string;

  /** Para tipo === 'foto' ou 'video' (galeria) — URL pública do arquivo no Storage. */
  arquivoUrl?: string;
  /** Path no Storage (para conseguir deletar). */
  arquivoPath?: string;
  /** Tamanho em bytes (informativo). */
  arquivoBytes?: number;
  /** MIME type do arquivo. */
  arquivoMime?: string;

  /** Para tipo === 'youtube' — id do vídeo (ex: dQw4w9WgXcQ). */
  youtubeId?: string;

  /** Para tipo === 'link' — URL original. */
  url?: string;

  /** Para tipo === 'noticia' — corpo em texto (markdown-lite). */
  corpo?: string;
  /** URL da capa da notícia (opcional). */
  capaUrl?: string;
  /** Path da capa no Storage (para deletar). */
  capaPath?: string;

  /** Autor (uid). */
  ownerId: string;

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

export type NovaMidiaInput = Omit<Midia, 'id' | 'ownerId' | 'criadoEm' | 'atualizadoEm'>;
