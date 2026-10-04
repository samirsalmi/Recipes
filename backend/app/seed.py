"""Syncs the recipes table with seed_data.json (a JSON dump of the frontend's MOCK_RECIPES),
so the catalog always matches the seed file exactly - inserts new recipes, updates changed
ones, and removes any recipe no longer in the seed file. Run `alembic upgrade head` first to
make sure the table exists. Run with: python -m app.seed
"""

import json
from pathlib import Path

from .cache import invalidate_recipes
from .database import SessionLocal
from .models import RecipeRow

SEED_FILE = Path(__file__).parent / "seed_data.json"


def seed() -> None:
    with open(SEED_FILE, encoding="utf-8") as f:
        recipes = json.load(f)
    seed_ids = {recipe["id"] for recipe in recipes}

    db = SessionLocal()
    try:
        existing = {row.id: row for row in db.query(RecipeRow).all()}
        added = updated = removed = 0
        for recipe in recipes:
            row = existing.get(recipe["id"])
            if row is None:
                # No owner - these come straight from the public-domain cookbook, so they're
                # the "official" baseline by origin, not curation.
                db.add(
                    RecipeRow(
                        id=recipe["id"],
                        data=recipe,
                        owner_id=None,
                        is_public=True,
                        is_official=True,
                        parent_recipe_id=None,
                    )
                )
                added += 1
            elif row.data != recipe:
                row.data = recipe
                updated += 1
        for row_id, row in existing.items():
            if row_id not in seed_ids:
                db.delete(row)
                removed += 1
        db.commit()
        invalidate_recipes()
        print(f"Seed sync: {added} added, {updated} updated, {removed} removed.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
