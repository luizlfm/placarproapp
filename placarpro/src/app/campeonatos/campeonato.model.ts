import { Timestamp } from '@angular/fire/firestore';

export type TipoCampeonato = 'unico' | 'com-categorias';
export type LocalizacaoTipo = 'presencial' | 'internet';

/** Modelo de Campeonato no Firestore (collection `campeonatos`). */
export interface Campeonato {
  id?: string;
  ownerId: string;
  tipo: TipoCampeonato;
  titulo: string;
  subtitulo?: string;
  esporte?: string;
  descricao?: string;

  /** URL do logo do campeonato (Firebase Storage). 200x240 quadrado.
   *  Variante "web" — usada por padrão em viewports >= 768px. */
  logoUrl?: string;
  /** Logo otimizado pra exibição mobile (ex: versão mais simples / sem
   *  texto pequeno que some em tela estreita). 200×240 também. Quando
   *  vazio, o `logoUrl` é usado em qualquer viewport. */
  logoMobileUrl?: string;
  /** Imagem de capa (1600×400 — 4:1) — banner do hero exibido no topo
   *  da página pública em web. Campeonatos antigos podem ter sido
   *  cropados em 1600×533 (3:1); ainda renderizam com object-fit cover
   *  mas a parte de cima/baixo será cortada. */
  capaUrl?: string;
  /** Capa otimizada pra mobile (proporção 800×600 — 4:3). Mostra mais
   *  conteúdo vertical, evitando crop agressivo em telas estreitas.
   *  Quando vazio, o `capaUrl` é usado em qualquer viewport. */
  capaMobileUrl?: string;
  /** Compatibilidade com campo antigo. */
  bannerUrl?: string;

  /** Visibilidade: público aparece na busca, privado não. */
  publico: boolean;

  /** Cor primária do campeonato (hex). */
  cor?: string;

  /** Datas de competição. */
  dataInicio?: Timestamp | null;
  dataFim?: Timestamp | null;

  /** Localização. */
  localizacaoTipo?: LocalizacaoTipo;
  localizacao?: string;

  /** Contatos exibidos publicamente. */
  contatoTelefone?: string;
  contatoEmail?: string;
  contatoWhatsapp?: string;

  /** Regras (texto longo). */
  regras?: string;
  /** Premiações (texto longo). */
  premiacoes?: string;

  /** Slug do link público: placarproapp.com/{slug}. */
  slug?: string;

  /**
   * Shortcode aleatório (~5 chars alfanuméricos), gerado uma vez ao criar.
   * Funciona como link curto público quando o slug custom não foi definido:
   * placarproapp.com/{shortCode}
   */
  shortCode?: string;

  /**
   * ID da categoria principal — preenchido automaticamente quando
   * `tipo === 'unico'`. Permite navegação instantânea direto para a
   * categoria sem nenhuma query extra ao Firestore.
   */
  categoriaPrincipalId?: string;

  /** Toggles de divulgação. */
  permitirComentarios?: boolean;
  permitirMidiasUsuarios?: boolean;

  /** Quantos seguidores tem (denormalizado). */
  seguidores?: number;
  /** Quantas visualizações tem (denormalizado). */
  visualizacoes?: number;

  /**
   * Transmissão ao vivo (LiveKit) ATIVA pra este campeonato — flag
   * denormalizada pra home pública conseguir exibir "AO VIVO" + "Assistir"
   * sem precisar varrer subcoleções de transmissões.
   *
   * Setado pelo broadcaster ao iniciar (`TransmissoesService.iniciar`)
   * e limpo (= null) ao encerrar. Quando null/undefined, não há live.
   * Última transmissão sobrescreve se múltiplas em paralelo (raro).
   */
  transmissaoLiveAtiva?: {
    jogoId: string;
    categoriaId: string;
    transmissaoId: string;
    broadcasterNome: string;
    iniciadoEm: Timestamp;
  } | null;

