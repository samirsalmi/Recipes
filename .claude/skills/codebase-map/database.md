# Database map (MySQL)

Three tables, defined as SQLAlchemy models in `backend/app/models.py`. Schema changes go
through Alembic (`backend/migrations/`, driven by `backend/migrations/env.py` off the same
`Settings.database_url` and `Base.metadata` the app uses) - never rely on `create_all` for a
schema change; see `backend/README.md` for the `alembic upgrade head` / `alembic stamp`
workflow, including for a database created before migrations existed.

## Tables

- `backend/app/models.py` `RecipeRow` maps to table `recipes` - `id VARCHAR(64) PRIMARY KEY`, `data JSON NOT NULL` (the full `Recipe` object minus the columns below, see `src/app/models/recipe.model.ts`), `owner_id` (nullable FK into `users.id` - null for seed/system recipes), `is_public BOOLEAN` (default true), `is_official BOOLEAN` (default false, admin-curated trust signal), `parent_recipe_id` (nullable self-FK into `recipes.id` - set when this row is a "twist" forked from another recipe). The API composes the response by merging `data` with these columns (`_to_response()` in `backend/app/routers/recipes.py`) rather than storing them twice.
- `backend/app/models.py` `UserRow` maps to table `users` - `id` (autoincrement PK), `username` (unique, lowercased on write), `hashed_password` (bcrypt), `name`, `created_at`, `is_admin BOOLEAN` (default false - gates curating `recipes.is_official`, set by hand, no admin UI). One row per registered account; no email field.
- `backend/app/models.py` `AppStorageRow` maps to table `app_storage` - composite PK (`user_id` FK into `users.id`, `key` VARCHAR(255)), `value JSON`. One row per (account, storage key): favorites, ratings, collections, mealPlan, shoppingList, per-recipe notes, darkMode. `value` holds whatever shape that key's `src/app/services/storage.service.ts` method expects (array, object, string, or boolean).

## Gotchas

- No table is indexed beyond its primary key (and the unique index on the users table's username column, plus the FKs on `recipes.owner_id`/`recipes.parent_recipe_id`); fine at seed-data scale, but a real catalog would want indexes on filterable recipe columns (category, difficulty, is_public, is_official) if filtering ever needs to scale further. Today filtering/sorting stays client-side in `src/app/services/recipe.service.ts` `filteredRecipes`, except the public/own and root-vs-twist split, which is filtered in SQL in `backend/app/routers/recipes.py`.
- `app_storage.value` has no schema validation - a bad write from the frontend (e.g. wrong shape for `mealPlan`) is stored as-is and will only surface when the frontend tries to read it back.
- `app_storage` changed shape when accounts were added (single `key` PK -> composite `(user_id, key)` PK); there's no migration path for existing single-user data, so upgrading a pre-auth deployment means exporting and manually re-inserting old rows against a real user id.
- A recipe going private is "unlisted," not deleted or access-controlled by id: `GET /api/recipes/{id}` never checks `is_public`. Only the discovery listing (`GET /api/recipes`) and the twists listing filter on it. Don't add a visibility check to the by-id endpoint without also fixing every place that resolves a recipe by id outside of discovery (favorites, meal plan, shopping list, twist parent links).
- Deleting a recipe row that other rows reference via `parent_recipe_id` fails with a FK integrity error unless those children are updated first - `delete_recipe()` in `backend/app/routers/recipes.py` nulls out any twists' `parent_recipe_id` before deleting. Deleting a recipe does *not* clean up ids of it left behind in other accounts' generic key/value storage rows (favorites, meal plan, shopping list, collections) - those just become dangling references that fail to resolve (`GET /api/recipes/{id}` 404s), same as any other permanently-removed recipe; no cascade or cleanup job exists for that.
