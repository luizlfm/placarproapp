import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Página PARÇA DO RACHA — descobre com quem você mais joga junto,
 * suas duplas e rivalidades. Análise depende de dados de partidas
 * (jogador X jogou com Y em N partidas), então hoje exibe layout
 * pronto + 3 cards "Em breve" explicando cada métrica.
 */
@Component({
  selector: 'app-racha-parca',
  templateUrl: './parca.page.html',
  styleUrls: ['./parca.page.scss'],
  standalone: false,
})
export class RachaParcaPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  rachaId = '';

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }

  irJogadores(): void {
    this.router.navigate(['/racha', this.rachaId, 'jogadores']);
  }
}
