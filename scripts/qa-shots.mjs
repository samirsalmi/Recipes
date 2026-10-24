#!/usr/bin/env node
// Visual QA harness: drives the installed Microsoft Edge (puppeteer-core, no browser
// download) with real device emulation and screenshots every key screen in light + dark,
// logged out and logged in, including open states (sheets, expanded items). Fails loudly if
// any page scrolls horizontally.
//
//   npm run qa:shots                         # everything
//   npm run qa:shots -- --only=plan,groceries --devices=mobile-360 --themes=dark
//   npm run qa:i18n                          # French + Arabic (RTL) pass over the key pages
//   npm run qa:shots -- --langs=fr,ar --only=discover,recipe --devices=mobile-360
//
// --langs sets the UI language (default en): the guest pages get it from localStorage, the
// signed-in pages from the account (the script PATCHes /auth/me and restores English at the end).
// Screenshots of non-English passes are named <device>-<theme>-<lang>-<auth>-<screen>.png; an
// Arabic pass also asserts <html dir="rtl"> and fails on horizontal overflow like any other.
//
// Needs the dev server (npm start, http://localhost:4200) and the API running with the demo
// data (python -m app.demo). Env: QA_BASE (app URL), QA_API (API base; default read from
// src/environments/environment.ts), QA_USER / QA_PASSWORD (default amina.demo / demo-pass-1),
// QA_BROWSER (browser executable). Screenshots go to qa-shots/ (gitignored).
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa-shots');
const BASE = process.env.QA_BASE ?? 'http://localhost:4200';
const API = process.env.QA_API ?? readApiBase();
const USER = process.env.QA_USER ?? 'amina.demo';
const PASSWORD = process.env.QA_PASSWORD ?? 'demo-pass-1';
const BROWSER = process.env.QA_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const TOKEN_KEY = 'recipe_manager_auth_token'; // src/app/services/auth-state.ts
const THEME_KEY = 'mise_theme'; // src/app/services/theme.service.ts
const LANG_KEY = 'mise_lang'; // src/app/i18n/config.ts

