import { Timestamp } from '@angular/fire/firestore';
import type { ModalidadeId } from './modalidades';

/** Tipo de fase definido na criação da categoria. */
export type TipoFase = 'pontos-corridos' | 'pontos-corridos-eliminatorias' | 'eliminatorias';

/** Modo de localização do campeonato. */
export type LocalizacaoTipo = 'online' | 'presencial';

/** Cartão tratado em suspensão automática. */
export type CartaoTipo = 'amarelo' | 'vermelho' | 'azul';

/** Configuração das regras esportivas. */
export interface ConfigEsporte {
  pontosVitoria: number;
  pontosEmpate: number;
  pontosDerrota: number;
  /** Qtd de amarelos pra suspensão automática (0 = desligado). */
  suspensaoAmarelos: number;
  /** Qtd de vermelhos pra suspensão automática (0 = desligado). */
  suspensaoVermelhos: number;
  /** Qtd de azuis pra suspensão automática (0 = desligado). */
  suspensaoAzuis: number;
  /** Separar contagem de cartões por fase. */
  separarCartoesPorFase: boolean;
  /** Como contar "jogos disputados" — titulares apenas / titulares + reservas. */
  contagemJogos: 'apenas-titulares' | 'titulares-e-reservas';
  /** Se computa cartão azul nas estatísticas. */
  incluirCartoesAzuis: boolean;
}

export interface Contato {
  nome?: string;
  telefone?: string;
  email?: string;
}

/** Moderador convidado para gerenciar a categoria.
 *  - `id` é único (uid Firebase quando o usuário fez login,
 *    senão um ID gerado client-side).
 *  - `linkToken` é o token usado no URL de acesso único
 *    (ex.: /m/abc123). Quando preenchido, o moderador pode
 *    abrir aquela URL sem precisar logar e gerenciar a categoria.
 *  - `permissoes` define o nível de acesso.
 */
export interface ModeradorPermissoes {
  /** Editar equipes, resultados e informações do campeonato. */
  editarCampeonato: boolean;
  /** Editar todos os resultados das partidas não concluídas. */
  editarResultados: boolean;
  /** Adicionar e remover mídias do campeonato. */
  enviarMidias: boolean;
  /** Categorias que este moderador pode acessar (vazio = todas). */
  categoriasPermitidas?: string[];
}

export interface Moderador {
  id: string;
  nome: string;
  email?: string;
  fotoUrl?: string;
  /** Token do link de acesso único (URL `/m/{token}`). */
  linkToken?: string;
  /** Permissões nível alto (legado). */
  permissoes?: 'gerenciar' | 'apenas-lances';
  /** Permissões granulares — novo formato. */
  permissoesDetalhadas?: ModeradorPermissoes;
  /** Timestamp de criação. */
  criadoEm?: number;
}

export const MODERADOR_PERMISSOES_PADRAO: ModeradorPermissoes = {
  editarCampeonato: true,
  editarResultados: true,
  enviarMidias: true,
  categoriasPermitidas: [],
};