  // ===== Configurações expandidas (página /config) =====
  /** Lista de nomes dos árbitros do campeonato. */
  arbitros?: string[];
  /**
   * Locais cadastrados (ginásios/quadras). Suporta dois formatos por
   * retrocompatibilidade:
   *   - string  — formato antigo (só nome)
   *   - LocalCadastrado — formato novo (nome + endereço + GPS opcional)
   * Ao ler, qualquer string deve ser normalizada para `{ nome: string }`.
   */
  locaisCadastrados?: (string | LocalCadastrado)[];
  /** Anexos enviados (regulamento, fichas, etc.). */
  anexos?: AnexoCampeonato[];
  /** Patrocinadores/apoiadores (logo + nome + link opcional). */
  patrocinadores?: Patrocinador[];
  /** Moderadores convidados (acesso a categorias específicas via token). */
  moderadores?: ModeradorCampeonato[];
  /** Toggles de exibição na página pública. */
  exibirNomes?: boolean;
  exibirDatas?: boolean;

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/** Local físico cadastrado (ginásio/quadra) com endereço e GPS opcional. */
export interface LocalCadastrado {
  nome: string;
  endereco?: string;
  /** Latitude WGS84 (decimal). */
  lat?: number;
  /** Longitude WGS84 (decimal). */
  lng?: number;
}

/** Anexo enviado para um campeonato (regulamento PDF, ficha de inscrição, etc.). */
export interface AnexoCampeonato {
  titulo: string;
  url: string;
  /** Path no Storage (pra deletar o arquivo junto). */
  path?: string;
  /** Tamanho em bytes (informativo). */
  bytes?: number;
  /** Mime type. */
  mime?: string;
}

/** Patrocinador exibido na página pública. */
export interface Patrocinador {
  nome: string;
  logoUrl?: string;
  /** Path no Storage. */
  logoPath?: string;
  /** Link opcional (site do patrocinador). */
  url?: string;
}

/** Moderador adicional do campeonato (acesso administrativo limitado). */
export interface ModeradorCampeonato {
  /** Identificador local (uid se logou, senão UUID v4 client-side). */
  id: string;
  nome: string;
  email?: string;
  /** Token para o link de acesso único: `/m/{linkToken}` */
  linkToken?: string;
  /** Permissões granulares. */
  permissoes: ModeradorPermissoesCamp;
  /** Quando foi convidado (timestamp em millis). */
  criadoEm?: number;
}

/**
 * Permissões granulares de um moderador no campeonato.
 *
 * Cada flag controla:
 *  - `editarCampeonato`: /config do campeonato + /config da categoria +
 *                        /patrocinadores. Cobre identidade visual (banner,
 *                        logo, cor), regras, descrição, slug.
 *  - `gerenciarEquipes`: /equipes da categoria (lista, criar/editar) +
 *                        aprovar inscrições. Inclui jogadores e equipe técnica.
 *  - `editarResultados`: /jogos da categoria + /jogo/:id (placar, eventos,
 *                        agendamento de partidas).
 *  - `enviarMidias`:     /midia do campeonato e /midia da categoria
 *                        (fotos, vídeos, notícias).
 *  - `gerenciarEnquetes`: criar/editar enquetes em /rankings. Votação
 *                         pública continua aberta — só a curadoria que
 *                         depende dessa permissão.
 *
 * Owner e admin master sempre têm TUDO independente desses flags.
 */
export interface ModeradorPermissoesCamp {
  /** Editar dados do campeonato (config, banner, regras, patrocinadores). */
  editarCampeonato: boolean;
  /** Gerenciar equipes, jogadores e inscrições. */
  gerenciarEquipes: boolean;
  /** Editar resultados de partidas e agendamento. */
  editarResultados: boolean;
  /** Enviar/remover fotos, vídeos e notícias. */
  enviarMidias: boolean;
  /** Criar/editar enquetes e votações. */
  gerenciarEnquetes: boolean;
  /** Categorias permitidas (vazio = todas). */
  categoriasPermitidas?: string[];
}

export const MODERADOR_PERMISSOES_PADRAO_CAMP: ModeradorPermissoesCamp = {
  editarCampeonato: false,
  gerenciarEquipes: false,
  editarResultados: true,
  enviarMidias: true,
  gerenciarEnquetes: false,
  categoriasPermitidas: [],
};

export type NovoCampeonatoInput = Pick<Campeonato, 'titulo' | 'tipo'> &
  Partial<Pick<Campeonato, 'subtitulo' | 'esporte' | 'descricao' | 'publico'>>;
