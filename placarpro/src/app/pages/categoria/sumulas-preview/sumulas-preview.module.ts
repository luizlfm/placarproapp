import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { SumulasPreviewPage } from './sumulas-preview.page';
import { SumulasPreviewPageRoutingModule } from './sumulas-preview-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    SumulasPreviewPageRoutingModule,
  ],
  declarations: [SumulasPreviewPage],
})
export class SumulasPreviewPageModule {}
