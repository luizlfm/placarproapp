import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { UsersService } from './users.service';
import { UserProfile } from './models/user-profile.model';
import { ConfigComercialService, ConfigComercial, CreditoConfig } from './config-comercial.service';
import { CREDITO_PATROCINIO, PREMIUM_PATROCINIO } from '../campeonatos/models/patrocinio-jogo.model';

/** ID válido de plano. Mantém compat com o campo já existente em UserProfile. */
export type PlanoId = 'gratis' | 'pequeno' | 'medio' | 'grande' | 'profissional';

/** Item de feature mostrado no card do plano (UI). */
export interface PlanoFeature {
  icon: string;
  titulo: string;
  desc?: string;
}

/** Limites quantitativos enforced pelo plano. -1 = ilimitado. */
export interface PlanoLimites {
  maxCampeonatos: number;
  maxCategoriasPorCampeonato: number;
  maxJogadoresPorCategoria: number;
  maxPatrocinadores: number;
  /** Duração máx de vídeos em segundos (-1 = ilimitado). */
  maxVideoSegundos: number;
  /** Acesso a recursos premium (API, embed HTML, white-label). */
  permiteApiPublica: boolean;
  permiteEmbedHtml: boolean;
  permiteWhiteLabel: boolean;
  /**
   * Permite transmitir a partida ao vivo (câmera/LiveKit). Desbloqueia:
   *  - Botão "Transmitir ao vivo" no header/ações do jogo-detalhe
   *  - Tela /jogo/:id/transmissao (placar overlay + chat)
   *
   * Quando false, esses controles aparecem como bloqueados com CTA
   * pra upgrade. Habilitado a partir do plano MÉDIO.
   */
  permiteTransmissaoAoVivo: boolean;
  /**
   * Número de transmissões ao vivo simultâneas incluídas no plano.
   * 0 = não permite. -1 = ilimitado.
   * Transmissões avulsas compradas somam em `UserProfile.transmissoesExtras`.
   */
  maxTransmisoesSimultaneas: number;
  /** Valor unitário de uma transmissão avulsa (em R$). */
  readonly valorTransmissaoAvulsa: 30;
}

/** Preços por periodicidade — todos em R$ totais (não normalizados). */
export interface PlanoPrecos {
  mensal: number;
  trimestral: number;
  semestral: number;
  anual: number;
}

/** Definição completa de um plano. */
export interface PlanoDef {
  id: PlanoId;
  label: string;
  /** Preço em R$ por mês (legacy — mantém compat). 0 = grátis. -1 = sob consulta. */
  preco: number;
  /** Preços por periodicidade (total cobrado em cada período). */
  precos: PlanoPrecos;
  /** Cor principal do card (CSS color). */
  cor: string;
  /** Texto curto que aparece no header do card. */
  resumo: string;
  destaque?: boolean;
  features: PlanoFeature[];
  limites: PlanoLimites;
}

/** Periodicidade selecionada pelo usuário ao escolher um plano. */
export type Periodicidade = 'mensal' | 'trimestral' | 'semestral' | 'anual';

/** Plano padrão pra usuários sem campo `plano` no perfil. */
const PLANO_GRATIS: PlanoDef = {
  id: 'gratis',
  label: 'Grátis',
  preco: 0,
  precos: { mensal: 0, trimestral: 0, semestral: 0, anual: 0 },
  cor: '#94a3b8',
  resumo: 'Pra experimentar a plataforma',
  features: [
    { icon: 'trophy-outline', titulo: '1 campeonato', desc: 'Para experimentar' },
    { icon: 'people-outline', titulo: 'Até 50 jogadores' },
    { icon: 'images-outline', titulo: 'Mídia básica' },
  ],
  limites: {
    maxCampeonatos: 1,
    maxCategoriasPorCampeonato: 2,
    maxJogadoresPorCategoria: 50,
    maxPatrocinadores: 1,
    maxVideoSegundos: 60,
    permiteApiPublica: false,
    permiteEmbedHtml: false,
    permiteWhiteLabel: false,
    permiteTransmissaoAoVivo: false,
    maxTransmisoesSimultaneas: 0,
    valorTransmissaoAvulsa: 30,
  },
};

