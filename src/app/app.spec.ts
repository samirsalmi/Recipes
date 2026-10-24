import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app';
import { NAV_ITEMS } from './components';
import { en } from './i18n/en';

describe('AppComponent shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('renders the five destinations in the mobile tab bar', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const tabBar = (fixture.nativeElement as HTMLElement).querySelector('nav.tab-bar');
    expect(tabBar).toBeTruthy();
    const labels = Array.from(tabBar!.querySelectorAll('a')).map(a => a.textContent?.trim());
    expect(labels).toEqual(NAV_ITEMS.map(i => (en as Record<string, string>)[i.label]));
  });
});
