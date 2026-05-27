import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OrganizadorPage } from './organizador.page';

describe('OrganizadorPage', () => {
  let component: OrganizadorPage;
  let fixture: ComponentFixture<OrganizadorPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(OrganizadorPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
