import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { ClassificacaoPageRoutingModule } from './classificacao-routing.module';
import { SharedModule } from '../../../shared/shared.module';

import { ClassificacaoPage } from './classificacao.page';
import { FasesModalComponent } from './fases-modal/fases-modal.component';
import { CriteriosModalComponent } from './criterios-modal/criterios-modal.component';
import { GerarPartidasModalComponent } from './gerar-partidas-modal/gerar-partidas-modal.component';
import { ReordenarModalComponent } from './reordenar-modal/reordenar-modal.component';
import { EditarFaseModalComponent } from './editar-fase-modal/editar-fase-modal.component';
import { NovaFaseModalComponent } from './nova-fase-modal/nova-fase-modal.component';
import { DestacarPosicoesModalComponent } from './destacar-posicoes-modal/destacar-posicoes-modal.component';
import { NovaRodadaModalComponent } from './nova-rodada-modal/nova-rodada-modal.component';
import { EditarRodadaModalComponent } from './editar-rodada-modal/editar-rodada-modal.component';
import { ReordenarRodadasModalComponent } from './reordenar-rodadas-modal/reordenar-rodadas-modal.component';
import { EditarInformacoesModalModule } from '../jogo-detalhe/editar-informacoes-modal/editar-informacoes-modal.module';
import { ImprimirClassificacaoPage } from './imprimir/imprimir-classificacao.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ClassificacaoPageRoutingModule,
    SharedModule,
    EditarInformacoesModalModule,
  ],
  declarations: [
    ClassificacaoPage,
    FasesModalComponent,
    CriteriosModalComponent,
    GerarPartidasModalComponent,
    ReordenarModalComponent,
    EditarFaseModalComponent,
    NovaFaseModalComponent,
    DestacarPosicoesModalComponent,
    NovaRodadaModalComponent,
    EditarRodadaModalComponent,
    ReordenarRodadasModalComponent,
    ImprimirClassificacaoPage,
  ],
})
export class ClassificacaoPageModule {}
