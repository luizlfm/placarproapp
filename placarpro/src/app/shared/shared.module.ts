import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { ImageCropperComponent } from 'ngx-image-cropper';

import { CampeonatoMobileHeaderComponent } from './components/campeonato-mobile-header/campeonato-mobile-header.component';
import { ModalidadePickerComponent } from './components/modalidade-picker/modalidade-picker.component';
import { GruposModalComponent } from './components/grupos-modal/grupos-modal.component';
import { ImageCropperModalComponent } from './components/image-cropper-modal/image-cropper-modal.component';
import { JogoModalComponent } from './components/jogo-modal/jogo-modal.component';
import { EditarResultadoModalComponent } from './components/editar-resultado-modal/editar-resultado-modal.component';
import { PontosExtrasModalComponent } from './components/pontos-extras-modal/pontos-extras-modal.component';
import { PontosExtrasFormModalComponent } from './components/pontos-extras-form-modal/pontos-extras-form-modal.component';
import { ArteDoJogoModalComponent } from './components/arte-do-jogo-modal/arte-do-jogo-modal.component';
import { JogoAcoesPopoverComponent } from './components/jogo-acoes-popover/jogo-acoes-popover.component';
import { JogosAcoesPopoverComponent } from './components/jogos-acoes-popover/jogos-acoes-popover.component';
import { MaskDirective } from './directives/mask.directive';
import { SelecionarEquipesModalComponent } from './components/selecionar-equipes-modal/selecionar-equipes-modal.component';
import { SelecionarLadoModalComponent } from './components/selecionar-lado-modal/selecionar-lado-modal.component';
import { ModeradoresModalComponent } from './components/moderadores-modal/moderadores-modal.component';
import { SeguidoresModalComponent } from './components/seguidores-modal/seguidores-modal.component';
import { SelecionarSeguidorModalComponent } from './components/selecionar-seguidor-modal/selecionar-seguidor-modal.component';
import { LoginModalComponent } from '../auth/login-modal/login-modal.component';
import { ArbitragemJogoModalComponent } from './components/arbitragem-jogo-modal/arbitragem-jogo-modal.component';
import { AnexosJogoModalComponent } from './components/anexos-jogo-modal/anexos-jogo-modal.component';
import { PatrocinadoresFaixaComponent } from './components/patrocinadores-faixa/patrocinadores-faixa.component';
import { BannerSiteFaixaComponent } from './components/banner-site-faixa/banner-site-faixa.component';
import { CarteirinhasTamanhoModalComponent } from './components/carteirinhas-tamanho-modal/carteirinhas-tamanho-modal.component';
import { CarteirinhasConfigModalComponent } from './components/carteirinhas-config-modal/carteirinhas-config-modal.component';
import { CarteirinhasEquipesModalComponent } from './components/carteirinhas-equipes-modal/carteirinhas-equipes-modal.component';
import { EscolherJogoSumulaModalComponent } from './components/escolher-jogo-sumula-modal/escolher-jogo-sumula-modal.component';
import { PreSumulaHeaderModalComponent } from './components/pre-sumula-header-modal/pre-sumula-header-modal.component';
import { PreSumulaConfigModalComponent } from './components/pre-sumula-config-modal/pre-sumula-config-modal.component';
import { IframeRotaModalComponent } from './components/iframe-rota-modal/iframe-rota-modal.component';
// Transmissão ao vivo via LiveKit Cloud.
// ⚠️ Antes do primeiro build, rode `npm install` na raiz do `placarpro/`
// pra puxar `livekit-client` (declarado em package.json).
// Sem isso, o TypeScript falha em encontrar o módulo `livekit-client`.
import { TransmissaoModalComponent } from './components/transmissao-modal/transmissao-modal.component';
import { TransmissaoPlayerComponent } from './components/transmissao-player/transmissao-player.component';
import { RotatePromptComponent } from './components/rotate-prompt/rotate-prompt.component';
import { DateInputComponent } from './components/date-input/date-input.component';
import { ActionModalComponent } from './components/action-modal/action-modal.component';
import { ImgSkeletonDirective } from './directives/img-skeleton.directive';
import { IosPwaTutorialModalComponent } from './components/ios-pwa-tutorial-modal/ios-pwa-tutorial-modal.component';
import { PdfViewerModalComponent } from './components/pdf-viewer-modal/pdf-viewer-modal.component';
import { OcrImportModalComponent } from './ocr/ocr-import-modal/ocr-import-modal.component';

/**
 * Componentes/diretivas/pipes reutilizáveis pelo app inteiro.
 * Importe SharedModule no module da feature que precisar.
 */
@NgModule({
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IonicModule, RouterModule, ImageCropperComponent],
  declarations: [
    CampeonatoMobileHeaderComponent,
    ModalidadePickerComponent,
    GruposModalComponent,
    ImageCropperModalComponent,
    JogoModalComponent,
    EditarResultadoModalComponent,
    PontosExtrasModalComponent,
    PontosExtrasFormModalComponent,
    ArteDoJogoModalComponent,
    JogoAcoesPopoverComponent,
    JogosAcoesPopoverComponent,
    MaskDirective,
    SelecionarEquipesModalComponent,
    SelecionarLadoModalComponent,
    ModeradoresModalComponent,
    SeguidoresModalComponent,
    SelecionarSeguidorModalComponent,
    LoginModalComponent,
    ArbitragemJogoModalComponent,
    AnexosJogoModalComponent,
    PatrocinadoresFaixaComponent,
    BannerSiteFaixaComponent,
    CarteirinhasTamanhoModalComponent,
    CarteirinhasConfigModalComponent,
    CarteirinhasEquipesModalComponent,
    EscolherJogoSumulaModalComponent,
    PreSumulaHeaderModalComponent,
    PreSumulaConfigModalComponent,
    IframeRotaModalComponent,
    TransmissaoModalComponent,
    TransmissaoPlayerComponent,
    RotatePromptComponent,
    DateInputComponent,
    ActionModalComponent,
    ImgSkeletonDirective,
    IosPwaTutorialModalComponent,
    PdfViewerModalComponent,
    OcrImportModalComponent,
  ],
  exports: [
    CampeonatoMobileHeaderComponent,
    ModalidadePickerComponent,
    GruposModalComponent,
    ImageCropperModalComponent,
    JogoModalComponent,
    EditarResultadoModalComponent,
    PontosExtrasModalComponent,
    PontosExtrasFormModalComponent,
    ArteDoJogoModalComponent,
    JogoAcoesPopoverComponent,
    JogosAcoesPopoverComponent,
    MaskDirective,
    SelecionarEquipesModalComponent,
    SelecionarLadoModalComponent,
    ModeradoresModalComponent,
    SeguidoresModalComponent,
    SelecionarSeguidorModalComponent,
    LoginModalComponent,
    ArbitragemJogoModalComponent,
    AnexosJogoModalComponent,
    PatrocinadoresFaixaComponent,
    BannerSiteFaixaComponent,
    CarteirinhasTamanhoModalComponent,
    CarteirinhasConfigModalComponent,
    CarteirinhasEquipesModalComponent,
    EscolherJogoSumulaModalComponent,
    PreSumulaHeaderModalComponent,
    PreSumulaConfigModalComponent,
    IframeRotaModalComponent,
    TransmissaoModalComponent,
    TransmissaoPlayerComponent,
    RotatePromptComponent,
    DateInputComponent,
    ActionModalComponent,
    ImgSkeletonDirective,
    IosPwaTutorialModalComponent,
    PdfViewerModalComponent,
    OcrImportModalComponent,
  ],
})
export class SharedModule {}
