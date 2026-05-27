import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PatrocinadoresPage } from './patrocinadores.page';

describe('PatrocinadoresPage', () => {
  let component: PatrocinadoresPage;
  let fixture: ComponentFixture<PatrocinadoresPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PatrocinadoresPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
