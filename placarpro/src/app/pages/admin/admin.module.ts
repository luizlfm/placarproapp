import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { AdminPage } from './admin.page';
import { AdminPageRoutingModule } from './admin-routing.module';
import { UserDetailModalComponent } from './user-detail-modal/user-detail-modal.component';
import { CampeonatoDetailModalComponent } from './campeonato-detail-modal/campeonato-detail-modal.component';
import { SharedModule } from '../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IonicModule,
    AdminPageRoutingModule,
    SharedModule,
  ],
  declarations: [
    AdminPage,
    UserDetailModalComponent,
    CampeonatoDetailModalComponent,
  ],
})
export class AdminPageModule {}
