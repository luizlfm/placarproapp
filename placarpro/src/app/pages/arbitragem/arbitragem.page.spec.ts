import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArbitragemPage } from './arbitragem.page';

describe('ArbitragemPage', () => {
  let component: ArbitragemPage;
  let fixture: ComponentFixture<ArbitragemPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ArbitragemPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
