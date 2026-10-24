# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase map: load it first

Before searching, reading, or editing source files, load the `codebase-map` skill (`.claude/skills/codebase-map/`). It lists each file's job and key names, a task-to-file table, the core data flows, and known bugs, so you open only what the task needs.

Keep the map true: when you add, move, rename, or delete a source file, or rename something the map cites, update the map in the same change. `node .claude/skills/codebase-map/scripts/check-map.mjs` verifies it, and a Stop hook runs that check at the end of every turn.

## What the app is

"Mise", a shared kitchen planner (product spec: `docs/rework-plan.md`): a household picks recipes, drops them on days, and always has an accurate, shared grocery list, even when the plan changes mid-week.

## Commands

- `npm start` - dev server (`ng serve`) at http://localhost:4200
- `npm run build` - production build via `@angular/build:application`, output to `dist/recipe-manager/browser` (deployed on Vercel per `vercel.json`)
- `npm run watch` - development build with `--watch`
- `npm test` - unit tests (`@angular/build:unit-test`, Vitest/jsdom); one file: `npm test -- --include src/app/utils/ingredient-parser.spec.ts`
- `npm run qa:shots` - visual QA (`scripts/qa-shots.mjs`): drives the installed Edge via puppeteer-core with device emulation (360/390/768/1440 px), light + dark, guest + `amina.demo`, including open sheets; fails on horizontal overflow. Needs `npm start` and the API with demo data. Screenshots land in `qa-shots/` (gitignored) - look at them after UI changes. Filters: `-- --only=plan,groceries --devices=mobile-360 --themes=dark`. Open states click `data-qa="..."` hooks in templates; keep them when editing.
- No lint script; `tsconfig.json` is `strict` with `strictTemplates` etc. - rely on `ng build` for type errors.
- Backend (in `backend/`, venv `backend/.venv`, see `backend/README.md`):
  - `python scripts/create_db.py --admin-url postgresql://postgres:PASS@localhost:5434/postgres --password APP_PASS --with-test-db` - one-time DB + role bootstrap
  - `alembic upgrade head` - schema (PostgreSQL 18, local dev cluster on port 5434 (data dir outside the repo, see backend/.env comments))
  - `python -m app.content_import` - load `content/recipes/*.json` (validate, Cloudinary AVIF upload with `content/images.lock.json`, sync system recipes)
  - `python -m app.demo` - two demo accounts (alex.demo / amina.demo, password `demo-pass-1`) in one household
  - `uvicorn app.main:app --reload --port 8000` - the API; the frontend uses `environment.apiBaseUrl`
  - `python -m pytest` - tests on in-memory SQLite; set `TEST_DATABASE_URL` (db name must contain "test") to run them on PostgreSQL

## Conventions

