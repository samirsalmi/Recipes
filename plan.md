# Mise rework: plan and status

Product spec: `docs/rework-plan.md`. Project conventions: `CLAUDE.md`. Branch: `rework` (nothing committed yet).

## Recap: what is done

**Product direction.** The old recipe app became "Mise", a shared kitchen planner. A household picks recipes, drops them on days, and gets an accurate grocery list that stays correct when the plan changes mid-week.

**Content (finished).** 200 verified recipes across 63 cuisines in `content/recipes/*.json` (12 batch files, including `algerian-dinners.json` and `algerian-regions.json` with Algerian dinners by region, and `halal-dinners.json` and `halal-dinners-2.json` with halal mains from other cuisines). They include traditional/heritage dishes (69 Algerian), 108 low-budget recipes and 99 vegetarian ones. Sources are free-to-use (CC BY-SA 4.0, public domain, or "Original" written for Mise with a checkable reference link). Every photo was checked by eye; 13 recipes have no photo yet because no licensed photo of the dish was found. Authenticity re-checks were done on the Maghreb, heritage and budget batches.

**Backend (Phase 1-2 done).**
- FastAPI, SQLAlchemy 2, Alembic with one fresh baseline migration (`0001_v2_baseline`), switched from MySQL to PostgreSQL.
- Households with invite code and join/merge. Every household query is scoped by the token's membership.
- Live updates through an activity feed polled every ~8 s.
- Groceries are derived from the plan (`backend/app/groceries.py`): unit-aware, never converting across mass/volume/count, with purchased marks, extras, staples and optional ingredients.
- Canonical ingredient dictionary (~200 entries, EN/FR/Arabic-latin aliases).
- URL recipe import (JSON-LD, SSRF guards).
- Content importer with Cloudinary AVIF upload and `images.lock.json`.
- Demo accounts alex.demo / amina.demo (password `demo-pass-1`).
- 52 pytest tests pass.

**Frontend (Phase 2 done, Phase 3 in progress).**
- Angular 21 rewrite: new "Mise" design system (paper / herb green / paprika / saffron, Fraunces + Inter, dark mode), mobile bottom tab bar, bottom sheets.
- Services and models for recipes v2, household, plan, groceries and favorites.
- Ingredient parser, timers, date utilities.
- 19 Vitest tests pass and the build passes.
- Visual QA harness `npm run qa:shots` (Edge at 360/390/768/1440 px, light/dark, with an overflow check).

## What remains, by session

### Session A: PostgreSQL go-live (DONE: dev cluster on 5434)
- Provide the postgres superuser password, or set `DATABASE_URL=postgresql+psycopg://USER:PASS@localhost:5433/recipe_manager` in `backend/.env`. The local server listens on **5433**, not 5432.
- Run: `scripts/create_db.py` (with `--with-test-db`), `alembic upgrade head`, `python -m app.content_import`, `python -m app.demo`.
- Run pytest against `recipe_manager_test` with `TEST_DATABASE_URL`.

### Session B: finish Phase 3 (coder agent, resume after the limit reset)
- Remaining screens and fixes from review:
  - drop the "Traditional" badge from every card;
  - make badges legible over photos;
  - remove the empty cuisine circles;
  - add a cuisine explorer that scales to 59 cuisines, plus the filter sheet;
  - show "Written for Mise" for "Original" licenses.
- Fix the tz-aware vs naive datetime comparison in `build_list` `isNew`, and add a test.
- Upload all photos to Cloudinary (only 2 of 85 were done earlier); retry using Cloudinary-fetch first.
- Update `CLAUDE.md` and the codebase-map files (the map check currently fails on new files).
- Done when `qa:shots` has no overflow and build, vitest, pytest and check-map all pass.

### Session C: Phase 4 polish
- PWA / offline grocery list.
- View transitions, skeleton loaders, accessibility pass.
- Dark mode review.
- Review at all four widths.
- Budget week fill, Heritage and "Feed everyone for less" shelves.

### Session D: Phase 5 acceptance
- Walkthrough with two accounts side by side: plan a week, change it mid-week, check the grocery list.
- Add a recipe in under a minute (name + ingredients only).
- Final bug sweep.

### Open decisions
- Commit the `rework` branch locally as a safety net (not done; needs your OK).
- Optionally replace the chicken tagine source with the French Wikibooks version.
- To cut token use: fewer parallel agents, Sonnet for the coder, fewer review round-trips, and a quieter map-check hook during active development.
