import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CarteirinhasPreviewPage } from './carteirinhas-preview.page';

const routes: Routes = [{ path: '', component: CarteirinhasPreviewPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CarteirinhasPreviewPageRoutingModule {}
