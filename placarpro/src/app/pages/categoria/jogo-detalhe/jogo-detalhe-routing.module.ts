import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { JogoDetalhePage } from './jogo-detalhe.page';
import { EditorPartidaPage } from './editor-partida/editor-partida.page';
import { SumulaPage } from './sumula/sumula.page';
import { PreSumulaPage } from './pre-sumula/pre-sumula.page';

const routes: Routes = [
  { path: '', component: JogoDetalhePage },
  { path: 'editar', component: EditorPartidaPage },
  { path: 'sumula', component: SumulaPage },
  { path: 'pre-sumula', component: PreSumulaPage },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class JogoDetalhePageRoutingModule {}
