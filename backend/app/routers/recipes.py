import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..cache import cache_get, cache_set, invalidate_recipes
from ..database import get_db
from ..households import get_membership, household_aisles, log_activity
from ..import_url import ImportError_, fetch_html, parse_recipe_html
from ..ingredient_suggest import DEFAULT_LIMIT, MAX_LIMIT, exact_match, suggest_ingredients
from ..ingredients import aisle_info, canonical_name
from ..models import (
    FavoriteRow,
    HouseholdIngredientAisleRow,
    HouseholdMemberRow,
    MealPlanEntryRow,
    RecipeRow,
    UserRow,
)
from ..localization import localized_names, valid_language
from ..recipe_data import apply_update, build_data, to_response, twist_counts
from ..schemas import (
    ImportUrlIn,
    IngredientAisleIn,
    IngredientCheckIn,
    OfficialUpdateIn,
    RecipeIn,
    RecipeUpdateIn,
)
from ..security import get_current_user, get_current_user_optional, require_admin

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


def _visible_to(row: RecipeRow, current_user: UserRow | None) -> bool:
    return row.is_public or (current_user is not None and row.owner_id == current_user.id)


def detach_recipe(db: Session, recipe_id: str, name: str) -> None:
    """Before deleting a recipe row: plan entries keep the meal as a custom title, favorites
    go, twists are orphaned into roots (they are full copies). Shared with content_import."""
    db.execute(
        update(MealPlanEntryRow)
        .where(MealPlanEntryRow.recipe_id == recipe_id)
        .values(recipe_id=None, custom_title=name[:255])
    )
    db.execute(delete(FavoriteRow).where(FavoriteRow.recipe_id == recipe_id))
    db.execute(update(RecipeRow).where(RecipeRow.parent_recipe_id == recipe_id).values(parent_recipe_id=None))


@router.get("")
def list_recipes(
    db: Session = Depends(get_db),
    current_user: UserRow | None = Depends(get_current_user_optional),
):
    """Discovery/browse catalog: root recipes only (never twists), filtered to what's
    public plus whatever the caller owns themselves."""
    recipes = cache_get("roots")
    if recipes is None:
        rows = db.execute(select(RecipeRow).where(RecipeRow.parent_recipe_id.is_(None))).scalars().all()
        counts = twist_counts(db, [row.id for row in rows])
        recipes = [to_response(row, db, twist_count=counts.get(row.id, 0)) for row in rows]
        cache_set("roots", recipes)
    return [
        r for r in recipes
        if r["isPublic"] or (current_user is not None and r["ownerId"] == current_user.id)
    ]


@router.get("/mine")
def list_my_recipes(
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
):
    """All of the current user's own recipes - root or twist, public or private.
    Declared before /{recipe_id} so FastAPI doesn't match "mine" as a recipe id."""
    rows = db.execute(select(RecipeRow).where(RecipeRow.owner_id == current_user.id)).scalars().all()
    counts = twist_counts(db, [row.id for row in rows])
    return [to_response(row, db, twist_count=counts.get(row.id, 0)) for row in rows]


@router.post("/import-url")
async def import_url(body: ImportUrlIn, current_user: UserRow = Depends(get_current_user)):
    """Fetch a page server-side (SSRF-guarded, see app/import_url.py) and return a draft from
    its schema.org Recipe JSON-LD. Nothing is saved; the client prefills the form."""
    try:
        final_url, html = await run_in_threadpool(fetch_html, body.url.strip())
        return parse_recipe_html(html, final_url)
    except ImportError_ as err:
        raise HTTPException(status_code=422, detail=str(err))


