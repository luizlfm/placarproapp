import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { ListaSimplesModalComponent } from './lista-simples-modal/lista-simples-modal.component';
import { LocaisCadastradosModalComponent } from './locais-cadastrados-modal/locais-cadastrados-modal.component';
import { ExibicaoModalComponent } from './exibicao-modal/exibicao-modal.component';
import { InfoModalComponent } from './info-modal/info-modal.component';
import { AnexosModalComponent } from './anexos-modal/anexos-modal.component';
import { PatrocinadoresModalComponent } from './patrocinadores-modal/patrocinadores-modal.component';
import { ModeradoresModalComponent } from './moderadores-modal/moderadores-modal.component';
import { MedalhasModalComponent } from './medalhas-modal/medalhas-modal.component';
import { EnquetesModalComponent } from './enquetes-modal/enquetes-modal.component';
import { ResultadoModalComponent } from './resultado-modal/resultado-modal.component';
import { MapaPickerModalComponent } from '../components/mapa-picker-modal/mapa-picker-modal.component';
import { MapaPickerComponent } from '../components/mapa-picker/mapa-picker.component';

/**
 * Modais compartilhados das telas de Configuração do Campeonato:
 * arbitros, locais, anexos, patrocinadores, moderadores, medalhas,
 * enquetes, exibição, embed/api/visualizações.
 */
@NgModule({
  imports: [CommonModule, FormsModule, IonicModule],
  declarations: [
    ListaSimplesModalComponent,
    LocaisCadastradosModalComponent,
    ExibicaoModalComponent,
    InfoModalComponent,
    AnexosModalComponent,
    PatrocinadoresModalComponent,
    ModeradoresModalComponent,
    MedalhasModalComponent,
    EnquetesModalComponent,
    ResultadoModalComponent,
    MapaPickerModalComponent,
    MapaPickerComponent,
  ],
  exports: [
    ListaSimplesModalComponent,
    LocaisCadastradosModalComponent,
    ExibicaoModalComponent,
    InfoModalComponent,
    AnexosModalComponent,
    PatrocinadoresModalComponent,
    ModeradoresModalComponent,
    MedalhasModalComponent,
    EnquetesModalComponent,
    ResultadoModalComponent,
    MapaPickerModalComponent,
    MapaPickerComponent,
  ],
})
export class ConfigModalsModule {}
