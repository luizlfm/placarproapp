import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { RachaRoutingModule } from './racha-routing.module';
import { MeusRachasPage } from './pages/meus-rachas/meus-rachas.page';
import { CriarRachaPage } from './pages/criar-racha/criar-racha.page';
import { AtivarRachaPage } from './pages/ativar-racha/ativar-racha.page';

/**
 * Módulo Racha — módulo lazy-loaded em `/racha`.
 *
 * Contém:
 *  - `/racha` → listagem dos rachas do usuário (`MeusRachasPage`)
 *  - `/racha/novo` → form rápido de criação (`CriarRachaPage`)
 *  - `/racha/:id/ativar` → wizard 3 passos (`AtivarRachaPage`)
 *
 * Usa NgModule (não standalone) pra ficar consistente com o resto do app.
 */
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    RachaRoutingModule,
  ],
  declarations: [
    MeusRachasPage,
    CriarRachaPage,
    AtivarRachaPage,
  ],
})
export class RachaModule {}
