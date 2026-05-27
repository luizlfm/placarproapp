import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JogadoresPage } from './jogadores.page';

describe('JogadoresPage', () => {
  let component: JogadoresPage;
  let fixture: ComponentFixture<JogadoresPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(JogadoresPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
