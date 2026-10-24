# Backend (FastAPI + PostgreSQL)

API for Mise, the shared kitchen planner: username/password accounts (JWT), households that
share a meal plan and a live grocery list, a recipe catalog (curated recipes imported from
`content/recipes/*.json` plus user recipes), Cloudinary photo hosting, and URL import.

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows; `source .venv/bin/activate` on macOS/Linux
pip install -r requirements-dev.txt   # app deps + pytest/httpx
copy .env.example .env           # then set DATABASE_URL, SECRET_KEY and the Cloudinary keys
```

### Database (PostgreSQL 18)

The app expects PostgreSQL; locally use a throwaway cluster owned by you on **port 5434** (`initdb -D C:/Users/you/pgdata-recipes --auth=scram-sha-256 --pwfile=...`, then `pg_ctl start -D ... -o "-p 5434"`). Do not reuse another app's server on 5433. Create the
database and an app role in one command (needs a superuser login, e.g. `postgres`):

```bash
python scripts/create_db.py --admin-url postgresql://postgres:ADMIN_PASS@localhost:5434/postgres \
    --password APP_PASS --with-test-db
```

It creates role `recipe_user`, database `recipe_manager` (and `recipe_manager_test` with
`--with-test-db`) and prints the `DATABASE_URL` for `.env`:

```
DATABASE_URL=postgresql+psycopg://recipe_user:APP_PASS@localhost:5434/recipe_manager
```

Equivalent psql commands, if you prefer:

```sql
CREATE ROLE recipe_user LOGIN PASSWORD 'APP_PASS';
CREATE DATABASE recipe_manager OWNER recipe_user ENCODING 'UTF8' TEMPLATE template0;
```

No local PostgreSQL? `docker compose up -d` starts one on port 5434 (stop the dev cluster first, same port) (user/password
`recipe_user`/`recipe_pass`) plus Redis; point `DATABASE_URL` at `localhost:5434`.

Create the schema (Alembic; never `create_all`):

```bash
alembic upgrade head
```

### Recipes and demo data

```bash
python -m app.content_import            # validate content/recipes/*.json, upload photos, sync
python -m app.content_import --dry-run  # validate only
python -m app.demo                      # alex.demo + amina.demo (password demo-pass-1), one household
```

The importer uploads each photo once to Cloudinary as AVIF (`recipes/<id>`, width capped at
2000 px) and records it in `content/images.lock.json`, so re-runs only upload new or changed
photos. It only ever inserts/updates/deletes **system** recipes (`owner_id IS NULL`);
user-created recipes are never touched. Photo order of attempts: Cloudinary fetches the
original itself; if Wikimedia rate-limits that (429), the importer asks the Commons API for
the official 1920 px thumbnail (thumb.wikimedia.org, not rate-limited) and uploads it; the
last resort is downloading the original locally (paced, with retries). If everything fails
it stops with a clear error and nothing is written to the database - run it again later.

### Run

```bash
uvicorn app.main:app --reload --port 8000
```

The frontend (`npm start`, http://localhost:4200) expects the API at
`environment.apiBaseUrl` (`src/environments/environment.ts`).

### Tests

```bash
python -m pytest                       # in-memory SQLite, no server needed
# against PostgreSQL (the database name must contain "test"; every test drops all tables):
set TEST_DATABASE_URL=postgresql+psycopg://recipe_user:APP_PASS@localhost:5434/recipe_manager_test
python -m pytest
```

## Changing the schema

Edit `app/models.py`, then:

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

The history starts at `0001_v2_baseline` (the MySQL history was squashed when the project
moved to PostgreSQL). Use JSONB/TIMESTAMPTZ via the `JSONType`/`TS` aliases in `models.py`.

## Endpoints (all under /api)

- Auth: `POST /auth/register` (creates a personal household), `POST /auth/login`, `GET /auth/me`.
- Recipes: `GET /recipes` (discovery: public + your own, no twists), `GET /recipes/mine`,
  `GET /recipes/{id}` (no visibility check), `POST /recipes` (only name + ingredients
  required), `PATCH /recipes/{id}`, `DELETE /recipes/{id}` (owner), `POST /recipes/{id}/twist`
  ("copy to my recipes"), `POST /recipes/import-url` (schema.org JSON-LD draft, SSRF-guarded),
  `GET /recipes/{id}/twists`, `PATCH /recipes/{id}/official` (admin).
- Images: `POST /images` (Cloudinary, stored as AVIF), `GET /images/proxy` (dev helper).
- Household: `GET/PATCH /household`, `POST /household/invite-code`, `GET /household/invite/{code}`,
  `POST /household/join`, `POST /household/leave`, `DELETE /household/members/{user_id}`,
  `GET /household/activity?since=<cursor>`.
- Plan: `GET /plan?start&end`, `GET /plan/cooked?before`, `POST /plan`, `PATCH /plan/{id}`,
  `DELETE /plan/{id}`, `POST /plan/copy-week`, `POST /plan/fill-suggestions`.
- Favorites: `GET /favorites` (whole household), `PUT/DELETE /favorites/{recipe_id}`.
- Groceries: `GET /groceries?today`, `PUT /groceries/range`, `POST /groceries/mark`,
  `POST /groceries/unmark`, `POST /groceries/staples`, `POST/PATCH/DELETE /groceries/extras`,
  `POST /groceries/new-shop`, `GET /groceries/share-text`, `POST /groceries/seen`,
  `GET /groceries/history`.
- Storage: `GET/PUT/DELETE /storage/{key}` (small per-user preferences: notes, recent views, collections).

Every household/plan/grocery endpoint resolves the household from the token; no endpoint
takes a household id from the client.