const DEVICES = {
  'mobile-360': { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'mobile-390': { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'tablet-768': { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'desktop-1440': { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const THEMES = ['light', 'dark'];
const MAX_SHOT_HEIGHT = 2400;

/** Screens. `auth`: 'guest' | 'user'. `action` opens a state after load. */
function scenarios(recipeId, cuisineSlug, unitsRecipeId) {
  return [
    { name: 'discover', path: '/', auth: 'guest' },
    { name: 'discover', path: '/', auth: 'user' },
    { name: 'discover-filters', path: '/', auth: 'user', action: click('[data-qa=open-filters]') },
    { name: 'discover-search', path: '/', auth: 'user', action: type('[data-qa=search]', 'lentil') },
    { name: 'cuisine', path: `/cuisines/${cuisineSlug}`, auth: 'guest' },
    { name: 'cuisines', path: '/cuisines', auth: 'guest' },
    { name: 'recipe', path: `/recipes/${recipeId}`, auth: 'guest' },
    { name: 'recipe', path: `/recipes/${recipeId}`, auth: 'user' },
    { name: 'recipe-add-to-plan', path: `/recipes/${recipeId}`, auth: 'user', action: click('[data-qa=add-to-plan]') },
    { name: 'recipe-menu', path: `/recipes/${recipeId}`, auth: 'user', action: click('[data-qa=overflow-menu]') },
    { name: 'cook', path: `/cook/${recipeId}`, auth: 'guest' },
    { name: 'plan', path: '/plan', auth: 'user' },
    { name: 'plan-fill', path: '/plan', auth: 'user', action: click('[data-qa=fill-dinners]') },
    { name: 'plan-fill-cuisines', path: '/plan', auth: 'user', action: fillWithCuisines },
    { name: 'plan-picker', path: '/plan', auth: 'user', action: click('[data-qa=add-meal]') },
    { name: 'plan-entry-actions', path: '/plan', auth: 'user', action: click('[data-qa=plan-entry]') },
    { name: 'groceries', path: '/groceries', auth: 'user' },
    { name: 'groceries-item-open', path: '/groceries', auth: 'user', action: click('[data-qa=grocery-item-toggle]') },
    { name: 'groceries-staple-action', path: '/groceries', auth: 'user', action: stapleActionOpen },
    { name: 'groceries-have-open', path: '/groceries', auth: 'user', action: haveOpen, cleanup: clearQaState },
    { name: 'groceries-partial', path: '/groceries', auth: 'user', action: partialLines, cleanup: clearQaState },
    { name: 'groceries-pantry', path: '/groceries', auth: 'user', action: pantryOpen, cleanup: clearQaState },
    { name: 'groceries-share', path: '/groceries', auth: 'user', action: click('[data-qa=share-open]') },
    { name: 'groceries-range', path: '/groceries', auth: 'user', action: click('[data-qa=range-chip]') },
    { name: 'offline-banner', path: '/groceries', auth: 'user', action: goOffline },
    { name: 'stale-note-toast', path: '/groceries', auth: 'user', action: staleAndToast },
    { name: 'cookbook', path: '/cookbook', auth: 'user' },
    { name: 'household', path: '/household', auth: 'user' },
    { name: 'onboarding', path: '/onboarding', auth: 'user' },
    { name: 'recipe-new', path: '/recipes/new', auth: 'user' },
    { name: 'recipe-new-mixed', path: '/recipes/new', auth: 'user', action: type('#r-ingredients', '2 tbsp beurre\n100 g butter\n3 gousses d\'ail\n1 كوب زبدة\n1 zorblax') },
    { name: 'recipe-new-suggest', path: '/recipes/new', auth: 'user', action: ingredientHelper('2 tbsp froma', 'ingredient-suggestion') },
    { name: 'recipe-new-suggest-unit', path: '/recipes/new', auth: 'user', action: ingredientHelper('2 tab', 'unit-suggest') },
    { name: 'recipe-new-preview', path: '/recipes/new', auth: 'user', action: ingredientPreview },
    ...(unitsRecipeId
      ? [
          { name: 'units-recipe', path: `/recipes/${unitsRecipeId}`, auth: 'user' },
          { name: 'units-cook', path: `/cook/${unitsRecipeId}`, auth: 'user' },
          { name: 'units-editor', path: '/recipes/new', auth: 'user', action: unitsEditorPreview },
        ]
      : []),
    { name: 'credits', path: '/credits', auth: 'guest' },
    { name: 'login', path: '/login', auth: 'guest' },
    { name: 'register', path: '/register', auth: 'guest' },
  ];
}

/** Clicks the first *visible* match (mobile and desktop layouts both render some controls). */
/** Opens "fill empty dinners", expands the cuisine picker and picks two cuisines. */
async function fillWithCuisines(page) {
  await page.evaluate(() => localStorage.removeItem('mise_fill_cuisines')); // start from "any"
  await click('[data-qa=fill-dinners]')(page);
  await click('[data-qa=fill-cuisines-toggle]')(page);
  await page.waitForSelector('[data-qa=fill-cuisine-chip]', { visible: true, timeout: 8000 });
  const chips = await page.$$('[data-qa=fill-cuisine-chip]');
  for (const chip of chips.slice(0, 2)) await chip.click();
  await new Promise(r => setTimeout(r, 600));
  const box = await page.$eval('[data-qa=fill-cuisine-chip]', el => el.getBoundingClientRect().height);
  if (box < 44) throw new Error(`cuisine chip is only ${box}px tall`);
}

function click(selector) {
  return async page => {
    await page.waitForFunction(
      sel => [...document.querySelectorAll(sel)].some(el => el.checkVisibility?.() ?? el.offsetParent !== null),
      { timeout: 8000 },
      selector
    );
    for (const handle of await page.$$(selector)) {
      if (await handle.isVisible()) {
        await handle.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await handle.click();
        return;
      }
    }
    throw new Error(`no visible ${selector}`);
  };
}

// ---- have-at-home / pantry states: seeded through the API as amina.demo, undone by clearQaState ----

const qaTouched = { have: [], staples: [] };

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await qaToken()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

let tokenCache = null;
async function qaToken() {
  if (!tokenCache) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASSWORD }),
    });
    tokenCache = (await res.json()).access_token;
  }
  return tokenCache;
}

