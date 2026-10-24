"""Household membership, invite codes, the join/merge rule, and the activity log.

Every household endpoint depends on `get_membership`, which resolves the caller's household
from the token - no endpoint ever takes a household id from the client."""

import secrets
from datetime import date

from fastapi import Depends
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import get_db
from .models import (
    HouseholdActivityRow,
    HouseholdIngredientAisleRow,
    HouseholdMemberRow,
    HouseholdRow,
    MealPlanEntryRow,
    ShoppingExtraRow,
    ShoppingHaveRow,
    ShoppingMarkRow,
    ShoppingTripRow,
    UserRow,
    utcnow,
)
from .security import get_current_user

# No 0/O, 1/I/L: readable when typed from a phone screen.
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
INVITE_LENGTH = 8


def new_invite_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(INVITE_LENGTH))
        exists = db.execute(select(HouseholdRow.id).where(HouseholdRow.invite_code == code)).first()
        if not exists:
            return code


def normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def kitchen_name(user: UserRow) -> str:
    first = (user.name or user.username).strip().split(" ")[0] or user.username
    return f"{first}'s kitchen"


def create_personal_household(db: Session, user: UserRow) -> HouseholdMemberRow:
    """A fresh one-person household with the user as owner. Caller commits."""
    household = HouseholdRow(name=kitchen_name(user), invite_code=new_invite_code(db), size=2, diet=[], units="metric")
    db.add(household)
    db.flush()
    member = HouseholdMemberRow(user_id=user.id, household_id=household.id, role="owner")
    db.add(member)
    db.flush()
    return member


def ensure_household(db: Session, user: UserRow) -> HouseholdMemberRow:
    """The user's membership, creating a personal household if they have none (accounts
    created before households existed, or any other gap). Called on login, /auth/me and by
    every household endpoint, so no account is ever left without one. Commits if it creates."""
    member = db.get(HouseholdMemberRow, user.id)
    if member is None:
        try:
            member = create_personal_household(db, user)
            db.commit()
        except IntegrityError:
            # A parallel request (the app fires several at login) created it first.
            db.rollback()
            member = db.get(HouseholdMemberRow, user.id)
    return member


def get_membership(
    current_user: UserRow = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdMemberRow:
    """FastAPI dependency: the caller's membership row (see ensure_household)."""
    return ensure_household(db, current_user)


def log_activity(db: Session, member: HouseholdMemberRow, type_: str, payload: dict | None = None) -> None:
    """Append an event other members' clients will pick up via polling. Caller commits."""
    db.add(HouseholdActivityRow(household_id=member.household_id, user_id=member.user_id, type=type_, payload=payload or {}))


def member_count(db: Session, household_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(HouseholdMemberRow).where(HouseholdMemberRow.household_id == household_id)
    ).scalar_one()


def _promote_next_owner(db: Session, household_id: int, leaving_user_id: int) -> None:
    successor = db.execute(
        select(HouseholdMemberRow)
        .where(HouseholdMemberRow.household_id == household_id, HouseholdMemberRow.user_id != leaving_user_id)
        .order_by(HouseholdMemberRow.joined_at, HouseholdMemberRow.user_id)
    ).scalars().first()
    if successor is not None and successor.role != "owner":
        successor.role = "owner"


def move_user_out(db: Session, member: HouseholdMemberRow, user: UserRow) -> HouseholdMemberRow:
    """Take `user` out of their household into a new personal one (leave / removed).
    Ownership passes to the longest-standing remaining member. Caller commits."""
    if member.role == "owner":
        _promote_next_owner(db, member.household_id, user.id)
    db.delete(member)
    db.flush()
    return create_personal_household(db, user)


def join_household(db: Session, member: HouseholdMemberRow, user: UserRow, target: HouseholdRow, today: date) -> HouseholdMemberRow:
    """Move `user` into `target`. Merge rule: if their old household had only them, its
    future meal entries (date >= today) move into the target and the old household is
    deleted (with its past entries, trips and activity). Otherwise they simply leave it
    (ownership passes on). Caller commits."""
    old_household_id = member.household_id
    alone = member_count(db, old_household_id) == 1
    moved_entries = 0
    if alone:
        moved_entries = db.execute(
            update(MealPlanEntryRow)
            .where(MealPlanEntryRow.household_id == old_household_id, MealPlanEntryRow.date >= today)
            .values(household_id=target.id)
        ).rowcount or 0
        _move_ingredient_aisles(db, old_household_id, target.id)
        member.household_id = target.id
        member.role = "member"
        member.joined_at = utcnow()
        member.groceries_seen_at = None
        db.flush()
        delete_household(db, old_household_id)
    else:
        if member.role == "owner":
            _promote_next_owner(db, old_household_id, user.id)
        member.household_id = target.id
        member.role = "member"
        member.joined_at = utcnow()
        member.groceries_seen_at = None
    db.flush()
    log_activity(db, member, "household.join", {"summary": "joined the household", "movedEntries": moved_entries})
    return member


def _move_ingredient_aisles(db: Session, from_id: int, to_id: int) -> None:
    """Aisle choices of a household that is being merged away; the target's own choices win."""
    existing = set(db.execute(
        select(HouseholdIngredientAisleRow.name).where(HouseholdIngredientAisleRow.household_id == to_id)
    ).scalars())
    for row in db.execute(
        select(HouseholdIngredientAisleRow).where(HouseholdIngredientAisleRow.household_id == from_id)
    ).scalars():
        if row.name not in existing:
            row.household_id = to_id


def household_aisles(db: Session, household_id: int) -> dict[str, str]:
    """canonical ingredient name -> aisle this household chose for names the dictionary lacks."""
    return {
        name: aisle
        for name, aisle in db.execute(
            select(HouseholdIngredientAisleRow.name, HouseholdIngredientAisleRow.aisle).where(
                HouseholdIngredientAisleRow.household_id == household_id
            )
        )
    }


def delete_household(db: Session, household_id: int) -> None:
    # Explicit deletes so this also works where FK cascades aren't enforced (SQLite tests).
    trip_ids = [t for (t,) in db.execute(select(ShoppingTripRow.id).where(ShoppingTripRow.household_id == household_id))]
    if trip_ids:
        db.execute(delete(ShoppingMarkRow).where(ShoppingMarkRow.trip_id.in_(trip_ids)))
        db.execute(delete(ShoppingHaveRow).where(ShoppingHaveRow.trip_id.in_(trip_ids)))
        db.execute(delete(ShoppingExtraRow).where(ShoppingExtraRow.trip_id.in_(trip_ids)))
        db.execute(delete(ShoppingTripRow).where(ShoppingTripRow.id.in_(trip_ids)))
    db.execute(delete(MealPlanEntryRow).where(MealPlanEntryRow.household_id == household_id))
    db.execute(delete(HouseholdActivityRow).where(HouseholdActivityRow.household_id == household_id))
    db.execute(delete(HouseholdIngredientAisleRow).where(HouseholdIngredientAisleRow.household_id == household_id))
    db.execute(delete(HouseholdRow).where(HouseholdRow.id == household_id))
