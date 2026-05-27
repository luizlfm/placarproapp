import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EspectadorPage } from './espectador.page';

const routes: Routes = [{ path: '', component: EspectadorPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class EspectadorPageRoutingModule {}
