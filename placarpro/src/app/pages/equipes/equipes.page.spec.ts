import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EquipesPage } from './equipes.page';

describe('EquipesPage', () => {
  let component: EquipesPage;
  let fixture: ComponentFixture<EquipesPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(EquipesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
