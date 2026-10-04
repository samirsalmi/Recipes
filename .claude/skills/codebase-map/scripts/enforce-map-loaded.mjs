#!/usr/bin/env node
// Session-scoped nudge: reminds the model to load the codebase-map skill before it reads or
// searches source files, so it doesn't burn tokens exploring blind. Never blocks — only injects
// a reminder once per session, the first time src/ or backend/ is touched without the map loaded.
// Hook wiring (see .claude/settings.json):
//   PostToolUse matcher "Skill"          -> marks the map as loaded for this session
//   PreToolUse  matcher "Read|Grep|Glob" -> reminds once if the map wasn't loaded first
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const markerDir = path.join(tmpdir(), 'claude-codebase-map');
mkdirSync(markerDir, { recursive: true });
const marker = path.join(markerDir, `${input.session_id}.loaded`);
const reminded = path.join(markerDir, `${input.session_id}.reminded`);

if (input.tool_name === 'Skill') {
  if (input.tool_input?.skill === 'codebase-map') writeFileSync(marker, '1');
  process.exit(0);
}

if (existsSync(marker) || existsSync(reminded)) process.exit(0);

const SOURCE_RE = /(^|[\\/])(src|backend)([\\/]|$)/;
const candidates = [input.tool_input?.file_path, input.tool_input?.path, input.tool_input?.pattern].filter(Boolean);
const touchesSource = candidates.some((c) => SOURCE_RE.test(c));

if (!touchesSource) process.exit(0);

writeFileSync(reminded, '1');
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext:
        'Reminder: the codebase-map skill has not been loaded this session yet. Load it before further ' +
        'exploration of src/ or backend/ to avoid unnecessary reads.',
    },
  })
);
