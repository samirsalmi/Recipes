# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase map: load it first

Before searching, reading, or editing source files, load the `codebase-map` skill (`.claude/skills/codebase-map/`). It lists each file's job and key names, a task-to-file table, the core data flows, and known bugs, so you open only what the task needs.

Keep the map true: when you add, move, rename, or delete a source file, or rename something the map cites, update the map in the same change. `node .claude/skills/codebase-map/scripts/check-map.mjs` verifies it, and a Stop hook runs that check at the end of every turn.

## Commands

- `npm start` — run the dev server (`ng serve`) at http://localhost:4200
- `npm run build` — production build via `@angular/build:application`, output to `dist/recipe-manager/browser` (deployed on Vercel per `vercel.json`)
- `npm run watch` — development-configuration build with `--watch`
- `npm test` — run the unit test suite (`@angular/build:unit-test`, powered by Vitest/jsdom)
- Run a single test file: `npm test -- src/app/app.spec.ts` (pass any path/pattern after `--`)
- There is no configured lint script; `tsconfig.json` runs in `strict` mode with `strictTemplates`, `strictInjectionParameters`, and `strictInputAccessModifiers` — rely on `ng build`/editor TS diagnostics to catch type errors.
- Backend: `cd backend && uvicorn app.main:app --reload --port 8000` (FastAPI, expects MySQL per `backend/.env`; see `backend/README.md` for setup, `docker compose up -d` starts a local MySQL). The frontend expects it at `http://localhost:8000/api`.

## Conventions

- Angular 21, standalone components only (no NgModules); every route lazy-loads via `loadComponent`. Backend is FastAPI + MySQL under `backend/` with JWT account auth — accounts are username + password + name, no email, and there's no password reset yet: a public `recipes` table any logged-in account can add to, and a generic `app_storage` key/value table, scoped per user, that mirrors the old `localStorage` keys. `MOCK_RECIPES` (`src/app/data/mock-recipes.ts`, 2 Italian dishes adapted from a 1919 public-domain cookbook, images re-hosted on Cloudinary) only seeds the database (`backend/app/seed.py`) — the running app fetches recipes from the API. `backend/app/seed.py` does a full sync, not an additive one: re-running it after editing the seed file deletes any recipe row not present in the file.
- Browsing needs no account; only account-linked features do (favorites, ratings, notes, meal plan, collections, shopping list, and adding a recipe). `AuthService` (`src/app/services/auth.service.ts`) holds the session, `authGuard`/`guestGuard` (`src/app/guards/auth.guard.ts`) protect the account-only routes (`add-recipe`, `meal-plan`, `favorites`, `collections`, `shopping-list`; not `/`, `/recipes`, `/recipes/:id`, `/cooking/:id`), and `authInterceptor` (`src/app/interceptors/auth.interceptor.ts`) attaches the bearer token, force-logging-out only on a 401 where a token was actually sent (a guest's expected 401 on an account-only endpoint should not redirect them). Any account-linked action reachable from a public page must check `isAuthenticated()` itself and redirect to `/login` (see `RecipeService.toggleFavorite()`/`setRating()`), since the route isn't guarded.
- Recipe photos go through `POST /api/images`, which uploads to Cloudinary and always stores the result as AVIF (`format="avif"` in `backend/app/routers/images.py`), regardless of what format was uploaded — keep that conversion when touching the upload path. Cloudinary credentials live in `backend/.env` (`CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`); a wrong API secret fails as a 500 with `Invalid Signature`, not a clean 401.
- Recipes created via `POST /api/recipes` get their `id`, `rating`, `reviewCount`, `author`, and `dateAdded` assigned server-side (see `backend/app/routers/recipes.py` `create_recipe()`) — the frontend never generates a recipe id itself, unlike meal plan/collections/shopping list (`frontend.md` gotcha G6).
- Domain services share one shape: private `signal`s hold state, `computed()` derives views, public signals are exposed via `.asReadonly()`, state hydrates from `StorageService` in the constructor, and every mutation writes back through `StorageService` right after updating the signal (fire-and-forget `.subscribe()`).
- `StorageService` methods return `Observable`s (RxJS, now wrapping `HttpClient` calls to the backend) — keep that convention for new storage methods rather than switching to Promises. The recipe catalog loads asynchronously (`RecipeService.recipesLoaded()`), so code that resolves a recipe from a route param must react to the catalog arriving instead of reading it once in `ngOnInit` (see `frontend.md` gotcha G11).
- Any new per-serving field on `Recipe` needs a matching scale rule in `RecipeService.scaleRecipe`.
- Dark mode: `ThemeService` toggles the `dark` class on `<html>`; style with Tailwind `dark:` variants, not a `[data-theme]` attribute.
- Styling: Tailwind CSS (`tailwind.config.js`) + component-scoped SCSS; Angular CLI schematics default new components to `style: scss`.