@router.post("/ingredient-check")
def ingredient_check(
    body: IngredientCheckIn,
    db: Session = Depends(get_db),
    member: HouseholdMemberRow = Depends(get_membership),
):
    """For the recipe form: which of these typed ingredient names does the dictionary
    recognize (English, French or Arabic)? Unknown ones come back with the aisle the household
    chose before (`remembered`) or a keyword guess, so the form can ask "Which aisle?"."""
    remembered = household_aisles(db, member.household_id)
    items, seen = [], set()
    for name in body.names:
        canonical = canonical_name(name)
        if not canonical or name in seen:
            continue
        seen.add(name)  # one answer per typed spelling; several spellings may share a canonical name
        aisle, known = aisle_info(name)
        mine = None if known else remembered.get(canonical)
        exact = exact_match(name) if known else None
        items.append({
            "name": name,
            "canonical": canonical,
            "names": localized_names(canonical),
            "known": known,
            "aisle": mine or aisle,
            "remembered": mine is not None,
            # The typed text is itself a dictionary spelling (no typo/plural/descriptor
            # guessing), in these languages: the form may rewrite it to the reader's language.
            "exact": exact is not None,
            "languages": sorted(exact[1]) if exact else [],
        })
    return {"items": items}


@router.get("/ingredient-suggest")
def ingredient_suggest(
    q: str = Query("", max_length=80),
    lang: str = "en",
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: Session = Depends(get_db),
    member: HouseholdMemberRow = Depends(get_membership),
):
    """Type-ahead for the recipe form: ingredients matching `q` in English, French or Arabic
    (prefix first, then typos), named in `lang`, plus the household's remembered custom
    ingredients. Each item: canonical, name (in `lang`), matched (the alias typed, when it
    differs), names {en, fr, ar}, aisle, known, custom, match."""
    items = suggest_ingredients(q, valid_language(lang), household_aisles(db, member.household_id), limit)
    return {"items": items}


@router.get("/ingredient-aisles")
def list_ingredient_aisles(
    db: Session = Depends(get_db),
    member: HouseholdMemberRow = Depends(get_membership),
):
    """The aisle choices this household has made for names the dictionary does not know."""
    rows = db.execute(
        select(HouseholdIngredientAisleRow)
        .where(HouseholdIngredientAisleRow.household_id == member.household_id)
        .order_by(HouseholdIngredientAisleRow.name)
    ).scalars()
    return [{"id": r.id, "name": r.name, "aisle": r.aisle} for r in rows]


@router.put("/ingredient-aisles")
def remember_ingredient_aisle(
    body: IngredientAisleIn,
    db: Session = Depends(get_db),
    member: HouseholdMemberRow = Depends(get_membership),
):
    """Remember the household's aisle for an ingredient the dictionary does not know. Known
    names are never stored (the dictionary wins); the answer says so."""
    canonical = canonical_name(body.name)
    if not canonical:
        raise HTTPException(status_code=422, detail="Ingredient name is empty")
    dictionary_aisle, known = aisle_info(body.name)
    if known:
        return {"id": None, "name": canonical, "aisle": dictionary_aisle, "known": True, "stored": False}
    row = db.execute(
        select(HouseholdIngredientAisleRow).where(
            HouseholdIngredientAisleRow.household_id == member.household_id,
            HouseholdIngredientAisleRow.name == canonical,
        )
    ).scalar_one_or_none()
    changed = row is None or row.aisle != body.aisle
    if row is None:
        row = HouseholdIngredientAisleRow(household_id=member.household_id, name=canonical, aisle=body.aisle)
        db.add(row)
    row.aisle = body.aisle
    row.updated_by = member.user_id
    if changed:
        log_activity(db, member, "groceries.aisle", {"key": canonical, "aisle": body.aisle, "act": "set", "summary": f"filed {canonical} under {body.aisle}"})
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": canonical, "aisle": row.aisle, "known": False, "stored": True}


@router.delete("/ingredient-aisles/{aisle_id}", status_code=204)
def forget_ingredient_aisle(
    aisle_id: int,
    db: Session = Depends(get_db),
    member: HouseholdMemberRow = Depends(get_membership),
):
    row = db.get(HouseholdIngredientAisleRow, aisle_id)
    if row is None or row.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Not found")  # 404, not 403: ids cannot be probed
    db.delete(row)
    log_activity(db, member, "groceries.aisle", {"key": row.name, "act": "clear", "summary": f"cleared the aisle for {row.name}"})
    db.commit()


