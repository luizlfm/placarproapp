import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SeguindoPage } from './seguindo.page';

describe('SeguindoPage', () => {
  let component: SeguindoPage;
  let fixture: ComponentFixture<SeguindoPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(SeguindoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