/** Categoria dentro de um campeonato (subcollection `categorias`). */
export interface Categoria {
  id?: string;
  /** ID do campeonato pai. */
  campeonatoId: string;
  /** Ex: "CATEGORIA 40+", "MASCULINO", "SUB-15". */
  titulo: string;
  /** Subtítulo opcional (ex: ano, edição). */
  subtitulo?: string;
  /** Modalidade esportiva. Define o tipo de jogo (futsal, futebol, etc.). */
  modalidade: ModalidadeId;
  /** Tipo padrão de fase. */
  tipoFase: TipoFase;
  /** URL do logo/escudo da categoria (opcional) — variante WEB (200×240). */
  logoUrl?: string;
  /** Path no Storage do logo web (para deletar). */
  logoPath?: string;
  /** Variante MOBILE do logo (opcional — fallback no logoUrl quando vazio).
   *  Permite ao organizador subir uma versão mais "limpa" do logo,
   *  sem detalhes pequenos que somem em telas pequenas. */
  logoMobileUrl?: string;
  /** Path no Storage do logo mobile. */
  logoMobilePath?: string;
  /** Banner horizontal legacy (opcional). Mantido pra retrocompatibilidade
   *  — novas categorias usam `capaUrl`. O admin/inicio lê `capaUrl ?? bannerUrl`. */
  bannerUrl?: string;
  /** Path no Storage do banner legacy (para deletar). */
  bannerPath?: string;
  /** Capa principal (1600×400, 4:1) — variante WEB. */
  capaUrl?: string;
  /** Path no Storage da capa web. */
  capaPath?: string;
  /** Capa MOBILE (1600×533, 3:1) — opcional, fallback no capaUrl. */
  capaMobileUrl?: string;
  /** Path no Storage da capa mobile. */
  capaMobilePath?: string;
  /** Descrição/regras específicas da categoria. */
  descricao?: string;
  /** Regras esportivas. */
  regras?: string;
  /** Premiações. */
  premiacoes?: string;
  /** Cor hex (#1C2E3D). */
  cor?: string;
  /** Datas. */
  dataInicio?: string;
  dataFim?: string;
  /** Contatos (telefone, email do organizador). */
  contatos?: Contato[];
  /** URLs de anexos (regulamento PDF, etc.) */
  anexosUrls?: string[];
  /** Link externo (site, copafacil, etc.) */
  linkExterno?: string;
  /** Tipo de localização. */
  localizacaoTipo?: LocalizacaoTipo;
  /** Endereço/cidade quando presencial. */
  localizacao?: string;

  /** Toggles de divulgação. */
  publico?: boolean;
  permiteMidiasUsuarios?: boolean;
  permiteComentarios?: boolean;
  exibirNomes?: boolean;
  exibirDatas?: boolean;

  /** Moderadores adicionais — pode ser legado (`string[]` com UIDs)
   *  ou o novo formato (`Moderador[]` com nome/email/linkToken). */
  moderadores?: string[] | Moderador[];
  /** Métricas. */
  seguidores?: number;
  visualizacoes?: number;

  /** Configurações do esporte (pontuação + cartões). */
  configEsporte?: ConfigEsporte;

  /** Configurações de inscrições online. */
  inscricoes?: ConfigInscricoes;

  /** Contadores denormalizados. */
  totalEquipes?: number;
  totalJogadores?: number;
  /** Posição manual na lista (menor = mais acima). Quando ausente, ordena por criadoEm. */
  ordem?: number;
  /**
   * Resultado final declarado pelo organizador (campeão, vice, 3º, ...).
   * Sempre ordenado por `posicao` crescente. Útil pra fases eliminatórias onde
   * a classificação automática não reflete o resultado de mata-mata.
   */
  resultadoFinal?: ResultadoFinalEquipe[];
  /** Configuração visual da Pré-Súmula (header customizado). */
  preSumulaConfig?: PreSumulaConfig;
  /** Auditoria. */
  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}

/** Item do `resultadoFinal` — posição declarada de uma equipe. */
export interface ResultadoFinalEquipe {
  equipeId: string;
  /** 1 = campeão, 2 = vice, 3 = 3º, ... */
  posicao: number;
  /** Título customizado opcional (ex.: "Melhor ataque"). */
  titulo?: string;
}

/** Logo extra exibido no header da Pré-Súmula (federação, patrocinador, etc.). */
export interface LogoHeaderPreSumula {
  url: string;
  /** Path no Storage (pra remover o arquivo ao deletar). */
  path?: string;
  /** Texto opcional abaixo do logo (ex.: "Federação Mineira"). */
  legenda?: string;
}

/**
 * Configuração visual da Pré-Súmula — formulário em branco que os times/árbitros
 * preenchem antes do jogo. O organizador customiza o header (logos extras,
 * título em até 3 linhas) e essa config é reaproveitada em todas as
 * pré-súmulas da categoria.
 *
 * Layout inspirado em carteirinha: título grande no centro com logos do lado,
 * uma tabela em branco (Número + Nome) por equipe.
 */
