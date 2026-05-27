import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RankingsPage } from './rankings.page';

describe('RankingsPage', () => {
  let component: RankingsPage;
  let fixture: ComponentFixture<RankingsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(RankingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
