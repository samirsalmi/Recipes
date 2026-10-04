#!/usr/bin/env node
// Checks the codebase map against the repo: backticked paths must exist, names cited on a
// line that names a file must exist in that file, and every source file must be mapped.
// CLI:  node .claude/skills/codebase-map/scripts/check-map.mjs
// Hook: node .claude/skills/codebase-map/scripts/check-map.mjs --hook   (Stop hook JSON protocol)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SKILL_DIR, '../../..');
const HOOK = process.argv.includes('--hook');

const MUST_MAP = [
  (f) => f.startsWith('src/') && f.endsWith('.ts') && !f.endsWith('.spec.ts'),
  (f) =>
    f.startsWith('backend/') &&
    f.endsWith('.py') &&
    !f.endsWith('__init__.py') &&
    !/\/(tests?|versions)\//.test(f),
];
const CODE_EXT = /\.(ts|html|scss|css|js|mjs|py|json)$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

if (HOOK) {
  const raw = readFileSync(0, 'utf8');
  // A second block in a row would loop forever if the model can't fix the map; let it stop.
  if (raw && JSON.parse(raw).stop_hook_active) process.exit(0);
}

const rootEntries = new Set(readdirSync(ROOT));
const contentCache = new Map();

function read(rel) {
  if (!contentCache.has(rel)) contentCache.set(rel, readFileSync(path.join(ROOT, rel), 'utf8'));
  return contentCache.get(rel);
}

function filesUnder(rel) {
  const abs = path.join(ROOT, rel);
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs, { recursive: true })
    .map((f) => path.posix.join(rel.replace(/\/$/, ''), f.split(path.sep).join('/')))
    .filter((f) => CODE_EXT.test(f) && statSync(path.join(ROOT, f)).isFile());
}

function pathToken(token) {
  if (/[\s<>*{}?]/.test(token)) return null;
  if (token.includes('/')) return rootEntries.has(token.split('/')[0]) ? token : null;
  return rootEntries.has(token) && statSync(path.join(ROOT, token)).isFile() ? token : null;
}

function hasName(files, name) {
  const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
  return files.some((f) => re.test(read(f)));
}

const problems = { dead: [], names: [], unmapped: [] };
const mentioned = new Set();
let namesChecked = 0;

for (const mapFile of readdirSync(SKILL_DIR).filter((f) => f.endsWith('.md'))) {
  readFileSync(path.join(SKILL_DIR, mapFile), 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const where = `${mapFile}:${i + 1}`;
      const tokens = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
      const paths = [];
      for (const token of tokens) {
        const p = pathToken(token);
        if (!p) continue;
        if (existsSync(path.join(ROOT, p))) {
          paths.push(p);
          mentioned.add(p.replace(/\/$/, ''));
        } else {
          problems.dead.push(`${where}: \`${p}\` does not exist`);
        }
      }
      if (!paths.length) return;
      const searchSpace = paths.flatMap(filesUnder);
      for (const token of tokens) {
        if (pathToken(token) || !IDENTIFIER.test(token)) continue;
        const name = token.replace(/\(\)$/, '').split('.').pop();
        namesChecked++;
        if (!hasName(searchSpace, name)) {
          problems.names.push(`${where}: \`${token}\` not found in ${paths.join(', ')}`);
        }
      }
    });
}

const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && MUST_MAP.some((rule) => rule(f)) && existsSync(path.join(ROOT, f)));

for (const f of sourceFiles) {
  if (!mentioned.has(f)) problems.unmapped.push(f);
}

const lines = [
  ...problems.dead.map((p) => `- dead path: ${p}`),
  ...problems.names.map((p) => `- stale name: ${p}`),
  ...problems.unmapped.map((f) => `- not in the map: ${f} (add a one-line entry to the right area file)`),
];

if (!lines.length) {
  if (!HOOK) {
    console.log(`codebase-map OK: ${sourceFiles.length} source files mapped, ${namesChecked} names verified.`);
  }
  process.exit(0);
}

const report =
  'The codebase map in .claude/skills/codebase-map/ is out of date. Load the codebase-map skill if it is not loaded, ' +
  'fix these entries, then re-run `node .claude/skills/codebase-map/scripts/check-map.mjs`:\n' +
  lines.join('\n');

if (HOOK) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: report }));
  process.exit(0);
}
console.error(report);
process.exit(1);
