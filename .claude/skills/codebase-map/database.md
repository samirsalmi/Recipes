# Database map (PostgreSQL 18)

Thirteen tables, defined as SQLAlchemy models in `backend/app/models.py`. Schema changes go
through Alembic (`backend/migrations/`, driven by `backend/migrations/env.py` off the same
`Settings.database_url` and `Base.metadata` the app uses) - never `create_all` for a schema
change; see `backend/README.md`. JSON columns are JSONB and timestamps TIMESTAMPTZ (the `JSONType`/`TS`
aliases in `backend/app/models.py`, which fall back to JSON/DATETIME on the SQLite test database).
Local server: a PostgreSQL 18 dev cluster on port 5434 (separate from any other 5433 service); database `recipe_manager`, role `recipe_user`
(`backend/scripts/create_db.py`).

## Tables

- `backend/app/models.py` `RecipeRow` -> `recipes` - `id VARCHAR(64)` PK, `data JSON` (recipe model v2 content: name, description, image, imageCredit, cuisine, region, mealTypes, servings, prep/cook/totalTime, difficulty, traditional, budget, diet flags, tags, ingredients with group/quantity/unit/name/note/optional/aisle, steps text/timerMinutes, tips, nutrition, source, translations, author, dateAdded; each ingredient also stores `canonical`), `owner_id` (nullable FK users - NULL = system recipe from content/recipes), `is_public`, `is_official`, `parent_recipe_id` (twist lineage). `to_response()` in `backend/app/recipe_data.py` merges `data` with the columns.
- `backend/app/models.py` `UserRow` -> `users` - `id`, `username` (unique, lowercased), `hashed_password`, `name`, `created_at`, `is_admin`, `language` (en|fr|ar, default en; migration 0003).
- `backend/app/models.py` `AppStorageRow` -> `app_storage` - (`user_id`, `key`) PK, `value JSON`: per-user preferences only (notes_<recipeId>, recentViews, collections). Meal plans, favorites and shopping lists live in the tables below.
- `backend/app/models.py` `HouseholdRow` -> `households` - `id`, `name`, `invite_code VARCHAR(16)` unique, `size` (default servings), `diet JSON` (list of slugs from `DIET_PREFS` in `backend/app/schemas.py`), `units` (metric|us), `pantry_staples JSON` (NULL = `DEFAULT_STAPLES` from `backend/app/ingredients.py`), `prefer_budget`, `created_at`.
- `backend/app/models.py` `HouseholdMemberRow` -> `household_members` - `user_id` PK (one household per user), `household_id` FK (indexed), `role` owner|member, `joined_at`, `groceries_seen_at` (drives the "new" dot).
- `backend/app/models.py` `MealPlanEntryRow` -> `meal_plan_entries` - `id` autoinc, `household_id`, `date DATE`, `slot` breakfast|lunch|dinner|snack, `position`, `recipe_id` (nullable FK, SET NULL) or `custom_title` (Leftovers / Eating out / free text), `servings`, `added_by`, `created_at`, `updated_at`; index (household_id, date).
- `backend/app/models.py` `FavoriteRow` -> `favorites` - (`user_id`, `recipe_id`) PK, `created_at`.
- `backend/app/models.py` `ShoppingTripRow` -> `shopping_trips` - `id`, `household_id`, `start_date`/`end_date DATE`, `promoted_staples JSON`, `created_by`, `created_at`, `closed_at` (NULL = the open trip; one per household).
- `backend/app/models.py` `ShoppingMarkRow` -> `shopping_marks` - (`trip_id`, `item_key VARCHAR(191)`) PK, `purchased_qty DECIMAL(12,3)` in the part's base unit (NULL = checked without quantity), `checked_by`, `updated_at`. item_key = `<canonical name>|<unit family>` (`part_key()` in `backend/app/groceries.py`).
- `backend/app/models.py` `ShoppingHaveRow` -> `shopping_have` - (`trip_id`, `item_key VARCHAR(191)`) PK (same key as the marks), `have_qty DECIMAL(12,3) NOT NULL` in the part's base unit (no row = nothing at home; set 0/null deletes the row), `updated_by`, `updated_at` (migration 0004). Kept apart from `purchased_qty`: remaining = needed - have - purchased. Per trip, so a new shop starts empty. Pantry staple state needs no table: `shopping_trips.promoted_staples` = the staples flagged "need" for the trip (anything else in the household's staples is "have").
- `backend/app/models.py` `ShoppingExtraRow` -> `shopping_extras` - manual items per trip: `id`, `trip_id`, `name`, `quantity` (free text), `aisle`, `checked`, `checked_by`, `added_by`, `created_at`.
- `backend/app/models.py` `HouseholdIngredientAisleRow` -> `household_ingredient_aisles` - the aisle a household picked for an ingredient the dictionary does not know: `id`, `household_id` (FK cascade, indexed), `name` (canonical normalized name), `aisle`, `updated_by`, `updated_at`; unique (household_id, name). Moved on a merge by `_move_ingredient_aisles()` and deleted by `delete_household()` in `backend/app/households.py`.
- `backend/app/models.py` `HouseholdActivityRow` -> `household_activity` - `id` autoinc (the polling cursor), `household_id`, `user_id`, `type` (plan.add, plan.update, plan.remove, plan.copy, groceries.*, household.*), `payload JSON` (always has a human summary), `created_at`; index (household_id, id).

## Gotchas

- Needed grocery quantities are never stored: they are recomputed from meal_plan_entries + recipe data on every request (`trip_items()` in `backend/app/routers/groceries.py`). Only what was bought (shopping_marks) is stored, which is what makes "+N more needed" and "no longer needed" possible.
- Deleting a recipe row: call `detach_recipe()` in `backend/app/routers/recipes.py` first (plan entries keep the meal as a custom title, favorites are dropped, twists orphaned). The FKs also say SET NULL / CASCADE, but the app does it explicitly so behaviour doesn't depend on the engine.
- A recipe going private is "unlisted", not access-controlled by id: `GET /api/recipes/{id}` never checks `is_public`. Plan entries embed a recipe summary so members can see each other's private recipes in the shared plan.
- Alembic revisions in `backend/migrations/versions/`: `0001_v2_baseline` (everything else), `0002_household_ingredient_aisles`, `0003_user_language`, `0004_shopping_have` and `0005_seed_recipes` (data-only recipe snapshot, inserts with `ON CONFLICT DO NOTHING`). 0001 was hand-written and checked with `alembic upgrade head --sql` (offline PostgreSQL DDL); keep `backend/app/models.py` and new revisions in sync with it.
- `app_storage.value` still has no schema validation.
