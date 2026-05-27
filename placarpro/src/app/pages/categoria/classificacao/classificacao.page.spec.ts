import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ClassificacaoPage } from './classificacao.page';

describe('ClassificacaoPage', () => {
  let component: ClassificacaoPage;
  let fixture: ComponentFixture<ClassificacaoPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(ClassificacaoPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
