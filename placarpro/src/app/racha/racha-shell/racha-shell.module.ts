import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { RachaShellRoutingModule } from './racha-shell-routing.module';
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
import { JogadorModalComponent } from '../modals/jogador-modal/jogador-modal.component';
import { MascaraInputDirective } from '../directives/mascara-input.directive';
import { SharedModule } from '../../shared/shared.module';

/**
 * Módulo Shell do Racha — empacota o layout (sidebar + topbar + outlet) e
 * todas as páginas filhas. Lazy-loaded em `/racha/:id` via RachaModule.
 *
 * Conforme novas telas reais forem criadas, importar aqui (declarations)
 * e trocar a rota correspondente em RachaShellRoutingModule.
 */
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    RachaShellRoutingModule,
    SharedModule,
  ],
  declarations: [
    RachaShellPage,
    RachaInicioPage,
    RachaPlaceholderPage,
    RachaMeuRachaPage,
    RachaTimesPage,
    RachaJogadoresPage,
    RachaSortearPage,
    RachaPresencaPage,
    RachaFinanceiroPage,
    RachaRankingPage,
    RachaUpgradePage,
    RachaWhatsappPage,
    RachaVisaoGeralPage,
    RachaAoVivoPage,
    RachaPartidasPage,
    RachaParcaPage,
    RachaRankingMundialPage,
    RachaAvaliacaoPage,
    RachaConquistasPage,
    RachaMercadoPage,
    JogadorModalComponent,
    MascaraInputDirective,
  ],
})
export class RachaShellModule {}
