import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShellPage } from './shell.page';

describe('ShellPage', () => {
  let component: ShellPage;
  let fixture: ComponentFixture<ShellPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ShellPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