const PLANO_PEQUENO: PlanoDef = {
  id: 'pequeno',
  label: 'Pequeno',
  preco: 19,
  precos: { mensal: 19, trimestral: 49, semestral: 89, anual: 159 },
  cor: '#4DABF7',
  resumo: 'Pra organizar um campeonato local',
  features: [
    { icon: 'trophy-outline', titulo: '3 campeonatos' },
    { icon: 'people-outline', titulo: '300 jogadores' },
    { icon: 'megaphone-outline', titulo: '3 patrocinadores' },
    { icon: 'film-outline', titulo: 'Vídeos até 2 minutos' },
  ],
  limites: {
    maxCampeonatos: 3,
    maxCategoriasPorCampeonato: 5,
    maxJogadoresPorCategoria: 300,
    maxPatrocinadores: 3,
    maxVideoSegundos: 120,
    permiteApiPublica: false,
    permiteEmbedHtml: false,
    permiteWhiteLabel: false,
    permiteTransmissaoAoVivo: false,
    maxTransmisoesSimultaneas: 0,
    valorTransmissaoAvulsa: 30,
  },
};

const PLANO_MEDIO: PlanoDef = {
  id: 'medio',
  label: 'Médio',
  preco: 39,
  precos: { mensal: 39, trimestral: 99, semestral: 179, anual: 319 },
  cor: '#7CC61D',
  resumo: 'Pra ligas e federações regionais',
  destaque: true,
  features: [
    { icon: 'trophy-outline', titulo: '10 campeonatos' },
    { icon: 'people-outline', titulo: '600 jogadores por categoria' },
    { icon: 'megaphone-outline', titulo: '6 patrocinadores' },
    { icon: 'film-outline', titulo: 'Vídeos até 5 minutos' },
    { icon: 'radio-outline', titulo: '1 transmissão ao vivo simultânea', desc: 'Inclusa no plano.' },
    { icon: 'star-outline', titulo: 'Recursos em destaque' },
  ],
  limites: {
    maxCampeonatos: 10,
    maxCategoriasPorCampeonato: 12,
    maxJogadoresPorCategoria: 600,
    maxPatrocinadores: 6,
    maxVideoSegundos: 300,
    permiteApiPublica: false,
    permiteEmbedHtml: true,
    permiteWhiteLabel: false,
    permiteTransmissaoAoVivo: true,
    maxTransmisoesSimultaneas: 1,
    valorTransmissaoAvulsa: 30,
  },
};

const PLANO_GRANDE: PlanoDef = {
  id: 'grande',
  label: 'Grande',
  preco: 79,
  precos: { mensal: 79, trimestral: 219, semestral: 399, anual: 699 },
  cor: '#F39C12',
  resumo: 'Pra confederações e grandes torneios',
  features: [
    { icon: 'trophy-outline', titulo: '30 campeonatos' },
    { icon: 'people-outline', titulo: '900 jogadores por categoria' },
    { icon: 'megaphone-outline', titulo: '12 patrocinadores' },
    { icon: 'film-outline', titulo: 'Vídeos até 10 minutos' },
    { icon: 'radio-outline', titulo: '1 transmissão ao vivo simultânea', desc: 'Inclusa no plano.' },
    { icon: 'code-slash-outline', titulo: 'Embed HTML em sites' },
  ],
  limites: {
    maxCampeonatos: 30,
    maxCategoriasPorCampeonato: 25,
    maxJogadoresPorCategoria: 900,
    maxPatrocinadores: 12,
    maxVideoSegundos: 600,
    permiteApiPublica: true,
    permiteEmbedHtml: true,
    permiteWhiteLabel: false,
    permiteTransmissaoAoVivo: true,
    maxTransmisoesSimultaneas: 1,
    valorTransmissaoAvulsa: 30,
  },
};

