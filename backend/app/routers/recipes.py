import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..cache import cache_get, cache_set, invalidate_recipes
from ..database import get_db
from ..models import RecipeRow, UserRow
from ..schemas import OfficialUpdateIn, RecipeIn, RecipeUpdateIn
from ..security import get_current_user, get_current_user_optional, require_admin

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


def _to_response(row: RecipeRow, db: Session) -> dict:
    """The frontend sees one flat Recipe shape - merge the JSON blob with the
    ownership/visibility/curation/lineage columns that live outside it, plus a live count of
    twists (cheap at this project's scale - one query per row, no need to denormalize it)."""
    twist_count = db.execute(
        select(func.count()).select_from(RecipeRow).where(RecipeRow.parent_recipe_id == row.id)
    ).scalar_one()
    return {
        **row.data,
        "ownerId": row.owner_id,
        "isPublic": row.is_public,
        "isOfficial": row.is_official,
        "parentRecipeId": row.parent_recipe_id,
        "twistCount": twist_count,
    }


def _visible_to(row: RecipeRow, current_user: UserRow | None) -> bool:
    return row.is_public or (current_user is not None and row.owner_id == current_user.id)


@router.get("")
def list_recipes(
    db: Session = Depends(get_db),
    current_user: UserRow | None = Depends(get_current_user_optional),
):
    """Discovery/browse catalog: root recipes only (never twists), filtered to what's
    public plus whatever the caller owns themselves."""
    # Cache every root recipe (all visibilities) once; visibility is filtered per caller
    # below, so one cache entry serves guests and accounts alike.
    recipes = cache_get("roots")
    if recipes is None:
        rows = db.execute(select(RecipeRow).where(RecipeRow.parent_recipe_id.is_(None))).scalars().all()
        recipes = [_to_response(row, db) for row in rows]
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
    return [_to_response(row, db) for row in rows]


@router.get("/{recipe_id}")
def get_recipe(recipe_id: str, db: Session = Depends(get_db)):
    """Deliberately has no visibility check: a recipe is "unlisted", not deleted, once
    private - anyone who already has the id (a favorite, a meal plan entry, a twist's
    parent link) can still resolve it directly. Only the discovery list above filters."""
    cached = cache_get(f"id:{recipe_id}")
    if cached is not None:
        return cached
    row = db.get(RecipeRow, recipe_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    response = _to_response(row, db)
    cache_set(f"id:{recipe_id}", response)
    return response


@router.get("/{recipe_id}/twists")
def list_twists(
    recipe_id: str,
    db: Session = Depends(get_db),
    current_user: UserRow | None = Depends(get_current_user_optional),
):
    rows = db.execute(select(RecipeRow).where(RecipeRow.parent_recipe_id == recipe_id)).scalars().all()
    return [_to_response(row, db) for row in rows if _visible_to(row, current_user)]


@router.post("")
def create_recipe(
    body: RecipeIn,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
):
    recipe_id = uuid.uuid4().hex[:12]
    data = {
        "id": recipe_id,
        **body.model_dump(),
        "rating": 0,
        "reviewCount": 0,
        "author": current_user.name,
        "dateAdded": date.today().isoformat(),
    }
    row = RecipeRow(
        id=recipe_id,
        data=data,
        owner_id=current_user.id,
        is_public=True,
        is_official=False,
        parent_recipe_id=None,
    )
    db.add(row)
    db.commit()
    invalidate_recipes()
    return _to_response(row, db)


@router.patch("/{recipe_id}")
def update_recipe(
    recipe_id: str,
    body: RecipeUpdateIn,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
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
        row.data = {**row.data, **updates}
    db.commit()
    invalidate_recipes()
    return _to_response(row, db)


@router.post("/{recipe_id}/twist")
def twist_recipe(
    recipe_id: str,
    db: Session = Depends(get_db),
    current_user: UserRow = Depends(get_current_user),
):
    original = db.get(RecipeRow, recipe_id)
    if original is None:
        raise HTTPException(status_code=404, detail="Recipe not found")

    new_id = uuid.uuid4().hex[:12]
    data = {
        **original.data,
        "id": new_id,
        "rating": 0,
        "reviewCount": 0,
        "author": current_user.name,
        "dateAdded": date.today().isoformat(),
    }
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
    return _to_response(row, db)


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
    return _to_response(row, db)


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

    # Twists are full independent copies, not just references - deleting the original
    # shouldn't take someone else's twist down with it, so orphan them into root recipes
    # instead of cascading the delete.
    db.execute(update(RecipeRow).where(RecipeRow.parent_recipe_id == recipe_id).values(parent_recipe_id=None))
    db.delete(row)
    db.commit()
    invalidate_recipes()
