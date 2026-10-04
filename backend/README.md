# Backend (FastAPI + MySQL)

API for the Recipe Manager frontend: a public recipe catalog any logged-in account can add
to (photos hosted on Cloudinary), username/password account auth (JWT), and a generic
key/value store per account that mirrors what used to live in `localStorage` (favorites,
ratings, collections, meal plan, shopping list, per-recipe notes). Browsing the recipe
catalog needs no account; only the account-linked features do.

## Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
copy .env.example .env         # then edit DATABASE_URL, set a real SECRET_KEY, and add
                                # your Cloudinary credentials (cloudinary.com dashboard:
                                # Cloud Name, API Key, and API Secret - the secret needs
                                # "reveal", it is not the same value as the key)
```

Start MySQL (or point `DATABASE_URL` in `.env` at an existing instance):

```bash
docker compose up -d
```

Create the tables via Alembic (schema is migration-managed, not auto-created on startup):

```bash
alembic upgrade head
```

If you already have a database created by an older version of this app (before migrations
existed), the tables already exist - stamp the baseline instead of creating it, then apply
everything after it:

```bash
alembic stamp 84e71ad0e7c3   # baseline revision - matches the schema create_all used to make
alembic upgrade head
```

Then load the seed recipes:

```bash
python -m app.seed
```

Whenever `backend/app/models.py` changes, generate a new migration and apply it:

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

The frontend (`npm start`, http://localhost:4200) expects the API at `http://localhost:8000/api`.

## Endpoints

- `POST /api/auth/register` (`username`, `password`, `name`), `POST /api/auth/login`
  (`username`, `password`) — both return a JWT plus the user; `GET /api/auth/me` (bearer
  token required) — current account. No email is collected anywhere.
- `GET /api/recipes` — discovery/browse catalog: root recipes only (never twists), public
  ones plus your own if you're logged in. `GET /api/recipes/{id}` — always resolves by id
  regardless of visibility ("unlisted", not deleted, once private) - used for direct links
  and for anything that already references the id (favorites, meal plan, a twist's parent).
  `POST /api/recipes` (bearer token required) — create a recipe, public by default; the id,
  rating, review count, author, date-added, owner, and official flag are always assigned
  server-side. `PATCH /api/recipes/{id}` (owner only) — edit any field and/or toggle
  `isPublic`. `POST /api/recipes/{id}/twist` (bearer token required) — fork a copy into your
  own book, private by default, linked back via `parentRecipeId`; twists never appear in
  `GET /api/recipes`. `GET /api/recipes/{id}/twists` — public/your-own twists of a recipe.
  `GET /api/recipes/mine` (bearer token required) — all of your own recipes, root or twist,
  any visibility. `PATCH /api/recipes/{id}/official` (admin only - see below) — curate the
  "official" badge.
- Recipes are seeded from `src/app/data/mock-recipes.ts` (re-run `python -m app.seed` after
  regenerating `app/seed_data.json` to add more); seeded recipes have no owner and are
  `isOfficial: true` by origin. There's no admin UI yet - promote a user to admin by hand:
  `UPDATE users SET is_admin = 1 WHERE username = '...'`.
- `POST /api/images` (bearer token required, multipart `file`) — uploads an image to
  Cloudinary, always converting it to AVIF, and returns `{"url": ...}`. Max 8MB;
  jpeg/png/webp/heic only.
- `GET /api/storage/{key}`, `PUT /api/storage/{key}`, `DELETE /api/storage/{key}` — generic
  JSON store, bearer token required, one row per (account, key), used by `StorageService` on
  the frontend.
- `GET /api/health` — liveness check.