const PLANO_PROFISSIONAL: PlanoDef = {
  id: 'profissional',
  label: 'Profissional',
  preco: -1, // sob consulta
  precos: { mensal: -1, trimestral: -1, semestral: -1, anual: -1 },
  cor: '#000000',
  resumo: 'Tudo ilimitado + white-label',
  features: [
    { icon: 'infinite-outline', titulo: 'Campeonatos ilimitados' },
    { icon: 'people-outline', titulo: 'Jogadores ilimitados' },
    { icon: 'megaphone-outline', titulo: 'Patrocinadores ilimitados' },
    { icon: 'film-outline', titulo: 'Vídeos sem limite' },
    { icon: 'radio-outline', titulo: '3 transmissões ao vivo simultâneas', desc: 'Incluso no plano.' },
    { icon: 'code-slash-outline', titulo: 'API pública + Embed HTML' },
    { icon: 'color-palette-outline', titulo: 'White-label (sua marca)' },
  ],
  limites: {
    maxCampeonatos: -1,
    maxCategoriasPorCampeonato: -1,
    maxJogadoresPorCategoria: -1,
    maxPatrocinadores: -1,
    maxVideoSegundos: -1,
    permiteApiPublica: true,
    permiteEmbedHtml: true,
    permiteWhiteLabel: true,
    permiteTransmissaoAoVivo: true,
    maxTransmisoesSimultaneas: 3,
    valorTransmissaoAvulsa: 30,
  },
};

const TODOS_PLANOS: PlanoDef[] = [
  PLANO_GRATIS,
  PLANO_PEQUENO,
  PLANO_MEDIO,
  PLANO_GRANDE,
  PLANO_PROFISSIONAL,
];

/**
 * Service centralizado para o sistema de Planos.
 *
 * Responsabilidades:
 *  - Definições dos planos (ID, preço, features, limites)
 *  - Helpers para descobrir o plano atual do usuário logado
 *  - Verificação de limites (`podeAdicionarMaisX(...)`)
 *  - Operações administrativas (admin master altera plano de qualquer user)
 */
@Injectable({ providedIn: 'root' })
export class PlanosService {
  private readonly usersSrv = inject(UsersService);
  private readonly configComercial = inject(ConfigComercialService);

  /**
   * Snapshot da config comercial (preços/limites editáveis pelo admin).
   * Atualizado reativamente no construtor. Quando vazio, os defaults
   * hardcoded (`TODOS_PLANOS` / constantes de crédito) prevalecem.
   */
  private cfg: ConfigComercial = {};

  /** Catálogo de planos com os overrides do admin já aplicados (cacheado). */
  private mergedPlanos: PlanoDef[] = TODOS_PLANOS.map(p => this.aplicarOverride(p));

  constructor() {
    // Mantém o snapshot e recalcula o catálogo mesclado quando o admin
    // editar os valores no painel (config/comercial muda).
    this.configComercial.config$().subscribe(c => {
      this.cfg = c ?? {};
      this.mergedPlanos = TODOS_PLANOS.map(p => this.aplicarOverride(p));
    });
  }

