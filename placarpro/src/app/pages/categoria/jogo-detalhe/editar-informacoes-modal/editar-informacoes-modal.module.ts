import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { SharedModule } from '../../../../shared/shared.module';
import { SumulaPageModule } from '../sumula/sumula.module';
import { EditarInformacoesModalComponent } from './editar-informacoes-modal.component';

/**
 * Wrapper module pra permitir que o EditarInformacoesModalComponent seja
 * usado em features diferentes do JogoDetalhePageModule (ex.: Classificação).
 * Em Angular legacy um componente só pode estar em um único NgModule;
 * esse módulo isolado evita duplicação.
 *
 * Importa também `SumulaPageModule` porque o botão "Súmula" deste modal
 * abre a SumulaPage como modal (via ModalController) — sem importar aqui,
 * o componente não estaria disponível quando o EditarInformacoes é aberto
 * de páginas que não importam JogoDetalhePageModule (ex.: classificacao).
 */
@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    SharedModule,
    SumulaPageModule,
  ],
  declarations: [EditarInformacoesModalComponent],
  exports: [EditarInformacoesModalComponent],
})
export class EditarInformacoesModalModule {}
