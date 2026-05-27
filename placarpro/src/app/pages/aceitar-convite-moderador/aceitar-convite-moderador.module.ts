import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Routes } from '@angular/router';
import { AceitarConviteModeradorPage } from './aceitar-convite-moderador.page';

const routes: Routes = [{ path: '', component: AceitarConviteModeradorPage }];

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, RouterModule.forChild(routes)],
  declarations: [AceitarConviteModeradorPage],
})
export class AceitarConviteModeradorPageModule {}
