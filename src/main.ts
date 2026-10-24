import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app';
import { loadAllDictionaries, loadDictionary } from './app/i18n/dictionaries';
import { initialLanguage } from './app/i18n/i18n.service';

// English is bundled; French/Arabic are lazy chunks. Load the saved language first so the first
// render is already translated (<html lang dir> is set by the inline script in index.html), then
// fetch the rest when idle so cross-language search works.
loadDictionary(initialLanguage())
  .then(() => bootstrapApplication(AppComponent, appConfig))
  .then(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (idle) idle(() => void loadAllDictionaries());
    else setTimeout(() => void loadAllDictionaries(), 2000);
  })
  .catch((err) => console.error(err));

// Offline support (app shell + cached grocery list). Production builds only, so `ng serve`
// is never served stale files.
if ('serviceWorker' in navigator && !isDevMode()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // unsupported context (e.g. plain http on a LAN address): the app works without it
    });
  });
}
