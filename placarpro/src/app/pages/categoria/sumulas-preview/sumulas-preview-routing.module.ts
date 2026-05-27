import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SumulasPreviewPage } from './sumulas-preview.page';

const routes: Routes = [{ path: '', component: SumulasPreviewPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class SumulasPreviewPageRoutingModule {}
