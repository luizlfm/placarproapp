import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampeonatoPage } from './campeonato.page';

describe('CampeonatoPage', () => {
  let component: CampeonatoPage;
  let fixture: ComponentFixture<CampeonatoPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(CampeonatoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