/** To-buy lines with one quantified part needing at least `min`, in list order. */
function quantified(list, min) {
  const lines = list.items.filter(i => i.state === 'to_buy' && !i.staple && i.parts.length === 1 && i.parts[0].needed >= min);
  // Whole-number counts read best in the screenshots; fall back to any quantified line.
  return [...lines.filter(i => i.parts[0].family.startsWith('count:')), ...lines.filter(i => !i.parts[0].family.startsWith('count:'))];
}

async function setHave(part, amount) {
  await api('PUT', '/groceries/have', { key: part.key, quantity: amount, unit: null });
  qaTouched.have.push(part.key);
}

async function reloadGroceries(page) {
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));
}

/** The have stepper open on a line with 3 of 6 at home (count lines preferred). */
async function haveOpen(page) {
  const list = await api('GET', '/groceries');
  const line = quantified(list, 4)[0];
  if (!line) throw new Error('no to-buy line needing 4+ to seed a have-amount');
  await setHave(line.parts[0], Math.floor(line.parts[0].needed / 2));
  await reloadGroceries(page);
  const names = await page.$$('[data-qa=at-home-note]');
  if (!names.length) throw new Error('no at-home note rendered');
  const toggle = await names[0].evaluateHandle(el => el.closest('[data-qa=grocery-item-toggle]'));
  await toggle.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await toggle.click();
  await page.waitForSelector('[data-qa=have-stepper]', { visible: true, timeout: 8000 });
  const h = await page.$eval('[data-qa=have-minus]', el => el.getBoundingClientRect().height);
  if (h < 44) throw new Error(`have stepper button is only ${h}px tall`);
}

/** An ordinary row expanded: the "Add to staples" action must be visible and 44 px tall. */
async function stapleActionOpen(page) {
  const toggles = await page.$$('[data-qa=grocery-item-toggle]');
  let picked = null;
  for (const t of toggles) {
    const plain = await t.evaluate(el => !el.querySelector('[data-qa=staple-badge]'));
    if (plain) { picked = t; break; }
  }
  if (!picked) throw new Error('no ordinary grocery row to expand');
  await picked.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await picked.click();
  await page.waitForSelector('[data-qa=add-staple]', { visible: true, timeout: 8000 });
  const box = await page.$eval('[data-qa=add-staple]', el => { const r = el.getBoundingClientRect(); return { h: r.height, right: r.right, left: r.left }; });
  if (box.h < 44) throw new Error(`add-staple is only ${box.h}px tall`);
  if (box.left < 0 || box.right > page.viewport().width) throw new Error('add-staple overflows the viewport');
}

/** One partially covered line ("need 3 more") and one fully covered line. */
async function partialLines(page) {
  const list = await api('GET', '/groceries');
  const lines = quantified(list, 2);
  if (lines.length < 2) throw new Error('need two quantified to-buy lines');
  await setHave(lines[0].parts[0], Math.max(1, Math.floor(lines[0].parts[0].needed / 2)));
  await setHave(lines[1].parts[0], lines[1].parts[0].needed);
  await reloadGroceries(page);
  await page.waitForSelector('[data-qa=need-more]', { visible: true, timeout: 8000 });
  await page.$eval('[data-qa=need-more]', el => el.scrollIntoView({ block: 'center' }));
}

