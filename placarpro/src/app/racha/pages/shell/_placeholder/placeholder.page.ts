import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NavBackService } from '../../../../shared/nav-back.service';

/**
 * Página genérica "Em breve" — usada pra menus do shell do racha que
 * ainda não têm implementação real. Lê título/ícone/descrição via
 * `route.data` ou fallback pelo path.
 *
 * Em vez de criar 8 componentes idênticos, registramos a mesma classe em
 * múltiplas rotas com `data` diferente em cada uma.
 */
@Component({
  selector: 'app-racha-placeholder',
  templateUrl: './placeholder.page.html',
  styleUrls: ['./placeholder.page.scss'],
  standalone: false,
})
export class RachaPlaceholderPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navBack = inject(NavBackService);

  /** Tag de cabeçalho — ex: "PAINEL DE PARTIDAS". */
  tag = '';
  /** Título grande — ex: "Em breve". */
  titulo = '';
  /** Subtítulo/descrição — ex: "Estamos preparando essa tela pra você." */
  subtitulo = '';
  /** Ícone Ionicons grande exibido na ilustração. */
  icone = 'sparkles-outline';

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    this.tag = data['tag'] ?? 'EM BREVE';
    this.titulo = data['titulo'] ?? 'Em breve';
    this.subtitulo = data['subtitulo']
      ?? 'Estamos preparando essa tela. Avisaremos assim que estiver pronta.';
    this.icone = data['icone'] ?? 'sparkles-outline';
  }

  voltarInicio(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id');
    if (id) this.router.navigate(['/racha', id, 'inicio']);
    else this.router.navigateByUrl('/racha');
  }
  /** Volta pra tela anterior usando histórico do browser; fallback pra
   *  home do racha quando entrou direto via URL. */
  voltar(): void {
    const id = this.route.snapshot.parent?.paramMap.get('id') ?? this.route.snapshot.paramMap.get('id');
    this.navBack.back(id ? '/racha/' + id + '/inicio' : '/racha');
  }
}