  /** Aplica o override de `config/comercial` sobre um plano default. */
  private aplicarOverride(def: PlanoDef): PlanoDef {
    const o = this.cfg.planos?.[def.id];
    if (!o) return def;
    const precos: PlanoPrecos = {
      mensal: o.precos?.mensal ?? def.precos.mensal,
      trimestral: o.precos?.trimestral ?? def.precos.trimestral,
      semestral: o.precos?.semestral ?? def.precos.semestral,
      anual: o.precos?.anual ?? def.precos.anual,
    };
    return {
      ...def,
      // `preco` (legacy, R$/mês) acompanha o mensal pra manter compat.
      preco: def.preco < 0 ? def.preco : precos.mensal,
      precos,
      limites: {
        ...def.limites,
        maxCampeonatos: o.limites?.maxCampeonatos ?? def.limites.maxCampeonatos,
        maxCategoriasPorCampeonato: o.limites?.maxCategoriasPorCampeonato ?? def.limites.maxCategoriasPorCampeonato,
        maxJogadoresPorCategoria: o.limites?.maxJogadoresPorCategoria ?? def.limites.maxJogadoresPorCategoria,
        maxPatrocinadores: o.limites?.maxPatrocinadores ?? def.limites.maxPatrocinadores,
        maxVideoSegundos: o.limites?.maxVideoSegundos ?? def.limites.maxVideoSegundos,
        maxTransmisoesSimultaneas: o.limites?.maxTransmisoesSimultaneas ?? def.limites.maxTransmisoesSimultaneas,
      },
    };
  }

  /** Lista completa de planos disponíveis (catálogo, com overrides aplicados). */
  get planos(): ReadonlyArray<PlanoDef> {
    return this.mergedPlanos;
  }

  /** Resolve a definição de um plano pelo ID. Fallback pra 'gratis'. */
  getPlanoDef(id?: PlanoId | string | null): PlanoDef {
    const valido = (id ?? '') as PlanoId;
    return this.mergedPlanos.find(p => p.id === valido)
      ?? this.aplicarOverride(PLANO_GRATIS);
  }

  /** Lê a config de um crédito tolerando o formato legado (number = só preço). */
  private credCfg(key: 'patrocinioNormal' | 'patrocinioPremium' | 'transmissaoAvulsa'): CreditoConfig {
    const c = this.cfg.creditos?.[key];
    if (typeof c === 'number') return { preco: c };
    return c ?? {};
  }

  /** Preço unitário (R$) do crédito de patrocinador NORMAL. */
  get precoCreditoNormal(): number {
    return this.credCfg('patrocinioNormal').preco ?? CREDITO_PATROCINIO.precoBase;
  }

  /** Preço unitário (R$) do crédito de patrocinador PREMIUM. */
  get precoCreditoPremium(): number {
    return this.credCfg('patrocinioPremium').preco ?? PREMIUM_PATROCINIO.precoBase;
  }

  /** Patrocinadores (logos) liberados por crédito NORMAL. */
  get patrocinadoresCreditoNormal(): number {
    return this.credCfg('patrocinioNormal').patrocinadores ?? CREDITO_PATROCINIO.logosPorCredito;
  }

  /** Tempo (minutos) que o crédito NORMAL fica aceso na transmissão. */
  get duracaoCreditoNormalMin(): number {
    return this.credCfg('patrocinioNormal').duracaoMin ?? CREDITO_PATROCINIO.duracaoMin;
  }

  /** Máx. de patrocínios PREMIUM por jogo. */
  get premiumMaxPorJogo(): number {
    return this.credCfg('patrocinioPremium').patrocinadores ?? PREMIUM_PATROCINIO.maxPorJogo;
  }

  /** Premium: janela visível em segundos. */
  get premiumJanelaSeg(): number {
    return this.credCfg('patrocinioPremium').janelaSeg ?? PREMIUM_PATROCINIO.janelaDuracaoSeg;
  }

  /** Premium: intervalo entre janelas em minutos. */
  get premiumIntervaloMin(): number {
    return this.credCfg('patrocinioPremium').intervaloMin ?? PREMIUM_PATROCINIO.intervaloMin;
  }

  /** Validade (meses) do crédito de transmissão avulsa. */
  get transmissaoValidadeMeses(): number {
    return this.credCfg('transmissaoAvulsa').validadeMeses ?? 12;
  }

