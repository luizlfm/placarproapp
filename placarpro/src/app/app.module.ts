import { NgModule, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { ServiceWorkerModule } from '@angular/service-worker';

// Firebase / AngularFire
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideStorage, getStorage } from '@angular/fire/storage';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import {
  provideAnalytics,
  getAnalytics,
  ScreenTrackingService,
  UserTrackingService,
} from '@angular/fire/analytics';

import { environment } from '../environments/environment';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    // `innerHTMLTemplatesEnabled: true` permite usar tags HTML (`<b>`, `<br>`, etc.)
    // nas mensagens de `ion-alert` / `ion-toast`. Sem isso, o Ionic 8 escapa o HTML
    // por segurança e o usuário vê literalmente "<b>SOU ESPECTADOR</b>" como texto.
    // IMPORTANTE: não interpole INPUT DO USUÁRIO direto em alert.message — sanitize antes,
    // pra não abrir janela de XSS. Use o helper `AlertService` em vez do AlertController
    // direto sempre que possível (ele sanitiza por default).
    IonicModule.forRoot({ innerHTMLTemplatesEnabled: true }),
    AppRoutingModule,
    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage()),
    // Cloud Functions na região southamerica-east1 — onde estão as funções
    // de pagamento Mercado Pago e webhook.
    provideFunctions(() => getFunctions(undefined, 'southamerica-east1')),
    // Analytics só roda em browsers compatíveis (não SSR/web workers).
    provideAnalytics(() => getAnalytics()),
    ScreenTrackingService,
    UserTrackingService,
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
