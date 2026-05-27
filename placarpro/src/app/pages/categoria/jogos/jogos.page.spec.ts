import { ComponentFixture, TestBed } from '@angular/core/testing';
import { JogosPage } from './jogos.page';

describe('JogosPage', () => {
  let component: JogosPage;
  let fixture: ComponentFixture<JogosPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(JogosPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
