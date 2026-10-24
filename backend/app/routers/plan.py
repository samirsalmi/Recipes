import random
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..households import get_membership, log_activity
from ..models import HouseholdMemberRow, HouseholdRow, MealPlanEntryRow, RecipeRow, UserRow, iso_utc
from ..recipe_data import summary
from ..schemas import CopyWeekIn, FillIn, PlanEntryIn, PlanEntryPatch

router = APIRouter(prefix="/api/plan", tags=["plan"])

MAX_RANGE_DAYS = 62
SLOT_LABELS = {"breakfast": "breakfast", "lunch": "lunch", "dinner": "dinner", "snack": "snack"}


def _entry_out(entry: MealPlanEntryRow, recipe: RecipeRow | None, user_names: dict[int, str]) -> dict:
    return {
        "id": entry.id,
        "date": entry.date.isoformat(),
        "slot": entry.slot,
        "position": entry.position,
        "recipeId": entry.recipe_id,
        "recipe": summary(recipe),
        "customTitle": entry.custom_title,
        "servings": entry.servings,
        "addedBy": entry.added_by,
        "addedByName": user_names.get(entry.added_by) if entry.added_by else None,
        "createdAt": iso_utc(entry.created_at),
        "updatedAt": iso_utc(entry.updated_at),
    }


