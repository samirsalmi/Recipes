"""Recipe model v2 helpers shared by the recipes router, the content importer, the demo
script and the plan/groceries routers: building the stored `data` blob (server-assigned
aisles + totalTime) and composing the flat API response."""

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .ingredients import AISLES, aisle_info, canonical_name
from .localization import canonical_for, enrich_ingredient, localized_names
from .models import RecipeRow

DEFAULT_DIET = {
    "vegetarian": False,
    "vegan": False,
    "glutenFree": False,
    "dairyFree": False,
    "containsPork": False,
    "containsAlcohol": False,
    "containsNuts": False,
}


def stamp_aisle(name: str, chosen: str | None = None, household_aisles: dict[str, str] | None = None) -> str:
    """The aisle stored on an ingredient. The dictionary wins whenever it knows the name (any of
    English/French/Arabic); otherwise the aisle the user picked in the form, then the household's
    remembered pick for that name, then the keyword guess."""
    derived, known = aisle_info(name)
    if known:
        return derived
    if chosen in AISLES:
        return chosen
    remembered = (household_aisles or {}).get(canonical_name(name))
    return remembered if remembered in AISLES else derived


def stamp_ingredients(
    ingredients: list[dict[str, Any]], household_aisles: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """Normalize ingredient dicts and assign each its aisle (see stamp_aisle)."""
    out = []
    for ing in ingredients:
        name = (ing.get("name") or "").strip()
        out.append({
            "group": ing.get("group") or None,
            "quantity": ing.get("quantity"),
            "unit": ing.get("unit") or None,
            "name": name,  # as typed, in any language
            "canonical": canonical_name(name),  # English merge name, resolved at save time
            "note": ing.get("note") or None,
            "optional": bool(ing.get("optional")),
            "aisle": stamp_aisle(name, ing.get("aisle"), household_aisles),
        })
    return out


def total_time(prep: int | None, cook: int | None) -> int | None:
    if prep is None and cook is None:
        return None
    return (prep or 0) + (cook or 0)


def build_data(
    fields: dict[str, Any],
    *,
    recipe_id: str,
    author: str | None,
    date_added: str | None = None,
    household_aisles: dict[str, str] | None = None,
) -> dict[str, Any]:
    """The full `recipes.data` blob from validated input fields (RecipeIn dump or a content
    recipe already mapped to the flat shape)."""
    data = {
        "id": recipe_id,
        "name": fields["name"],
        "description": fields.get("description") or "",
        "image": fields.get("image") or "",
        "imageCredit": fields.get("imageCredit"),
        "cuisine": fields.get("cuisine") or None,
        "region": fields.get("region") or None,
        "mealTypes": list(fields.get("mealTypes") or []),
        "servings": int(fields.get("servings") or 4),
        "prepTime": fields.get("prepTime"),
        "cookTime": fields.get("cookTime"),
        "totalTime": total_time(fields.get("prepTime"), fields.get("cookTime")),
        "difficulty": fields.get("difficulty"),
        "traditional": bool(fields.get("traditional")),
        "budget": fields.get("budget"),
        "diet": {**DEFAULT_DIET, **(fields.get("diet") or {})},
        "tags": list(fields.get("tags") or []),
        "ingredients": stamp_ingredients(fields.get("ingredients") or [], household_aisles),
        "steps": [
            {"text": s["text"], "timerMinutes": s.get("timerMinutes")} for s in (fields.get("steps") or [])
        ],
        "tips": list(fields.get("tips") or []),
        "nutrition": fields.get("nutrition"),
        "source": fields.get("source"),
        "translations": fields.get("translations"),
        "author": author,
        "dateAdded": date_added or date.today().isoformat(),
    }
    return data


def apply_update(
    data: dict[str, Any], updates: dict[str, Any], household_aisles: dict[str, str] | None = None
) -> dict[str, Any]:
    """Merge a PATCH into an existing blob, re-deriving aisles and totalTime."""
    merged = {**data, **updates}
    if "ingredients" in updates:
        merged["ingredients"] = stamp_ingredients(updates["ingredients"], household_aisles)
    if "diet" in updates:
        merged["diet"] = {**DEFAULT_DIET, **(updates["diet"] or {})}
    merged["totalTime"] = total_time(merged.get("prepTime"), merged.get("cookTime"))
    return merged


def twist_counts(db: Session, recipe_ids: list[str]) -> dict[str, int]:
    """Brute-force list endpoints need counts for many recipes at once; one grouped query
    instead of one COUNT per row (which is ~300 round-trips on a remote database)."""
    if not recipe_ids:
        return {}
    rows = db.execute(
        select(RecipeRow.parent_recipe_id, func.count())
        .where(RecipeRow.parent_recipe_id.in_(recipe_ids))
        .group_by(RecipeRow.parent_recipe_id)
    ).all()
    return {parent_id: count for parent_id, count in rows}


def to_response(
    row: RecipeRow, db: Session, *, twist_count: int | None = None
) -> dict[str, Any]:
    """One flat Recipe shape for the frontend: the data blob plus the ownership/visibility/
    curation/lineage columns and a live twist count (pass `twist_count` to avoid a query)."""
    if twist_count is None:
        twist_count = db.execute(
            select(func.count()).select_from(RecipeRow).where(RecipeRow.parent_recipe_id == row.id)
        ).scalar_one()
    data = dict(row.data)
    data["ingredients"] = [enrich_ingredient(i) for i in data.get("ingredients") or []]
    data.setdefault("translations", None)
    return {
        **data,
        "id": row.id,
        "ownerId": row.owner_id,
        "isPublic": row.is_public,
        "isOfficial": row.is_official,
        "parentRecipeId": row.parent_recipe_id,
        "twistCount": twist_count,
    }


_SUMMARY_HEAVY = {"description", "ingredients", "steps", "tips", "nutrition"}


def _summary_source(source: dict[str, Any] | None) -> dict[str, Any] | None:
    if not source:
        return None
    out = {key: source.get(key) for key in ("title", "author", "year", "url", "license") if source.get(key) is not None}
    # /credits still shows the adaptation note for recipes written for Mise; other adaptations
    # live in the detail response only (they are the largest source field).
    if source.get("license") == "Original" and source.get("adaptation"):
        out["adaptation"] = source["adaptation"]
    return out or None


def _summary_translations(translations: dict[str, Any] | None) -> dict[str, Any] | None:
    if not translations:
        return None
    out = {lang: {"name": tr["name"]} for lang, tr in translations.items() if tr and tr.get("name")}
    return out or None


def _search_text(data: dict[str, Any]) -> str:
    """Everything the catalog search needs, flattened. Replaces the full ingredient list in
    list responses (ingredients are ~half the payload)."""
    parts = [data.get("name") or "", data.get("cuisine") or "", *(data.get("tags") or [])]
    for tr in (data.get("translations") or {}).values():
        if tr and tr.get("name"):
            parts.append(tr["name"])
    for ing in data.get("ingredients") or []:
        name = ing.get("name") or ""
        if name:
            parts.append(name)
        names = localized_names(canonical_for(name, ing.get("canonical")))
        if names:
            parts.extend(names.values())
    return " | ".join(dict.fromkeys(part for part in parts if part))


def to_summary(row: RecipeRow, db: Session, *, twist_count: int | None = None) -> dict[str, Any]:
    """Card/search payload for the catalog and cookbook: everything except the heavy fields
    (full ingredients, steps, tips, description, nutrition), with a precomputed `search`
    string. Detail/cook/editor fetch the full recipe by id."""
    if twist_count is None:
        twist_count = db.execute(
            select(func.count()).select_from(RecipeRow).where(RecipeRow.parent_recipe_id == row.id)
        ).scalar_one()
    data = row.data
    out = {key: value for key, value in data.items() if key not in _SUMMARY_HEAVY}
    out["source"] = _summary_source(data.get("source"))
    out["translations"] = _summary_translations(data.get("translations"))
    out.update({
        "id": row.id,
        "ownerId": row.owner_id,
        "isPublic": row.is_public,
        "isOfficial": row.is_official,
        "parentRecipeId": row.parent_recipe_id,
        "twistCount": twist_count,
        "search": _search_text(data),
        "summary": True,
    })
    return out


def summary(row: RecipeRow | None) -> dict[str, Any] | None:
    """Small recipe card payload embedded in plan entries (so members can see each other's
    private recipes in the shared plan without a second lookup)."""
    if row is None:
        return None
    d = row.data
    return {
        "id": row.id,
        "name": d.get("name", ""),
        "image": d.get("image", ""),
        "cuisine": d.get("cuisine"),
        "totalTime": d.get("totalTime"),
        "servings": d.get("servings", 4),
        "mealTypes": d.get("mealTypes", []),
        "translations": d.get("translations"),
    }
