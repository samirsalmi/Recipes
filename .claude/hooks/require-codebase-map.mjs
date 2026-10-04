#!/usr/bin/env node
// PreToolUse gate for Read|Grep|Glob: source code can't be read or searched until the
// codebase-map skill has been loaded in this session, so every session starts from the map.
// Disabled. To enable, add to .claude/settings.json under hooks.PreToolUse:
//   { "matcher": "Read|Grep|Glob", "hooks": [{ "type": "command", "timeout": 10,
//     "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/require-codebase-map.mjs\"" }] }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATED_DIRS = ['src', 'backend'];

const { tool_name, tool_input = {}, session_id, transcript_path, cwd = ROOT } = JSON.parse(
  readFileSync(0, 'utf8'),
);

function repoRelative(p) {
  return path.relative(ROOT, path.resolve(cwd, p)).split(path.sep).join('/');
}

function isGated(rel) {
  if (rel.startsWith('..')) return false;
  const first = rel.split('/')[0];
  // '' is the repo root: a recursive search from there reaches src/.
  return rel === '' || GATED_DIRS.includes(first) || first.includes('**') || first.includes('{');
}

function touchesSource() {
  if (tool_name === 'Read') return isGated(repoRelative(tool_input.file_path ?? ROOT));
  const base = tool_input.path ?? cwd;
  if (tool_name === 'Glob') return isGated(repoRelative(path.join(base, tool_input.pattern ?? '')));
  return isGated(repoRelative(base));
}

function mapLoaded() {
  const marker = path.join(os.tmpdir(), 'claude-codebase-map', String(session_id));
  if (existsSync(marker)) return true;
  if (!transcript_path || !existsSync(transcript_path)) return false;
  const transcript = readFileSync(transcript_path, 'utf8');
  const loaded =
    /"skill":"(?:[\w-]+:)?codebase-map"/.test(transcript) ||
    /<command-name>\/(?:[\w-]+:)?codebase-map<\/command-name>/.test(transcript);
  if (loaded) {
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, '');
  }
  return loaded;
}

if (touchesSource() && !mapLoaded()) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Load the codebase-map skill first (Skill tool, skill "codebase-map"), then retry. ' +
          'It names the files and functions to open for this task, so you can skip exploratory reads. ' +
          'Needed once per session.',
      },
    }),
  );
}
