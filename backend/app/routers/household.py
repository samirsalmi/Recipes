from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..households import (
    get_membership,
    join_household,
    log_activity,
    member_count,
    move_user_out,
    new_invite_code,
    normalize_code,
)
from ..ingredients import DEFAULT_STAPLES, canonical_name
from ..localization import localized_names
from ..models import HouseholdActivityRow, HouseholdMemberRow, HouseholdRow, UserRow, iso_utc
from ..schemas import HouseholdUpdateIn, JoinIn
from ..security import get_current_user

router = APIRouter(prefix="/api/household", tags=["household"])

ACTIVITY_PAGE = 50


def household_out(db: Session, household: HouseholdRow, me: HouseholdMemberRow) -> dict:
    rows = db.execute(
        select(HouseholdMemberRow, UserRow)
        .join(UserRow, UserRow.id == HouseholdMemberRow.user_id)
        .where(HouseholdMemberRow.household_id == household.id)
        .order_by(HouseholdMemberRow.joined_at, HouseholdMemberRow.user_id)
    ).all()
    staples = household.pantry_staples if household.pantry_staples is not None else DEFAULT_STAPLES
    return {
        "id": household.id,
        "name": household.name,
        "inviteCode": household.invite_code,
        "size": household.size,
        "diet": household.diet or [],
        "units": household.units,
        "pantryStaples": household.pantry_staples if household.pantry_staples is not None else DEFAULT_STAPLES,
        "defaultPantryStaples": DEFAULT_STAPLES,
        # canonical staple -> {en, fr, ar} (null when the dictionary does not know it)
        "stapleNames": {s: localized_names(s) for s in {*staples, *DEFAULT_STAPLES}},
        "preferBudget": bool(household.prefer_budget),
        "members": [
            {"userId": u.id, "name": u.name, "username": u.username, "role": m.role, "joinedAt": iso_utc(m.joined_at)}
            for m, u in rows
        ],
        "myRole": me.role,
        "myUserId": me.user_id,
    }


@router.get("")
def get_household(member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    return household_out(db, db.get(HouseholdRow, member.household_id), member)


@router.patch("")
def update_household(
    body: HouseholdUpdateIn,
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    household = db.get(HouseholdRow, member.household_id)
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates:
        household.name = updates["name"]
    if "size" in updates:
        household.size = updates["size"]
    if "diet" in updates:
        household.diet = updates["diet"] or []
    if "units" in updates:
        household.units = updates["units"]
    if "preferBudget" in updates and updates["preferBudget"] is not None:
        household.prefer_budget = updates["preferBudget"]
    if "pantryStaples" in updates:
        staples = updates["pantryStaples"]
        household.pantry_staples = None if staples is None else sorted({canonical_name(s) for s in staples if s.strip()})
    log_activity(db, member, "household.settings", {"summary": "updated household settings", "fields": sorted(updates)})
    db.commit()
    return household_out(db, household, member)


@router.post("/invite-code")
def regenerate_invite_code(member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can regenerate the invite code")
    household = db.get(HouseholdRow, member.household_id)
    household.invite_code = new_invite_code(db)
    db.commit()
    return household_out(db, household, member)


@router.get("/invite/{code}")
def preview_invite(code: str, db: Session = Depends(get_db), _user: UserRow = Depends(get_current_user)):
    """What the /join/:code page shows before the user confirms."""
    household = db.execute(select(HouseholdRow).where(HouseholdRow.invite_code == normalize_code(code))).scalar_one_or_none()
    if household is None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    names = db.execute(
        select(UserRow.name)
        .join(HouseholdMemberRow, HouseholdMemberRow.user_id == UserRow.id)
        .where(HouseholdMemberRow.household_id == household.id)
    ).scalars().all()
    return {"name": household.name, "memberNames": list(names)}


@router.post("/join")
def join(
    body: JoinIn,
    member: HouseholdMemberRow = Depends(get_membership),
    user: UserRow = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target = db.execute(select(HouseholdRow).where(HouseholdRow.invite_code == normalize_code(body.code))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=404, detail="Invite code not found")
    if target.id == member.household_id:
        raise HTTPException(status_code=400, detail="You are already in this household")
    member = join_household(db, member, user, target, body.today or date.today())
    db.commit()
    return household_out(db, target, member)


@router.post("/leave")
def leave(
    member: HouseholdMemberRow = Depends(get_membership),
    user: UserRow = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if member_count(db, member.household_id) == 1:
        raise HTTPException(status_code=400, detail="You're the only member - there is nothing to leave")
    log_activity(db, member, "household.leave", {"summary": "left the household"})
    new_member = move_user_out(db, member, user)
    db.commit()
    return household_out(db, db.get(HouseholdRow, new_member.household_id), new_member)


@router.delete("/members/{user_id}")
def remove_member(
    user_id: int,
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can remove members")
    if user_id == member.user_id:
        raise HTTPException(status_code=400, detail="Use leave to remove yourself")
    target = db.get(HouseholdMemberRow, user_id)
    if target is None or target.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Member not found")
    target_user = db.get(UserRow, user_id)
    log_activity(db, member, "household.remove_member", {"summary": f"removed {target_user.name}", "userId": user_id, "name": target_user.name})
    move_user_out(db, target, target_user)
    db.commit()
    return household_out(db, db.get(HouseholdRow, member.household_id), member)


@router.get("/activity")
def activity(
    since: int | None = Query(default=None, ge=0),
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    """Events after the `since` cursor (oldest first). Without a cursor: the latest page,
    so the Household feed can render and the client learns its starting cursor."""
    query = (
        select(HouseholdActivityRow, UserRow.name)
        .outerjoin(UserRow, UserRow.id == HouseholdActivityRow.user_id)
        .where(HouseholdActivityRow.household_id == member.household_id)
    )
    if since is None:
        rows = db.execute(query.order_by(HouseholdActivityRow.id.desc()).limit(ACTIVITY_PAGE)).all()[::-1]
    else:
        rows = db.execute(
            query.where(HouseholdActivityRow.id > since).order_by(HouseholdActivityRow.id).limit(ACTIVITY_PAGE)
        ).all()
    events = [
        {
            "id": a.id,
            "type": a.type,
            "payload": a.payload or {},
            "userId": a.user_id,
            "userName": name,
            "createdAt": iso_utc(a.created_at),
        }
        for a, name in rows
    ]
    cursor = events[-1]["id"] if events else (since or 0)
    return {"events": events, "cursor": cursor}
