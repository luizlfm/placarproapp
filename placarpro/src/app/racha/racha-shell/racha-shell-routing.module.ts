import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { RachaShellPage } from './racha-shell.page';
import { RachaInicioPage } from '../pages/shell/inicio/inicio.page';
import { RachaPlaceholderPage } from '../pages/shell/_placeholder/placeholder.page';
import { RachaMeuRachaPage } from '../pages/shell/meu-racha/meu-racha.page';
import { RachaTimesPage } from '../pages/shell/times/times.page';
import { RachaJogadoresPage } from '../pages/shell/jogadores/jogadores.page';
import { RachaSortearPage } from '../pages/shell/sortear/sortear.page';
import { RachaPresencaPage } from '../pages/shell/presenca/presenca.page';
import { RachaFinanceiroPage } from '../pages/shell/financeiro/financeiro.page';
import { RachaRankingPage } from '../pages/shell/ranking/ranking.page';
import { RachaUpgradePage } from '../pages/shell/upgrade/upgrade.page';
import { RachaWhatsappPage } from '../pages/shell/whatsapp/whatsapp.page';
import { RachaVisaoGeralPage } from '../pages/shell/visao-geral/visao-geral.page';
import { RachaAoVivoPage } from '../pages/shell/ao-vivo/ao-vivo.page';
import { RachaPartidasPage } from '../pages/shell/partidas/partidas.page';
import { RachaParcaPage } from '../pages/shell/parca/parca.page';
import { RachaRankingMundialPage } from '../pages/shell/ranking-mundial/ranking-mundial.page';
import { RachaAvaliacaoPage } from '../pages/shell/avaliacao/avaliacao.page';
import { RachaConquistasPage } from '../pages/shell/conquistas/conquistas.page';
import { RachaMercadoPage } from '../pages/shell/mercado/mercado.page';

/**
 * Rotas filhas do shell — todas vivem sob `/racha/:id/*`.
 *
 * A maioria das telas tem implementação real. As que ainda não têm
 * (`parca`, `partidas`, `ao-vivo`, `ranking-mundial`, `visao-geral`,
 * `whatsapp`) usam `RachaPlaceholderPage` com `data` específico —
 * trocar pra componente próprio é só criar e atualizar aqui.
 */
const routes: Routes = [
  {
    path: '',
    component: RachaShellPage,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },

      // ============ Telas com implementação real ============
      { path: 'inicio',          component: RachaInicioPage },
      { path: 'meu-racha',       component: RachaMeuRachaPage },
      { path: 'times',           component: RachaTimesPage },
      { path: 'jogadores',       component: RachaJogadoresPage },
      { path: 'sortear',         component: RachaSortearPage },
      { path: 'presenca',        component: RachaPresencaPage },
      { path: 'financeiro',      component: RachaFinanceiroPage },
      { path: 'ranking',         component: RachaRankingPage },
      { path: 'upgrade',         component: RachaUpgradePage },
      { path: 'whatsapp',        component: RachaWhatsappPage },
      { path: 'visao-geral',     component: RachaVisaoGeralPage },
      { path: 'ao-vivo',         component: RachaAoVivoPage },
      { path: 'partidas',        component: RachaPartidasPage },
      { path: 'parca',           component: RachaParcaPage },
      { path: 'ranking-mundial', component: RachaRankingMundialPage },

      // ============ Features novas (MVP funcional) ============
      { path: 'avaliacao',       component: RachaAvaliacaoPage },
      { path: 'conquistas',      component: RachaConquistasPage },
      { path: 'mercado',         component: RachaMercadoPage },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class RachaShellRoutingModule {}
