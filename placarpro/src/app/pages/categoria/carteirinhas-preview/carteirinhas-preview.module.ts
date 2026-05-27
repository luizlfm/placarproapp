import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';

import { CarteirinhasPreviewPageRoutingModule } from './carteirinhas-preview-routing.module';
import { CarteirinhasPreviewPage } from './carteirinhas-preview.page';
import { SharedModule } from '../../../shared/shared.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CarteirinhasPreviewPageRoutingModule,
    SharedModule,
  ],
  declarations: [CarteirinhasPreviewPage],
})
export class CarteirinhasPreviewPageModule {}
