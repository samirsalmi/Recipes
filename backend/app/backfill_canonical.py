"""Backfill (python -m app.backfill_canonical): store each recipe ingredient's English `canonical` name next to the typed `name`
(and an empty `translations` slot). Idempotent; `python -m app.backfill_canonical` runs it on
the configured database. New and edited recipes get this at save time (recipe_data)."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ingredients import canonical_name


def backfill_data(data: dict[str, Any]) -> dict[str, Any] | None:
    """The updated blob, or None when nothing changes."""
    changed = False
    ingredients = []
    for ing in data.get("ingredients") or []:
        canonical = canonical_name(ing.get("name") or "")
        if ing.get("canonical") != canonical:
            ing = {**ing, "canonical": canonical}
            changed = True
        ingredients.append(ing)
    if "translations" not in data:
        changed = True
    if not changed:
        return None
    return {**data, "ingredients": ingredients, "translations": data.get("translations")}


def backfill_canonical(db: Session) -> int:
    from .models import RecipeRow

    count = 0
    for row in db.execute(select(RecipeRow)).scalars():
        updated = backfill_data(row.data)
        if updated is not None:
            row.data = updated
            count += 1
    db.commit()
    return count


def main() -> None:
    from .database import SessionLocal

    with SessionLocal() as db:
        print(f"backfilled {backfill_canonical(db)} recipes")


if __name__ == "__main__":
    main()
