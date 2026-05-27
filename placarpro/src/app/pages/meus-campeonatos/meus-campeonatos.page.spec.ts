import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeusCampeonatosPage } from './meus-campeonatos.page';

describe('MeusCampeonatosPage', () => {
  let component: MeusCampeonatosPage;
  let fixture: ComponentFixture<MeusCampeonatosPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MeusCampeonatosPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
