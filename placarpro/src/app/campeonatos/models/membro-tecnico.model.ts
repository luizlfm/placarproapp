import { Timestamp } from '@angular/fire/firestore';

export type FuncaoTecnica =
  | 'tecnico'
  | 'auxiliar'
  | 'preparador-fisico'
  | 'preparador-goleiros'
  | 'analista'
  | 'fisioterapeuta'
  | 'medico'
  | 'massagista'
  | 'gerente'
  | 'outro';

export const FUNCAO_TECNICA_LABEL: Record<FuncaoTecnica, string> = {
  'tecnico': 'Técnico',
  'auxiliar': 'Auxiliar técnico',
  'preparador-fisico': 'Preparador físico',
  'preparador-goleiros': 'Preparador de goleiros',
  'analista': 'Analista',
  'fisioterapeuta': 'Fisioterapeuta',
  'medico': 'Médico',
  'massagista': 'Massagista',
  'gerente': 'Gerente',
  'outro': 'Outro',
};

export interface MembroTecnico {
  id?: string;
  equipeId: string;

  nome: string;
  apelido?: string;
  funcao: FuncaoTecnica;
  funcaoOutro?: string;

  fotoUrl?: string;
  documento?: string;
  telefone?: string;
  dataNascimento?: string;

  criadoEm?: Timestamp;
  atualizadoEm?: Timestamp;
}