/** The pantry section with one staple flagged "I need it". */
async function pantryOpen(page) {
  const list = await api('GET', '/groceries');
  const staple = list.items.find(i => i.pantryState === 'have');
  if (!staple) throw new Error('no staple in the plan to seed the pantry');
  await api('POST', '/groceries/staples', { name: staple.key, promoted: true });
  qaTouched.staples.push(staple.key);
  await reloadGroceries(page);
  await page.waitForSelector('[data-qa=pantry-section]', { visible: true, timeout: 8000 });
  await page.$eval('[data-qa=pantry-section]', el => el.scrollIntoView({ block: 'start' }));
  for (const sel of ['[data-qa=staple-need]', '[data-qa=staple-have]']) {
    const h = await page.$eval(sel, el => el.getBoundingClientRect().height).catch(() => 44);
    if (h < 44) throw new Error(`${sel} is only ${h}px tall`);
  }
}

async function clearQaState() {
  for (const key of qaTouched.have.splice(0)) await api('PUT', '/groceries/have', { key, quantity: null }).catch(() => undefined);
  for (const key of qaTouched.staples.splice(0)) await api('POST', '/groceries/staples', { name: key, promoted: false }).catch(() => undefined);
}

/** Offline banner: the browser drops its connection after the page (and list cache) loaded. */
async function goOffline(page) {
  await page.setOfflineMode(true);
  await page.waitForSelector('[data-qa=offline-banner]', { visible: true, timeout: 8000 });
}

/** Stale-list note + partner toast: block only the grocery list request, then let the other
 *  household member (alex.demo) add an extra and nudge the activity poll with a focus event. */
