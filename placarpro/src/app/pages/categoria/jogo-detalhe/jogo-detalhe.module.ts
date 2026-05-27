import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { JogoDetalhePageRoutingModule } from './jogo-detalhe-routing.module';
import { JogoDetalhePage } from './jogo-detalhe.page';
import { EditarInformacoesModalModule } from './editar-informacoes-modal/editar-informacoes-modal.module';
import { EventoModalComponent } from './evento-modal/evento-modal.component';
import { EscalacaoModalComponent } from './escalacao-modal/escalacao-modal.component';
import { EditorPartidaPage } from './editor-partida/editor-partida.page';
import { SumulaPage } from './sumula/sumula.page';
import { PreSumulaPage } from './pre-sumula/pre-sumula.page';
import { SharedModule } from '../../../shared/shared.module';
import { ImageCropperComponent } from 'ngx-image-cropper';
import { PatrocinadorJogoModalComponent } from './patrocinador-jogo-modal/patrocinador-jogo-modal.component';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    JogoDetalhePageRoutingModule,
    SharedModule,
    EditarInformacoesModalModule,
    ImageCropperComponent,
  ],
  declarations: [
    JogoDetalhePage,
    EditorPartidaPage,
    SumulaPage,
    PreSumulaPage,
    EventoModalComponent,
    EscalacaoModalComponent,
    PatrocinadorJogoModalComponent,
  ],
})
export class JogoDetalhePageModule {}