- Angular 21, standalone components only (no NgModules), every route lazy-loads via `loadComponent`; router has view transitions and component input binding (route params arrive as `input()`s).
- Backend: FastAPI + PostgreSQL (SQLAlchemy 2, psycopg 3, Alembic; JSONB + TIMESTAMPTZ via the `JSONType`/`TS` aliases in `backend/app/models.py`). Accounts are username + password + name (no email, no password reset).
- **Households**: every account belongs to exactly one household (auto-created on register, and re-created on login/`/auth/me` if missing). The meal plan (`meal_plan_entries`), the grocery shop (`shopping_trips`/`shopping_marks`/`shopping_extras`) and the activity feed belong to the household. Every household endpoint resolves the household from the token via `get_membership` - never accept a household id from the client, and answer 404 for another household's rows.
- **Live updates**: every plan/grocery/household mutation calls `log_activity()`; the client (`HouseholdService`) polls `GET /api/household/activity?since=<cursor>` every ~8 s while visible and on focus, and other members' events refresh plan/groceries via `remoteEvents$`.
- **Groceries are derived, not stored**: needed quantities are recomputed from the plan on every request (`backend/app/groceries.py`, unit-aware: mass/volume/count families, never converting across families). Only purchases (`shopping_marks.purchased_qty` per `<canonical name>|<family>` key), extras and promoted staples are stored. Optional ingredients are excluded from "needed" and offered as one-tap extras. Ingredient names merge via the canonical dictionary in `backend/app/ingredients.py` - add aliases there.
- **Recipes**: model v2 (`src/app/models/recipe.model.ts` mirrors `to_response()` in `backend/app/recipe_data.py`): mealTypes, diet flags, traditional, budget, ingredients with group/note/optional/aisle, steps text/timerMinutes, source, imageCredit, optional nutrition; no ratings. `POST /api/recipes` needs only name + ingredients; id, author, dateAdded, aisles and totalTime are server-assigned. System recipes (`owner_id IS NULL`) come only from `content/recipes/*.json` via `app.content_import`, which never touches user recipes. Don't edit `content/recipes/*.json` by hand from code tasks.
- Browsing needs no account: `/`, `/cuisines`, `/cuisines/:slug`, `/recipes/:id`, `/cook/:id`, `/credits` are public; `/plan`, `/groceries`, `/cookbook`, `/household`, `/join/:code`, `/onboarding`, `/recipes/new`, `/recipes/:id/edit` use `authGuard` (which passes `returnUrl` to /login). Account-linked actions on public pages call `requireLogin(router)` (`src/app/services/auth-redirect.ts`) first. `authInterceptor` force-logs-out only on a 401 where a token was sent.
- Frontend services share one shape: private `signal`s, `computed()` views, public `.asReadonly()`, hydrate in the constructor (or an `effect()` on `isAuthenticated()`), mutations update the signal and call the backend. **All HTTP goes through `StorageService`** and returns `Observable`s - keep that for new endpoints. The recipe catalog loads async (`RecipeService.recipesLoaded()`); resolve a recipe from a route param reactively and fall back to `resolveRecipe()` (frontend.md G11).
- Curated recipes with `source.license = "Original"` (author "Mise kitchen") were written for the app; show them as "Written for Mise" (detail + /credits), never as "Adapted from".
- Dates for plan/trips are plain local `YYYY-MM-DD` strings end to end - use `src/app/utils/dates.ts`, never `toISOString()` for a calendar day.
- Any new per-serving recipe field needs a matching rule in `RecipeService.scaleRecipe` (nutrition is per serving and is not scaled).
- Recipe photos: `POST /api/images` and the importer both store Cloudinary AVIF (`format="avif"`) - keep that. Credentials in `backend/.env` (`CLOUDINARY_*`); a wrong secret fails as `Invalid Signature` (500), not 401. Wikimedia downloads need a descriptive User-Agent and get rate-limited (429): the importer lets Cloudinary fetch the original first, then uses the Commons API's official 1920 px thumbnail, then a paced local download (shrinking >10 MB originals with Pillow). Never hand-build Wikimedia thumbnail URLs.
- **Design system** (docs/rework-plan.md section 6): colors are CSS variables (RGB triplets) in `src/styles.scss` - light on `:root`, dark on `html.dark` - mapped to Tailwind names in `tailwind.config.js` (`paper`, `surface`, `sunken`, `ink`, `muted`, `hairline`, `primary` + `hover`/`tint`/`on`, `accent` paprika, `saffron`). Use those utilities and the component classes in `styles.scss` (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.chip`/`.chip-active`, `.card`, `.input`/`.textarea`/`.select`, `.sheet`, `.tab-bar`, `.page`) - never raw hex colors or the removed orange/green/red palettes. Fonts: Fraunces (display, `font-display`) + Inter (`font-sans`), from `@fontsource-variable` via `angular.json`. Mobile-first: 44 px tap targets, safe-area insets (`--safe-bottom`), bottom sheets (`app-bottom-sheet`) instead of modals, motion off under `prefers-reduced-motion`.
- Dark mode: `ThemeService` toggles the `dark` class on `<html>` (explicit choice in localStorage, else the OS setting); style with tokens or Tailwind `dark:` variants, not a `[data-theme]` attribute.
- **i18n (en/fr/ar, Arabic RTL)**: every user-visible string goes through `I18nService.t()` (`src/app/i18n/`, English keys in `en.ts` first, then `fr.ts`/`ar.ts`; `i18n.spec.ts` enforces parity). The language is stored on the account (`users.language`, `PATCH /api/auth/me`) and mirrored in localStorage `mise_lang`. Recipe data stays canonical English-keyed: ingredients keep the typed `name` and get a server-stamped `canonical`; responses add `names` {en,fr,ar} (from `backend/app/ingredient_names.py`) and the client shows `i18n.ingredientName()`; units go through `i18n.unit()`/`amountParts()`. Recipe titles/steps are shown as written (optional author `translations` are preferred when present). Use logical Tailwind classes (`ms-/me-/ps-/pe-/start-/end-`, `text-start`), never `ml-/mr-/pl-/pr-/left-/right-/text-left`. Test with `npm run qa:i18n`.
- Component styles: Tailwind in templates; Angular CLI schematics default new components to `style: scss` but most components are template-only.
