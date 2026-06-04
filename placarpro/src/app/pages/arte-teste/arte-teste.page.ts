import { Component } from '@angular/core';

/**
 * Página de TESTE do editor da Arte do Jogo. Monta o editor com dados de
 * exemplo numa rota fixa (`/arte-teste`) — útil pra iterar no layout sem
 * precisar navegar até um jogo e reabrir o modal toda vez. Recarregar a
 * página reabre o editor na hora.
 */
@Component({
  selector: 'app-arte-teste',
  templateUrl: './arte-teste.page.html',
  standalone: false,
})
export class ArteTestePage {
  jogo: any = {
    status: 'agendado',
    golsMandante: 0,
    golsVisitante: 0,
    dataHora: '2026-06-04T20:15',
    local: 'Estádio Municipal',
  };
  mandante: any = { nome: 'EX ATLETAS', logoUrl: '' };
  visitante: any = { nome: 'POLÊMICOS', logoUrl: '' };
  campeonato: any = { titulo: '5ª Copa Regional Sport+ Futebol Society 2026' };
  categoria: any = { titulo: 'Society' };
}