  /** Tempo de transmissão ao vivo (minutos) liberado por crédito.
   *  O tempo é ACUMULADO entre quedas/reinícios do mesmo jogo. Default 60. */
  get transmissaoDuracaoMin(): number {
    return this.credCfg('transmissaoAvulsa').duracaoMin ?? 60;
  }

  /** Stream do plano atual do usuário logado (reativo). */
  meuPlano$(): Observable<PlanoDef> {
    return this.usersSrv.profile$().pipe(
      map(p => this.getPlanoDef(p?.plano)),
    );
  }

  /** Stream dos limites do plano atual do usuário logado. */
  meusLimites$(): Observable<PlanoLimites> {
    return this.meuPlano$().pipe(map(p => p.limites));
  }

  /** Helper boolean: o user logado pode usar transmissão ao vivo?
   *  Usado pra travar inputs/botões via async pipe no template. */
  podeTransmissaoAoVivo$(): Observable<boolean> {
    return this.meusLimites$().pipe(map(l => l.permiteTransmissaoAoVivo));
  }

  /** Nome do PRIMEIRO plano (mais barato) que libera transmissão ao
   *  vivo. Útil pra UI mostrar CTA tipo "Upgrade pra MÉDIO". */
  planoMinimoParaTransmissao(): PlanoDef {
    const min = this.planos.find(p => p.limites.permiteTransmissaoAoVivo);
    return min ?? PLANO_GRATIS;
  }

  /**
   * Total de transmissões disponíveis do usuário LOGADO.
   *
   * Quando `transmissoesExtras` já foi setado (compra avulsa), esse campo
   * é a fonte de verdade. Quando ainda não foi setado, faz fallback para
   * `maxTransmisoesSimultaneas` do plano atual — ou seja, o plano concede
   * os créditos de transmissão automaticamente.
   */
  totalTransmisoesDisponiveis$(): Observable<number> {
    return combineLatest([
      this.meuPlano$(),
      this.usersSrv.profile$(),
    ]).pipe(
      map(([plano, profile]) => {
        const planCredits =
          plano.limites.maxTransmisoesSimultaneas === -1
            ? 999
            : plano.limites.maxTransmisoesSimultaneas;
        return (profile as UserProfile)?.transmissoesExtras ?? planCredits;
      }),
    );
  }

  /**
   * Total de transmissões disponíveis para um DONO DE CAMPEONATO específico.
   * Usado em jogo-detalhe e transmissao pra que moderadores verifiquem
   * o pool do organizador em vez do próprio — créditos são compartilhados.
   *
   * `transmissoesExtras` é a fonte de verdade (compra avulsa). Fallback para
   * os créditos do plano quando o campo ainda não foi gravado — o plano
   * concede os créditos automaticamente.
   */
  totalTransmisoesParaOwner$(ownerId: string): Observable<number> {
    return this.usersSrv.profilePorUid$(ownerId).pipe(
      map(profile => {
        const plano = this.getPlanoDef(profile?.plano);
        const planCredits =
          plano.limites.maxTransmisoesSimultaneas === -1
            ? 999
            : plano.limites.maxTransmisoesSimultaneas;
        return profile?.transmissoesExtras ?? planCredits;
      }),
    );
  }

  /**
   * Retorna `true` se o dono do campeonato tem pelo menos 1 transmissão
   * disponível (plano + avulsos). Usado pra liberar o botão de transmissão
   * tanto pro organizador quanto pra moderadores (pool compartilhado).
   */
  podeTransmitirComoOwner$(ownerId: string): Observable<boolean> {
    return this.totalTransmisoesParaOwner$(ownerId).pipe(map(n => n > 0));
  }

  /** Valor unitário de uma transmissão avulsa em R$ (editável pelo admin). */
  get VALOR_TRANSMISSAO_AVULSA(): number {
    return this.credCfg('transmissaoAvulsa').preco ?? 30;
  }

