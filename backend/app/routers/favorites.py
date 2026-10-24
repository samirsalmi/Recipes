from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..households import get_membership
from ..models import FavoriteRow, HouseholdMemberRow, RecipeRow, UserRow, iso_utc

router = APIRouter(prefix="/api/favorites", tags=["favorites"])


@router.get("")
def list_favorites(member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Favorites of every member of the caller's household (the caller's own included), so
    the planner can offer "Favorites (yours + household)"."""
    rows = db.execute(
        select(FavoriteRow, UserRow.name)
        .join(UserRow, UserRow.id == FavoriteRow.user_id)
        .join(HouseholdMemberRow, HouseholdMemberRow.user_id == FavoriteRow.user_id)
        .where(HouseholdMemberRow.household_id == member.household_id)
        .order_by(FavoriteRow.created_at.desc())
    ).all()
    return [
        {"recipeId": f.recipe_id, "userId": f.user_id, "userName": name, "createdAt": iso_utc(f.created_at)}
        for f, name in rows
    ]


@router.put("/{recipe_id}", status_code=204)
def add_favorite(recipe_id: str, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    if db.get(RecipeRow, recipe_id) is None:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if db.get(FavoriteRow, (member.user_id, recipe_id)) is None:
        db.add(FavoriteRow(user_id=member.user_id, recipe_id=recipe_id))
        db.commit()


@router.delete("/{recipe_id}", status_code=204)
def remove_favorite(recipe_id: str, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    row = db.get(FavoriteRow, (member.user_id, recipe_id))
    if row is not None:
        db.delete(row)
        db.commit()
