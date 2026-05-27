/**
 * Modalidades esportivas suportadas pelo PlacarPro.
 * Cada modalidade tem id, nome, ícone Ionicons e cor para o badge visual.
 */

export type ModalidadeId =
  | 'futsal'
  | 'futebol'
  | 'futebol-7'
  | 'handebol'
  | 'basquetebol'
  | 'voley'
  | 'voley-praia'
  | 'tenis-mesa'
  | 'tenis'
  | 'beach-tennis'
  | 'futevolei'
  | 'outro';

export interface Modalidade {
  id: ModalidadeId;
  label: string;
  icon: string;
  color: string;
}

export const MODALIDADES: readonly Modalidade[] = [
  { id: 'futsal',       label: 'Futsal',        icon: 'football',           color: '#3F2B5B' },
  { id: 'futebol',      label: 'Futebol',       icon: 'football',           color: '#2BB673' },
  { id: 'futebol-7',    label: 'Futebol 7',     icon: 'football-outline',   color: '#7CC61D' },
  { id: 'handebol',     label: 'Handebol',      icon: 'basketball',         color: '#E89132' },
  { id: 'basquetebol',  label: 'Basquetebol',   icon: 'basketball',         color: '#D9682C' },
  { id: 'voley',        label: 'Vôlei',         icon: 'american-football',  color: '#3B5BFF' },
  { id: 'voley-praia',  label: 'Vôlei de Praia',icon: 'american-football',  color: '#F4C430' },
  { id: 'tenis-mesa',   label: 'Tênis de Mesa', icon: 'tennisball',         color: '#E84A78' },
  { id: 'tenis',        label: 'Tênis',         icon: 'tennisball',         color: '#2BB673' },
  { id: 'beach-tennis', label: 'Beach Tennis',  icon: 'tennisball-outline', color: '#3AC1C7' },
  { id: 'futevolei',    label: 'Futevôlei',     icon: 'american-football',  color: '#F19A1F' },
  { id: 'outro',        label: 'Outro',         icon: 'ellipsis-horizontal',color: '#8E8E93' },
] as const;

export function getModalidade(id: ModalidadeId | undefined): Modalidade | undefined {
  return id ? MODALIDADES.find(m => m.id === id) : undefined;
}
