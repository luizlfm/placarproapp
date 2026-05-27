import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Página RANKING MUNDIAL — compara o jogador/racha com todos os rachas
 * do PlacarPro. Requer dados agregados cross-racha que ainda não temos;
 * por enquanto mostra estrutura visual + cards "Em breve".
 */
@Component({
  selector: 'app-racha-ranking-mundial',
  templateUrl: './ranking-mundial.page.html',
  styleUrls: ['./ranking-mundial.page.scss'],
  standalone: false,
})
export class RachaRankingMundialPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  rachaId = '';

  readonly categorias = [
    { icon: 'football',   label: 'Artilheiro Mundial', cor: '#f59e0b' },
    { icon: 'paw',        label: 'Assistente Mundial', cor: '#16a34a' },
    { icon: 'star',       label: 'Xerifão Mundial',    cor: '#f59e0b' },
    { icon: 'hand-left',  label: 'Goleiro Mundial',    cor: '#3b82f6' },
  ];

  ngOnInit(): void {
    this.rachaId = this.route.snapshot.parent?.paramMap.get('id') ?? '';
  }

  voltar(): void {
    this.router.navigate(['/racha', this.rachaId, 'inicio']);
  }
  irRankingLocal(): void {
    this.router.navigate(['/racha', this.rachaId, 'ranking']);
  }

  trackByLabel(_i: number, c: { label: string }): string {
    return c.label;
  }
}