  /** Verifica se o user logado pode adicionar mais X. */
  podeAdicionar(atual: number, max: number): boolean {
    if (max === -1) return true; // ilimitado
    return atual < max;
  }

  /**
   * Stream dos limites do plano de um DONO específico (por ownerId).
   * Usado quando a validação precisa considerar o plano do dono do
   * campeonato (não do usuário logado) — ex.: moderador cadastrando
   * jogadores/categorias dentro do campeonato de outro organizador.
   * Sem ownerId, cai pros limites do usuário logado.
   */
  limitesParaOwner$(ownerId?: string | null): Observable<PlanoLimites> {
    if (!ownerId) return this.meusLimites$();
    return this.usersSrv.profilePorUid$(ownerId).pipe(
      map(profile => this.getPlanoDef(profile?.plano).limites),
    );
  }

  /** Formata o preço pra exibição. */
  formatarPreco(p: PlanoDef): string {
    if (p.preco === 0) return 'Grátis';
    if (p.preco === -1) return 'Sob consulta';
    return `R$ ${p.preco.toFixed(2).replace('.', ',')} / mês`;
  }

  /** Quantos meses cada periodicidade representa. */
  mesesDePeriodo(p: Periodicidade): number {
    switch (p) {
      case 'mensal':     return 1;
      case 'trimestral': return 3;
      case 'semestral':  return 6;
      case 'anual':      return 12;
    }
  }

  /** Preço total cobrado por periodicidade do plano. */
  precoPorPeriodo(plano: PlanoDef, periodo: Periodicidade): number {
    return plano.precos?.[periodo] ?? plano.preco;
  }

  /** Preço normalizado por mês (ex: anual / 12). Usado pra comparar planos. */
  precoMensalEquivalente(plano: PlanoDef, periodo: Periodicidade): number {
    const total = this.precoPorPeriodo(plano, periodo);
    if (total <= 0) return total;
    return total / this.mesesDePeriodo(periodo);
  }

  /**
   * % de desconto vs período mensal. Ex: anual de R$159 em plano de
   * R$19/mês = (19 - 159/12) / 19 = ~30% de desconto.
   * Retorna 0 se plano grátis/sob consulta ou se não há economia.
   */
  descontoVsMensal(plano: PlanoDef, periodo: Periodicidade): number {
    if (periodo === 'mensal') return 0;
    const mensal = plano.precos?.mensal ?? plano.preco;
    if (mensal <= 0) return 0;
    const equivalente = this.precoMensalEquivalente(plano, periodo);
    if (equivalente >= mensal) return 0;
    return Math.round(((mensal - equivalente) / mensal) * 100);
  }

  /** Formata um valor monetário R$. */
  formatarMoeda(v: number): string {
    if (v < 0) return 'Sob consulta';
    if (v === 0) return 'Grátis';
    return `R$ ${v.toFixed(2).replace('.', ',')}`;
  }

  // ============ Operações de admin master ============

  /**
   * Altera o plano de QUALQUER usuário. Pra ser chamado apenas pelo
   * painel `/app/admin` (gated pelo adminGuard + Firestore rules).
   */
  async alterarPlanoDoUsuario(uid: string, novoPlano: PlanoId): Promise<void> {
    if (!uid) throw new Error('uid obrigatório');
    if (!this.planos.find(p => p.id === novoPlano)) {
      throw new Error(`Plano inválido: ${novoPlano}`);
    }
    await this.usersSrv.updateUserPlano(uid, novoPlano);
  }

  /**
   * Resumo de quantos usuários estão em cada plano.
   * Recebe a lista de UserProfile (admin já tem via listAllUsers$).
   */
  contarPorPlano(users: UserProfile[]): Record<PlanoId, number> {
    const counts: Record<PlanoId, number> = {
      gratis: 0, pequeno: 0, medio: 0, grande: 0, profissional: 0,
    };
    for (const u of users) {
      const id = (u.plano ?? 'gratis') as PlanoId;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }
}