export interface PreSumulaConfig {
  /**
   * Linhas do título grande no topo (até 3).
   * Ex.: ['5ª COPA REGIONAL SPORT+', 'DE FUTEBOL SOCIETY', '2026']
   * Vazio em todas = usa o título do campeonato como única linha.
   */
  tituloLinhas?: string[];
  /** Logos extras (até 4) — federação, patrocinador, organização. */
  logosExtras?: LogoHeaderPreSumula[];
  /**
   * Quando true (padrão), gera UMA folha por equipe (modelo carteirinha:
   * Equipe: MANDANTE numa folha, Equipe: VISITANTE na próxima).
   * Quando false, ambas equipes na mesma folha em tabelas lado a lado.
   */
  umaTabelaPorEquipe?: boolean;
  /** Mostrar fotos dos jogadores na tabela (ocupa mais espaço). */
  incluirFotosJogadores?: boolean;
  /** Quantidade de linhas em branco pra árbitro escrever observações. */
  linhasObservacoes?: number;

  /* ─── Campos legados (mantidos por retrocompatibilidade) ─────────── */
  /** @deprecated Substituído por `tituloLinhas`. */
  tituloCustom?: string;
  /** @deprecated Substituído por `tituloLinhas`. */
  subtituloCustom?: string;
  /** @deprecated Removido do novo layout. */
  textoCabecalho?: string;
}

/** Padrão sensato pra primeira impressão sem configuração. */
export const PRE_SUMULA_CONFIG_PADRAO: PreSumulaConfig = {
  tituloLinhas: [],
  logosExtras: [],
  umaTabelaPorEquipe: true,
  incluirFotosJogadores: false,
  linhasObservacoes: 0,
};

export type NovaCategoriaInput = Pick<Categoria, 'titulo' | 'tipoFase' | 'modalidade'>;

/** Valores default da configuração de esporte. */
export const CONFIG_ESPORTE_PADRAO: ConfigEsporte = {
  pontosVitoria: 3,
  pontosEmpate: 1,
  pontosDerrota: 0,
  suspensaoAmarelos: 0,
  suspensaoVermelhos: 0,
  suspensaoAzuis: 0,
  separarCartoesPorFase: true,
  contagemJogos: 'titulares-e-reservas',
  incluirCartoesAzuis: false,
};

/** Campo customizado do formulário de inscrição. */
export interface CampoFormulario {
  id: string;
  /** Rótulo exibido pro inscrito. */
  label: string;
  /** Tipo do input. */
  tipo: 'texto' | 'textarea' | 'email' | 'telefone' | 'data' | 'numero' | 'select' | 'checkbox';
  /** Para 'select' — opções possíveis. */
  opcoes?: string[];
  /** Se é obrigatório. */
  obrigatorio?: boolean;
  /** Placeholder/hint. */
  placeholder?: string;
  /** Ordem na renderização. */
  ordem: number;
}

/** Configurações do fluxo de inscrições online. */
export interface ConfigInscricoes {
  /** Se true, ninguém pode mais se inscrever (só o admin pode adicionar manualmente). */
  fechadas: boolean;
  /** Texto livre exibido na página pública de inscrição. */
  informacoes?: string;
  /** Permite inscrição da equipe completa (com elenco). */
  permiteEquipe: boolean;
  /** Permite inscrição apenas de jogador individual (avulso). */
  permiteJogadorIndividual: boolean;
  /** Máximo de jogadores por equipe (slider). */
  limiteJogadoresPorEquipe: number;
  /** Mínimo de jogadores por equipe (para validação). */
  minimoJogadoresPorEquipe?: number;
  /** Campos custom do formulário de equipes. */
  camposEquipe?: CampoFormulario[];
  /** Campos custom do formulário de jogadores. */
  camposJogador?: CampoFormulario[];
}

export const INSCRICOES_PADRAO: ConfigInscricoes = {
  fechadas: false,
  informacoes: '',
  permiteEquipe: true,
  permiteJogadorIndividual: false,
  limiteJogadoresPorEquipe: 25,
  minimoJogadoresPorEquipe: 0,
  camposEquipe: [],
  camposJogador: [],
};