async function staleAndToast(page) {
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (req.method() !== 'OPTIONS' && url.pathname === '/api/groceries') req.abort('failed');
    else req.continue();
  });
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alex.demo', password: PASSWORD }),
  });
  const alex = (await res.json()).access_token;
  await fetch(`${API}/groceries/extras`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alex}` },
    body: JSON.stringify({ name: 'Dish soap (QA)' }),
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForSelector('[data-qa=stale-note]', { visible: true, timeout: 8000 });
  await page.waitForSelector('[data-qa=toast]', { visible: true, timeout: 8000 });
}

/** Types into the ingredient field and waits for the suggestion list (ingredient names or units);
 *  fails when a row is under 44 px. */
function ingredientHelper(text, rowQa) {
  return async page => {
    await page.waitForSelector('[data-qa=ingredient-input]', { visible: true, timeout: 8000 });
    await page.click('[data-qa=ingredient-input]');
    await page.keyboard.type(text, { delay: 25 });
    await page.waitForSelector(`[data-qa=${rowQa}]`, { visible: true, timeout: 8000 });
    await new Promise(r => setTimeout(r, 400));
    const heights = await page.$$eval('[data-qa=ingredient-suggest] [role=option]', els => els.map(el => el.getBoundingClientRect().height));
    if (!heights.length || heights.some(h => h < 43.5)) throw new Error(`suggestion rows must be >= 44px: ${heights}`);
    await page.$eval('[data-qa=ingredient-suggest]', el => el.scrollIntoView({ block: 'center' }));
  };
}

/** A pasted-style multi-line list; lines are tidied into the reader's language on Enter / blur. */
async function ingredientPreview(page) {
  await page.waitForSelector('[data-qa=ingredient-input]', { visible: true, timeout: 8000 });
  await page.click('[data-qa=ingredient-input]');
  const lines = ['2 table spoon fromage', '1 pinch zaatar', '250 g de farine', '3 zorblax', '2 جبن'];
  for (const line of lines) {
    await page.keyboard.type(line, { delay: 10 });
    await page.keyboard.press('Enter');
  }
  await page.$eval('[data-qa=ingredient-input]', el => el.blur());
  await page.waitForSelector('[data-qa=ingredient-was]', { visible: true, timeout: 8000 });
  await new Promise(r => setTimeout(r, 900));
  await page.$eval('[data-qa=ingredient-preview]', el => el.scrollIntoView({ block: 'center' }));
}

/** Kitchen units (cups, small cups, spoons) in the editor's live preview, with their metric equivalents. */
async function unitsEditorPreview(page) {
  await page.waitForSelector('[data-qa=ingredient-input]', { visible: true, timeout: 8000 });
  await page.click('[data-qa=ingredient-input]');
  for (const line of ['1 cup flour', '1 coffee cup sugar', '2 tbsp butter', '5 cups water', '1 فنجان أرز']) {
    await page.keyboard.type(line, { delay: 10 });
    await page.keyboard.press('Enter');
  }
  await page.$eval('[data-qa=ingredient-input]', el => el.blur());
  await page.waitForSelector('[data-qa=ingredient-preview]', { visible: true, timeout: 8000 });
  await new Promise(r => setTimeout(r, 900));
  await page.$eval('[data-qa=ingredient-preview]', el => el.scrollIntoView({ block: 'center' }));
}

function type(selector, text) {
  return async page => {
    await page.waitForSelector(selector, { visible: true, timeout: 8000 });
    await page.type(selector, text);
  };
}

function readApiBase() {
  const src = readFileSync(path.join(ROOT, 'src/environments/environment.ts'), 'utf8');
  const active = src.split('\n').find(l => /^\s*apiBaseUrl\s*:/.test(l));
  const m = active?.match(/['"]([^'"]+)['"]/);
  return m ? m[1] : 'http://localhost:8000/api';
}

function arg(name) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1].split(',').filter(Boolean) : null;
}

async function main() {
  if (!existsSync(BROWSER)) throw new Error(`Browser not found: ${BROWSER} (set QA_BROWSER)`);
  const only = arg('only');
  const devices = arg('devices') ?? Object.keys(DEVICES);
  const themes = arg('themes') ?? THEMES;
  const langs = arg('langs') ?? ['en'];

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`Login as ${USER} failed (${login.status}) - run python -m app.demo`);
  const token = (await login.json()).access_token;
  const setAccountLanguage = lang =>
    fetch(`${API}/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ language: lang }),
    });
  const recipes = await (await fetch(`${API}/recipes`)).json();
  if (!recipes.length) throw new Error('No recipes - run python -m app.content_import');
  const sample = recipes.find(r => r.image && r.steps.length) ?? recipes[0];
  const cuisineSlug = (sample.cuisine ?? 'other').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');

  // A throwaway recipe with kitchen units for the equivalents screens; deleted in `finally`.
  let unitsRecipeId = null;
  if (!only || only.some(o => o.startsWith('units'))) {
    const made = await fetch(`${API}/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'QA kitchen units',
        servings: 4,
        ingredients: [
          { quantity: 1, unit: 'cup', name: 'flour' },
          { quantity: 2, unit: 'tbsp', name: 'butter' },
          { quantity: 1, unit: 'small cup', name: 'sugar' },
          { quantity: 1, unit: 'فنجان', name: 'rice' },
          { quantity: 5, unit: 'cup', name: 'water' },
          { quantity: 1.5, unit: 'tsp', name: 'salt' },
          { quantity: 200, unit: 'g', name: 'carrots' },
        ],
        steps: [{ text: 'Mix the flour, butter, sugar, rice, water and salt with the carrots.' }],
      }),
    });
    if (made.ok) unitsRecipeId = (await made.json()).id;
    else console.warn(`could not create the units recipe (${made.status})`);
  }

  if (!only) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--hide-scrollbars', ...(process.env.QA_HOST_RULES ? [`--host-resolver-rules=${process.env.QA_HOST_RULES}`] : [])] });
  const failures = [];
  const consoleErrors = [];
  let shots = 0;
  try {
    for (const lang of langs) {
    await setAccountLanguage(lang);
    for (const scenario of scenarios(sample.id, cuisineSlug, unitsRecipeId)) {
      if (only && !only.some(o => scenario.name === o || scenario.name.startsWith(`${o}-`))) continue;
      for (const deviceName of devices) {
        for (const theme of themes) {
          const page = await browser.newPage();
          await page.emulate({
            viewport: DEVICES[deviceName],
            userAgent: DEVICES[deviceName].isMobile
              ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
              : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
          });
          await page.emulateMediaFeatures([
            { name: 'prefers-color-scheme', value: theme },
            { name: 'prefers-reduced-motion', value: 'reduce' },
          ]);
          await page.evaluateOnNewDocument(
            (tokenKey, themeKey, themeValue, tokenValue, langKey, langValue) => {
              localStorage.setItem(themeKey, themeValue);
              localStorage.setItem(langKey, langValue);
              if (tokenValue) localStorage.setItem(tokenKey, tokenValue);
              else localStorage.removeItem(tokenKey);
            },
            TOKEN_KEY, THEME_KEY, theme, scenario.auth === 'user' ? token : '', LANG_KEY, lang
          );
          const label = `${deviceName}-${theme}-${lang === 'en' ? '' : `${lang}-`}${scenario.auth}-${scenario.name}`;
          page.on('console', msg => {
            if (msg.type() === 'error') consoleErrors.push(`${label}: ${msg.text()}`);
          });
          page.on('pageerror', err => consoleErrors.push(`${label}: ${err.message}`));
          try {
            await page.goto(`${BASE}${scenario.path}`, { waitUntil: 'networkidle0', timeout: 30000 });
            await new Promise(r => setTimeout(r, 400));
            if (scenario.action) {
              await scenario.action(page);
              await new Promise(r => setTimeout(r, 600));
            }
            const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
            if (html.lang !== lang || html.dir !== (lang === 'ar' ? 'rtl' : 'ltr')) {
              failures.push(`${label}: <html lang=${html.lang} dir=${html.dir}> does not match ${lang}`);
            }
            const overflow = await page.evaluate(() => ({
              scrollWidth: document.scrollingElement.scrollWidth,
              innerWidth: window.innerWidth,
            }));
            if (overflow.scrollWidth > overflow.innerWidth) {
              failures.push(`${label}: horizontal overflow (${overflow.scrollWidth} > ${overflow.innerWidth})`);
            }
            // Open states: the viewport. Pages: the top MAX_SHOT_HEIGHT px (very tall full-page
            // captures tile/repeat in Chromium and are unreadable anyway).
            if (scenario.action) {
              await page.screenshot({ path: path.join(OUT, `${label}.png`) });
            } else {
              // Grow the viewport to the page height (captureBeyondViewport garbles RTL scroll rows).
              const height = await page.evaluate(() => document.scrollingElement.scrollHeight);
              await page.setViewport({ ...DEVICES[deviceName], height: Math.min(height, MAX_SHOT_HEIGHT) });
              await new Promise(r => setTimeout(r, 300));
              await page.screenshot({ path: path.join(OUT, `${label}.png`) });
            }
            shots++;
            if (scenario.cleanup) await scenario.cleanup();
          } catch (err) {
            if (scenario.cleanup) await scenario.cleanup();
            failures.push(`${label}: ${err.message}`);
          } finally {
            await page.close();
          }
        }
      }
    }
    }
  } finally {
    await setAccountLanguage('en').catch(() => undefined);
    if (unitsRecipeId) {
      await fetch(`${API}/recipes/${unitsRecipeId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    }
    await browser.close();
  }

  console.log(`qa-shots: ${shots} screenshots in ${OUT}`);
  if (consoleErrors.length) {
    console.log(`\nConsole errors (${consoleErrors.length}):`);
    for (const e of [...new Set(consoleErrors)].slice(0, 40)) console.log(`  - ${e}`);
  }
  if (failures.length) {
    console.error(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('No horizontal overflow at any size.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
