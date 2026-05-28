import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { PublicoOrganizadorPage } from './publico-organizador.page';
import { SharedModule } from '../../shared/shared.module';

const routes: Routes = [
  { path: '', component: PublicoOrganizadorPage },
  // Sub-rotas estilo copafacil.com/{slug}/{gallery|about|contacts}.
  // O componente lê `:aba` do paramMap e renderiza a section certa.
  { path: ':aba', component: PublicoOrganizadorPage },
];

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    RouterModule.forChild(routes),
    SharedModule,
  ],
  declarations: [PublicoOrganizadorPage],
})
export class PublicoOrganizadorPageModule {}