def _user_names(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return dict(db.execute(select(UserRow.id, UserRow.name).where(UserRow.id.in_(ids))).all())


def _out_many(db: Session, entries: list[MealPlanEntryRow]) -> list[dict]:
    recipe_ids = {e.recipe_id for e in entries if e.recipe_id}
    recipes = {}
    if recipe_ids:
        recipes = {r.id: r for r in db.execute(select(RecipeRow).where(RecipeRow.id.in_(recipe_ids))).scalars()}
    names = _user_names(db, {e.added_by for e in entries if e.added_by})
    return [_entry_out(e, recipes.get(e.recipe_id), names) for e in entries]


def _title(db: Session, entry: MealPlanEntryRow) -> str:
    if entry.recipe_id:
        recipe = db.get(RecipeRow, entry.recipe_id)
        if recipe is not None:
            return recipe.data.get("name", "a recipe")
    return entry.custom_title or "a meal"


def _when(d: date, slot: str) -> str:
    return f"{d.strftime('%a')} {d.day} {SLOT_LABELS.get(slot, slot)}"


def _get_entry(db: Session, member: HouseholdMemberRow, entry_id: int) -> MealPlanEntryRow:
    entry = db.get(MealPlanEntryRow, entry_id)
    # 404 (not 403) for another household's entry: don't confirm it exists.
    if entry is None or entry.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Plan entry not found")
    return entry


def _check_recipe(db: Session, recipe_id: str) -> RecipeRow:
    recipe = db.get(RecipeRow, recipe_id)
    if recipe is None:
        raise HTTPException(status_code=400, detail="Unknown recipe")
    return recipe


def _next_position(db: Session, household_id: int, d: date, slot: str) -> int:
    current = db.execute(
        select(func.max(MealPlanEntryRow.position)).where(
            MealPlanEntryRow.household_id == household_id, MealPlanEntryRow.date == d, MealPlanEntryRow.slot == slot
        )
    ).scalar_one()
    return 0 if current is None else current + 1


@router.get("")
def list_entries(
    start: date = Query(...),
    end: date = Query(...),
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if end < start or (end - start).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail="Invalid date range")
    entries = db.execute(
        select(MealPlanEntryRow)
        .where(
            MealPlanEntryRow.household_id == member.household_id,
            MealPlanEntryRow.date >= start,
            MealPlanEntryRow.date <= end,
        )
        .order_by(MealPlanEntryRow.date, MealPlanEntryRow.slot, MealPlanEntryRow.position, MealPlanEntryRow.id)
    ).scalars().all()
    return _out_many(db, list(entries))


@router.get("/cooked")
def cooked_stats(
    before: date = Query(..., description="Client's local today; entries before it count as cooked"),
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    """"Cooked N times" + "Recently cooked": past planned recipe entries of the household."""
    rows = db.execute(
        select(MealPlanEntryRow.recipe_id, func.count(), func.max(MealPlanEntryRow.date))
        .where(
            MealPlanEntryRow.household_id == member.household_id,
            MealPlanEntryRow.recipe_id.is_not(None),
            MealPlanEntryRow.date < before,
        )
        .group_by(MealPlanEntryRow.recipe_id)
    ).all()
    stats = [{"recipeId": rid, "count": count, "lastDate": last.isoformat()} for rid, count, last in rows]
    stats.sort(key=lambda s: s["lastDate"], reverse=True)
    return stats


@router.post("")
def create_entry(body: PlanEntryIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    if not body.recipeId and not (body.customTitle and body.customTitle.strip()):
        raise HTTPException(status_code=400, detail="A plan entry needs a recipe or a title")
    household = db.get(HouseholdRow, member.household_id)
    recipe = _check_recipe(db, body.recipeId) if body.recipeId else None
    entry = MealPlanEntryRow(
        household_id=member.household_id,
        date=body.date,
        slot=body.slot,
        position=_next_position(db, member.household_id, body.date, body.slot),
        recipe_id=body.recipeId,
        custom_title=None if recipe else body.customTitle.strip(),
        servings=body.servings or household.size,
        added_by=member.user_id,
    )
    db.add(entry)
    db.flush()
    log_activity(db, member, "plan.add", {
        "entryId": entry.id, "date": entry.date.isoformat(), "slot": entry.slot,
        "title": _title(db, entry),
        "summary": f"added {_title(db, entry)} to {_when(entry.date, entry.slot)}",
    })
    db.commit()
    return _out_many(db, [entry])[0]


@router.patch("/{entry_id}")
def update_entry(
    entry_id: int,
    body: PlanEntryPatch,
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    entry = _get_entry(db, member, entry_id)
    updates = body.model_dump(exclude_unset=True)
    moved = ("date" in updates and updates["date"] != entry.date) or ("slot" in updates and updates["slot"] != entry.slot)
    if "recipeId" in updates and updates["recipeId"]:
        _check_recipe(db, updates["recipeId"])
        entry.recipe_id = updates["recipeId"]
        entry.custom_title = None
    elif "customTitle" in updates and updates["customTitle"]:
        entry.custom_title = updates["customTitle"].strip()
        entry.recipe_id = None
    if "date" in updates and updates["date"] is not None:
        entry.date = updates["date"]
    if "slot" in updates and updates["slot"] is not None:
        entry.slot = updates["slot"]
    if "servings" in updates and updates["servings"] is not None:
        entry.servings = updates["servings"]
    if "position" in updates and updates["position"] is not None:
        entry.position = updates["position"]
    elif moved:
        entry.position = _next_position(db, member.household_id, entry.date, entry.slot)
    if "recipeId" in updates and updates["recipeId"]:
        act = "swap"
        what = f"swapped in {_title(db, entry)} on {_when(entry.date, entry.slot)}"
    elif moved:
        act = "move"
        what = f"moved {_title(db, entry)} to {_when(entry.date, entry.slot)}"
    elif "servings" in updates:
        act = "servings"
        what = f"set {_title(db, entry)} to {entry.servings} servings"
    else:
        act = "update"
        what = f"updated {_title(db, entry)}"
    log_activity(db, member, "plan.update", {
        "entryId": entry.id, "date": entry.date.isoformat(), "slot": entry.slot, "summary": what,
        "act": act, "title": _title(db, entry), "servings": entry.servings,
    })
    db.commit()
    return _out_many(db, [entry])[0]


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    entry = _get_entry(db, member, entry_id)
    log_activity(db, member, "plan.remove", {
        "entryId": entry.id, "date": entry.date.isoformat(), "slot": entry.slot,
        "title": _title(db, entry),
        "summary": f"removed {_title(db, entry)} from {_when(entry.date, entry.slot)}",
    })
    db.delete(entry)
    db.commit()


@router.post("/copy-week")
def copy_week(body: CopyWeekIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Copies every entry of the 7 days from `fromStart` onto the 7 days from `toStart`,
    added alongside whatever is already planned there."""
    if body.fromStart == body.toStart:
        raise HTTPException(status_code=400, detail="Pick a different week to copy from")
    offset = body.toStart - body.fromStart
    source = db.execute(
        select(MealPlanEntryRow)
        .where(
            MealPlanEntryRow.household_id == member.household_id,
            MealPlanEntryRow.date >= body.fromStart,
            MealPlanEntryRow.date < body.fromStart + timedelta(days=7),
        )
        .order_by(MealPlanEntryRow.date, MealPlanEntryRow.slot, MealPlanEntryRow.position)
    ).scalars().all()
    created = []
    for e in source:
        new_date = e.date + offset
        copy = MealPlanEntryRow(
            household_id=member.household_id,
            date=new_date,
            slot=e.slot,
            position=_next_position(db, member.household_id, new_date, e.slot),
            recipe_id=e.recipe_id,
            custom_title=e.custom_title,
            servings=e.servings,
            added_by=member.user_id,
        )
        db.add(copy)
        db.flush()
        created.append(copy)
    log_activity(db, member, "plan.copy", {
        "count": len(created), "toStart": body.toStart.isoformat(),
        "summary": f"copied {len(created)} meals into the week of {body.toStart.strftime('%a %d %b')}",
    })
    db.commit()
    return _out_many(db, created)


def _diet_ok(diet: dict, prefs: list[str]) -> bool:
    checks = {
        "vegetarian": lambda d: d.get("vegetarian") or d.get("vegan"),
        "vegan": lambda d: d.get("vegan"),
        "no-pork": lambda d: not d.get("containsPork"),
        "no-alcohol": lambda d: not d.get("containsAlcohol"),
        "nut-free": lambda d: not d.get("containsNuts"),
        "gluten-free": lambda d: d.get("glutenFree"),
        "dairy-free": lambda d: d.get("dairyFree") or d.get("vegan"),
    }
    return all(checks[p](diet or {}) for p in prefs if p in checks)


@router.post("/fill-suggestions")
def fill_suggestions(body: FillIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Proposals (not saved) for every empty `slot` in [start, end]: respects household diet,
    varies cuisines (or round-robins the chosen `cuisines`), prefers <= 30 min on weekdays, avoids recipes already planned in range.
    The client confirms by POSTing the ones it keeps."""
    if body.end < body.start or (body.end - body.start).days > 31:
        raise HTTPException(status_code=400, detail="Invalid date range")
    household = db.get(HouseholdRow, member.household_id)
    planned = db.execute(
        select(MealPlanEntryRow).where(
            MealPlanEntryRow.household_id == member.household_id,
            MealPlanEntryRow.date >= body.start,
            MealPlanEntryRow.date <= body.end,
        )
    ).scalars().all()
    filled = {(e.date, e.slot) for e in planned}
    used_recipes = {e.recipe_id for e in planned if e.recipe_id}

    rows = db.execute(
        select(RecipeRow).where(
            RecipeRow.parent_recipe_id.is_(None),
            or_(RecipeRow.is_public.is_(True), RecipeRow.owner_id == member.user_id),
        )
    ).scalars().all()
    slot_types = {"dinner": {"dinner", "lunch"}, "lunch": {"lunch", "dinner"}, "breakfast": {"breakfast"}, "snack": {"snack", "dessert"}}[body.slot]
    candidates = [
        r for r in rows
        if set(r.data.get("mealTypes") or []) & slot_types and _diet_ok(r.data.get("diet") or {}, household.diet or [])
    ]
    chosen = list(dict.fromkeys(c for c in (body.cuisines or []) if c))
    if chosen:
        known = {r.data.get("cuisine") for r in rows if r.data.get("cuisine")}
        unknown = [c for c in chosen if c not in known]
        if unknown:
            raise HTTPException(status_code=400, detail="Unknown cuisine")
        candidates = [r for r in candidates if r.data.get("cuisine") in chosen]
    proposed_per_cuisine: dict[str, int] = {}
    rng = random.Random()
    rng.shuffle(candidates)
    used_cuisines = {
        (r.data.get("cuisine") or "") for r in candidates if r.id in used_recipes
    }
    prefer_budget = household.prefer_budget if body.budget is None else body.budget
    budget_rank = {"low": 0, "medium": 1, "high": 2}
    proposals = []
    day = body.start
    while day <= body.end:
        if (day, body.slot) not in filled:
            weekday = day.weekday() < 5
            pool = [r for r in candidates if r.id not in used_recipes]

            def score(r: RecipeRow) -> tuple:
                total = r.data.get("totalTime")
                quick = total is not None and total <= 30
                cuisine = r.data.get("cuisine") or ""
                return (
                    # Chosen cuisines: round-robin, the least used one so far goes next (ties stay shuffled).
                    proposed_per_cuisine.get(cuisine, 0) if chosen else 0,
                    # Budget week: cheapest first (unknown budget counts as medium).
                    budget_rank.get(r.data.get("budget") or "medium", 1) if prefer_budget else 0,
                    (r.data.get("cuisine") or "") in used_cuisines,  # fresh cuisine first
                    weekday and not quick,  # quick on weekdays
                )

            if pool:
                best = min(pool, key=score)
                used_recipes.add(best.id)
                used_cuisines.add(best.data.get("cuisine") or "")
                best_cuisine = best.data.get("cuisine") or ""
                proposed_per_cuisine[best_cuisine] = proposed_per_cuisine.get(best_cuisine, 0) + 1
                proposals.append({
                    "date": day.isoformat(),
                    "slot": body.slot,
                    "recipeId": best.id,
                    "recipe": summary(best),
                    "servings": household.size,
                })
        day += timedelta(days=1)
    return proposals
