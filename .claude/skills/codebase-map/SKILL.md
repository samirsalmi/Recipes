---
name: codebase-map
description: Map of the Recipes codebase (Angular 21 frontend in src/, FastAPI + MySQL backend in backend/) - which file owns what, how data flows, where to make a given change, and known bugs. Load this before searching, reading, or editing source files in this repo, including quick questions like "where is X handled" or "why does Y happen", so you open only the files that matter instead of exploring. Also load it when adding, moving, renaming, or deleting source files, because the map must change in the same edit.
---

# Codebase map

Reading files to find out where things are is the most expensive way to work in this repo: the frontend alone is ~6k lines (~60k tokens), while this map is a few thousand. Read the map first, then open only what it points to.

## Where to look

| Area | Map file | Status |
|---|---|---|
| Frontend (Angular) | [frontend.md](frontend.md) | complete, covers everything under src/ |
| Backend (FastAPI) | [backend.md](backend.md) | complete, covers everything under backend/ |
| Database (MySQL) | [database.md](database.md) | complete, covers the two-table schema |

Read only the area file your task touches. Each starts with a "Start here by task" table that usually names the exact file and function.

## How to navigate

1. Find your task in the task table or the file index, then go straight to the named file and symbol.
2. Open the smallest slice that answers the question:
   - LSP tool, when a code-intelligence plugin is installed: go to definition, find references, list a file's symbols.
   - Otherwise Grep the symbol with line numbers, then Read with offset/limit around it.
   - Read a whole file only when it is short (under ~150 lines) or you are about to change most of it.
3. Component templates (.html) are long. Grep for the handler or binding name instead of reading them.
4. Never read `src/app/data/mock-recipes.ts` whole: it is 1.7k lines of seed data. Grep it by recipe name or id.
5. Explore beyond the map only when it doesn't answer your question, and then add what you learned so the next session doesn't pay for the same search.
6. Stop when the question is answered. Confirm the specific lines you cite, but don't audit neighbouring code, scan the seed data, or run experiments nobody asked for; mention a suspicion in one line instead. Side investigations cost more than the map saves.

The map is checked mechanically (paths and names), but its descriptions can lag behind the code. When they disagree, the code wins - fix the map in the same change.

## Keeping it true

Update the map in the same change whenever you:
- add, move, rename, or delete a source file;
- add or rename a public method, signal, input/output, route, or model that the map mentions;
- find a bug worth listing under Gotchas, or fix one that is listed (then remove it).

Format rules the checker relies on:
- Write repo paths in full and repo-relative, inside backticks: `src/app/services/recipe.service.ts`.
- On a line that names a file, every backticked identifier must exist in one of the files named on that line. Identifiers that belong to another file go on a line with that file's path.
- One line per file: what it owns plus its key names. Longer explanations go under Flows or Gotchas.

Check the map with:

    node .claude/skills/codebase-map/scripts/check-map.mjs

It reports dead paths, names that no longer exist, and source files missing from the map. A Stop hook runs it at the end of every turn and sends you back if the map drifted.
