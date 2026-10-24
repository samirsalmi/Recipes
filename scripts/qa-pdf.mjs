#!/usr/bin/env node
// Generates the real grocery PDF in the installed Edge for en/fr/ar (as amina.demo), saves the
// PDF files and extracts every page's JPEG so the layout can be looked at (the pages are JPEG
// images inside the PDF, see src/app/utils/pdf-writer.ts). Checks the %PDF header and page counts.
//
//   node scripts/qa-pdf.mjs [--langs=en,fr,ar] [--checked=2]
//
// Needs `npm start` and the API with demo data. Seeds `--checked` (default 2) items as checked
// through the API and unchecks them again at the end. Output: qa-shots/pdf/<lang>[-unchecked].pdf
// and <lang>[-unchecked]-p<N>.jpg. Env as in scripts/qa-shots.mjs (QA_BASE, QA_API, QA_BROWSER).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa-shots', 'pdf');
const BASE = process.env.QA_BASE ?? 'http://localhost:4200';
const API = process.env.QA_API ?? readApiBase();
const BROWSER = process.env.QA_BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function readApiBase() {
  const src = readFileSync(path.join(ROOT, 'src/environments/environment.ts'), 'utf8');
  const m = src.split('\n').find(l => /^\s*apiBaseUrl\s*:/.test(l))?.match(/['"]([^'"]+)['"]/);
  return m ? m[1] : 'http://localhost:8000/api';
}
const arg = (n, d) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;

/** JPEG page images inside a PDF written by buildImagePdf. */
function extractJpegs(buf) {
  const pages = [];
  let at = 0;
  for (;;) {
    const s = buf.indexOf(Buffer.from('/DCTDecode'), at);
    if (s < 0) break;
    const lenMatch = /\/Length (\d+)/.exec(buf.subarray(s, s + 60).toString('latin1'));
    const start = buf.indexOf(Buffer.from('stream\n'), s) + 7;
    pages.push(buf.subarray(start, start + Number(lenMatch[1])));
    at = start + Number(lenMatch[1]);
  }
  return pages;
}

async function main() {
  const langs = arg('langs', 'en,fr,ar').split(',');
  const nChecked = Number(arg('checked', '2'));
  mkdirSync(OUT, { recursive: true });
  const login = await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'amina.demo', password: 'demo-pass-1' }),
  })).json();
  const token = login.access_token;
  const call = (method, route, body) => fetch(`${API}${route}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined,
  });
  const list = await (await call('GET', '/groceries')).json();
  const marked = list.items.filter(i => i.state === 'to_buy' && !i.staple).slice(0, nChecked).map(i => i.key);
  for (const key of marked) await call('POST', '/groceries/mark', { key, quantities: null });

  const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true });
  const failures = [];
  try {
    for (const lang of langs) {
      await call('PATCH', '/auth/me', { language: lang });
      for (const includeChecked of [true, false]) {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await page.evaluateOnNewDocument((tk, tv, lk, lv) => {
          localStorage.setItem(tk, tv);
          localStorage.setItem(lk, lv);
          // Capture the blob the page "downloads" instead of saving it to disk.
          const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.download && this.href.startsWith('blob:')) {
              fetch(this.href).then(r => r.arrayBuffer()).then(b => {
                let s = '';
                const u = new Uint8Array(b);
                for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
                window.__pdf = { name: this.download, b64: btoa(s) };
              });
              return;
            }
            return click.call(this);
          };
        }, 'recipe_manager_auth_token', token, 'mise_lang', lang);
        page.on('pageerror', e => failures.push(`${lang}: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') failures.push(`${lang}: console ${m.text()}`); });
        await page.goto(`${BASE}/groceries`, { waitUntil: 'networkidle0' });
        await page.click('[data-qa=share-open]');
        await page.waitForSelector('[data-qa=share-sheet]', { visible: true });
        await new Promise(r => setTimeout(r, 700)); if (!includeChecked) { await page.click('[data-qa=include-checked]'); await new Promise(r => setTimeout(r, 300)); }
        await page.waitForFunction(() => { const b = document.querySelector('[data-qa=download-pdf]'); return b && !b.disabled; }, { timeout: 30000 });
        await new Promise(r => setTimeout(r, 500));
        await page.click('[data-qa=download-pdf]');
        await page.waitForFunction(() => window.__pdf, { timeout: 15000 });
        const { b64 } = await page.evaluate(() => window.__pdf);
        const buf = Buffer.from(b64, 'base64');
        const tag = `${lang}${includeChecked ? '' : '-unchecked'}`;
        if (buf.subarray(0, 5).toString() !== '%PDF-') failures.push(`${tag}: not a PDF`);
        writeFileSync(path.join(OUT, `${tag}.pdf`), buf);
        const jpegs = extractJpegs(buf);
        jpegs.forEach((j, i) => writeFileSync(path.join(OUT, `${tag}-p${i + 1}.jpg`), j));
        console.log(`${tag}: ${buf.length} bytes, ${jpegs.length} page(s)`);
        await page.close();
      }
    }
  } finally {
    for (const key of marked) await call('POST', '/groceries/unmark', { key });
    await call('PATCH', '/auth/me', { language: 'en' });
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