@router.get("/{recipe_id}")
def get_recipe(recipe_id: str, db: Session = Depends(get_db)):
    """Deliberately has no visibility check: a recipe is "unlisted", not deleted, once
    private - anyone who already has the id (a favorite, a plan entry, a twist's parent)
    can still resolve it directly. Only the discovery list above filters."""
    cached = cache_get(f"id:{recipe_id}")
    if cached is not None:
        return cached
    row = db.get(RecipeRow, recipe_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    response = to_response(row, db)
    cache_set(f"id:{recipe_id}", response)
    return response


@router.get("/{recipe_id}/twists")
def list_twists(
    recipe_id: str,
    db: Session = Depends(get_db),
    current_user: UserRow | None = Depends(get_current_user_optional),
):
    rows = db.execute(select(RecipeRow).where(RecipeRow.parent_recipe_id == recipe_id)).scalars().all()
    visible = [row for row in rows if _visible_to(row, current_user)]
    counts = twist_counts(db, [row.id for row in visible])
    return [to_response(row, db, twist_count=counts.get(row.id, 0)) for row in visible]


@router.post("")
def create_recipe(
    body: RecipeIn,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
    member: HouseholdMemberRow = Depends(get_membership),
):
    """id, author, dateAdded, owner, official flag, lineage and ingredient aisles are
    always assigned here, never taken from the client."""
    recipe_id = uuid.uuid4().hex[:12]
    fields = body.model_dump(exclude={"isPublic"})
    row = RecipeRow(
        id=recipe_id,
        data=build_data(
            fields, recipe_id=recipe_id, author=current_user.name,
            household_aisles=household_aisles(db, member.household_id),
        ),
        owner_id=current_user.id,
        is_public=body.isPublic,
        is_official=False,
        parent_recipe_id=None,
    )
    db.add(row)
    db.commit()
    invalidate_recipes()
    return to_response(row, db)


@router.patch("/{recipe_id}")
def update_recipe(
    recipe_id: str,
    body: RecipeUpdateIn,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
    member: HouseholdMemberRow = Depends(get_membership),
):
    row = db.get(RecipeRow, recipe_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if row.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can edit this recipe")

    updates = body.model_dump(exclude_unset=True)
    is_public = updates.pop("isPublic", None)
    if is_public is not None:
        row.is_public = is_public
    if updates:
        row.data = apply_update(row.data, updates, household_aisles(db, member.household_id))
    db.commit()
    invalidate_recipes()
    return to_response(row, db)


@router.post("/{recipe_id}/twist")
def twist_recipe(
    recipe_id: str,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
):
    """"Copy to my recipes & edit": a private full copy owned by the caller."""
    original = db.get(RecipeRow, recipe_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    new_id = uuid.uuid4().hex[:12]
    data = {**original.data, "id": new_id, "author": current_user.name, "dateAdded": date.today().isoformat()}
    row = RecipeRow(
        id=new_id,
        data=data,
        owner_id=current_user.id,
        is_public=False,
        is_official=False,
        parent_recipe_id=original.id,
    )
    db.add(row)
    db.commit()
    invalidate_recipes()
    return to_response(row, db)


@router.patch("/{recipe_id}/official")
def set_official(
    recipe_id: str,
    body: OfficialUpdateIn,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(require_admin),
):
    row = db.get(RecipeRow, recipe_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    row.is_official = body.isOfficial
    db.commit()
    invalidate_recipes()
    return to_response(row, db)


@router.delete("/{recipe_id}", status_code=204)
def delete_recipe(
    recipe_id: str,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
):
    row = db.get(RecipeRow, recipe_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if row.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this recipe")
    detach_recipe(db, recipe_id, row.data.get("name", "Deleted recipe"))
    db.delete(row)
    db.commit()
    invalidate_recipes()
