import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MidiaPage } from './midia.page';

describe('MidiaPage', () => {
  let component: MidiaPage;
  let fixture: ComponentFixture<MidiaPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(MidiaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
