import { ModeradorCampeonato } from '../campeonatos/campeonato.model';

/**
 * Lista plana de UIDs com cada permissão específica — usada pelas
 * Firestore Rules pra autorização granular SEM precisar iterar array de
 * `moderadores`.
 *
 * As rules não suportam buscar dentro de arrays de objects de forma
 * eficiente (precisaria `data.moderadores[i].permissoes.editarX` —
 * impossível sem laço). Por isso denormalizamos em 3 listas planas
 * que ficam no doc do campeonato e podem ser checadas com `in`.
 *
 * Atualizado SEMPRE que o array `moderadores` muda (criar, editar
 * permissão, remover) pra ficar em sync.
 */
export interface PermissoesUidsDenormalizadas {
  /** UIDs com permissão editarCampeonato=true. */
  editarCampeonatoUids: string[];
  /** UIDs com permissão gerenciarEquipes=true. */
  gerenciarEquipesUids: string[];
  /** UIDs com permissão editarResultados=true. */
  editarResultadosUids: string[];
  /** UIDs com permissão enviarMidias=true. */
  enviarMidiasUids: string[];
  /** UIDs com permissão gerenciarEnquetes=true. */
  gerenciarEnquetesUids: string[];
}

/**
 * Gera as listas planas a partir do array de moderadores. Considera
 * apenas IDs que parecem UIDs reais (não placeholders `mod-` ou `mod_`)
 * — moderadores que ainda não aceitaram o convite não devem ter
 * permissão de write.
 *
 * Cada lista é consultada via `request.auth.uid in resource.data.<list>`
 * nas Firestore Rules — array-contains barato e sem precisar iterar o
 * array de moderadores dentro da rule.
 */
export function denormalizarPermissoesUids(
  moderadores: ModeradorCampeonato[] | undefined,
): PermissoesUidsDenormalizadas {
  const lista = Array.isArray(moderadores) ? moderadores : [];
  const editarCampeonatoUids: string[] = [];
  const gerenciarEquipesUids: string[] = [];
  const editarResultadosUids: string[] = [];
  const enviarMidiasUids: string[] = [];
  const gerenciarEnquetesUids: string[] = [];

  for (const m of lista) {
    if (!m?.id) continue;
    // Placeholder IDs (`mod-xxx`, `mod_xxx`) são moderadores que ainda
    // não aceitaram o convite — não dão permissão a NINGUÉM porque
    // não correspondem a um UID Firebase real.
    if (m.id.startsWith('mod-') || m.id.startsWith('mod_')) continue;

    const p = m.permissoes ?? {};
    if (p.editarCampeonato) editarCampeonatoUids.push(m.id);
    if (p.gerenciarEquipes) gerenciarEquipesUids.push(m.id);
    if (p.editarResultados) editarResultadosUids.push(m.id);
    if (p.enviarMidias) enviarMidiasUids.push(m.id);
    if (p.gerenciarEnquetes) gerenciarEnquetesUids.push(m.id);
  }

  return {
    editarCampeonatoUids,
    gerenciarEquipesUids,
    editarResultadosUids,
    enviarMidiasUids,
    gerenciarEnquetesUids,
  };
}
