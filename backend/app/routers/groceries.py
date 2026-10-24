"""The household's current shop: the list is computed live from the plan (see
app/groceries.py); this router only stores the trip range, marks, extras and promoted staples.
Every mutation returns the whole recomputed list, so the client just replaces its state."""

from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..groceries import EPSILON, Mark, amount_parts, at_home_memory, build_list, collect_optional, compute_needed, default_marks_for_item, normalize_unit, share_text, unit_family
from ..households import get_membership, household_aisles, log_activity
from ..ingredients import DEFAULT_STAPLES, canonical_name
from ..localization import localized_names
from ..models import (
    HouseholdMemberRow,
    HouseholdRow,
    MealPlanEntryRow,
    RecipeRow,
    ShoppingExtraRow,
    ShoppingHaveRow,
    ShoppingMarkRow,
    ShoppingTripRow,
    iso_utc,
    utcnow,
)
from ..recipe_data import stamp_aisle
from ..schemas import ExtraIn, ExtraPatch, HaveIn, HouseholdStapleIn, MarkIn, NewShopIn, StapleIn, TripRangeIn, UnmarkIn

router = APIRouter(prefix="/api/groceries", tags=["groceries"])

MAX_TRIP_DAYS = 31


def default_range(today: date) -> tuple[date, date]:
    """Today through the end (Sunday) of the current plan week."""
    return today, today + timedelta(days=6 - today.weekday())


def _open_trip(db: Session, member: HouseholdMemberRow, today: date | None, create: bool = True) -> ShoppingTripRow | None:
    trip = db.execute(
        select(ShoppingTripRow)
        .where(ShoppingTripRow.household_id == member.household_id, ShoppingTripRow.closed_at.is_(None))
        .order_by(ShoppingTripRow.id.desc())
    ).scalars().first()
    if trip is None and create:
        start, end = default_range(today or date.today())
        trip = ShoppingTripRow(household_id=member.household_id, start_date=start, end_date=end, created_by=member.user_id, promoted_staples=[])
        db.add(trip)
        db.commit()
    return trip


def _require_trip(db: Session, member: HouseholdMemberRow) -> ShoppingTripRow:
    trip = _open_trip(db, member, None, create=False)
    if trip is None:
        raise HTTPException(status_code=404, detail="No open shop - load the grocery list first")
    return trip


def trip_items(db: Session, member: HouseholdMemberRow, trip: ShoppingTripRow, household: HouseholdRow) -> tuple[list[dict], int, list[dict]]:
    items, meal_count, optional, _ = _trip_state(db, member, trip, household)
    return items, meal_count, optional


def _trip_state(db: Session, member: HouseholdMemberRow, trip: ShoppingTripRow, household: HouseholdRow) -> tuple[list[dict], int, list[dict], list[dict]]:
    entries = db.execute(
        select(MealPlanEntryRow).where(
            MealPlanEntryRow.household_id == trip.household_id,
            MealPlanEntryRow.date >= trip.start_date,
            MealPlanEntryRow.date <= trip.end_date,
        )
    ).scalars().all()
    recipe_ids = {e.recipe_id for e in entries if e.recipe_id}
    recipes = {}
    if recipe_ids:
        recipes = {r.id: r.data for r in db.execute(select(RecipeRow).where(RecipeRow.id.in_(recipe_ids))).scalars()}
    entry_dicts = [
        {"id": e.id, "date": e.date, "slot": e.slot, "recipe_id": e.recipe_id, "servings": e.servings,
         "added_by": e.added_by, "created_at": e.created_at, "updated_at": e.updated_at}
        for e in entries
    ]
    aisles = household_aisles(db, trip.household_id)
    needed = compute_needed(entry_dicts, recipes, aisles)
    optional = collect_optional(entry_dicts, recipes)
    marks = {
        m.item_key: Mark(purchased=float(m.purchased_qty) if m.purchased_qty is not None else None, checked_by=m.checked_by)
        for m in db.execute(select(ShoppingMarkRow).where(ShoppingMarkRow.trip_id == trip.id)).scalars()
    }
    have = {
        h.item_key: float(h.have_qty)
        for h in db.execute(select(ShoppingHaveRow).where(ShoppingHaveRow.trip_id == trip.id)).scalars()
    }
    staples = household.pantry_staples if household.pantry_staples is not None else DEFAULT_STAPLES
    items = build_list(
        needed,
        marks,
        staples=staples,
        promoted=trip.promoted_staples or [],
        unit_system=household.units,
        seen_at=member.groceries_seen_at,
        viewer_id=member.user_id,
        household_aisles=aisles,
        have=have,
    )
    meal_count = sum(1 for e in entries if e.recipe_id or e.custom_title)
    return items, meal_count, optional, at_home_memory(needed, have, household.units)


def _extras(db: Session, trip: ShoppingTripRow) -> list[dict]:
    rows = db.execute(select(ShoppingExtraRow).where(ShoppingExtraRow.trip_id == trip.id).order_by(ShoppingExtraRow.id)).scalars()
    return [
        {"id": x.id, "name": x.name, "names": localized_names(canonical_name(x.name)), "quantity": x.quantity, "aisle": x.aisle, "checked": x.checked,
         "checkedBy": x.checked_by, "addedBy": x.added_by}
        for x in rows
    ]


def _payload(db: Session, member: HouseholdMemberRow, trip: ShoppingTripRow) -> dict:
    household = db.get(HouseholdRow, member.household_id)
    items, meal_count, optional, at_home = _trip_state(db, member, trip, household)
    extras = _extras(db, trip)
    counted = [i for i in items if i["state"] != "no_longer_needed" and not i["staple"]]
    done = sum(1 for i in counted if i["state"] in ("in_cart", "covered")) + sum(1 for x in extras if x["checked"])
    return {
        "trip": {
            "id": trip.id,
            "start": trip.start_date.isoformat(),
            "end": trip.end_date.isoformat(),
            "createdAt": iso_utc(trip.created_at),
            "mealCount": meal_count,
        },
        "items": items,
        "extras": extras,
        # Optional add-ins of planned recipes, not counted as needed; the UI offers each as a
        # one-tap manual extra (POST /extras).
        "optionalExtras": optional,
        # Amounts the household has at home that match nothing the plan needs right now.
        "atHome": at_home,
        "progress": {"done": done, "total": len(counted) + len(extras)},
        "units": household.units,
    }


def _check_range(start: date, end: date) -> None:
    if end < start or (end - start).days > MAX_TRIP_DAYS:
        raise HTTPException(status_code=400, detail="Invalid date range")


@router.get("")
def get_groceries(
    today: date | None = Query(default=None, description="Client's local date, used for the default range"),
    member: HouseholdMemberRow = Depends(get_membership),
    db: Session = Depends(get_db),
):
    trip = _open_trip(db, member, today)
    return _payload(db, member, trip)


@router.put("/range")
def set_range(body: TripRangeIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    _check_range(body.start, body.end)
    trip = _open_trip(db, member, body.start)
    trip.start_date, trip.end_date = body.start, body.end
    log_activity(db, member, "groceries.range", {
        "start": body.start.isoformat(), "end": body.end.isoformat(),
        "summary": f"changed the shop to {body.start.strftime('%a %d')} - {body.end.strftime('%a %d %b')}",
    })
    db.commit()
    return _payload(db, member, trip)


def _find_item(db: Session, member: HouseholdMemberRow, trip: ShoppingTripRow, key: str) -> dict:
    household = db.get(HouseholdRow, member.household_id)
    items, _, _ = trip_items(db, member, trip, household)
    for item in items:
        if item["key"] == key:
            return item
    raise HTTPException(status_code=404, detail="Item not on the list")


@router.post("/mark")
def mark(body: MarkIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Check an item off. Without `quantities`, every part is marked bought at its current
    needed amount; with them, only the given parts, at the given base-unit amounts."""
    trip = _require_trip(db, member)
    item = _find_item(db, member, trip, body.key)
    part_keys = {p["key"]: p for p in item["parts"]}
    if body.quantities is None:
        quantities = default_marks_for_item(item)
    else:
        unknown = set(body.quantities) - set(part_keys)
        if unknown:
            raise HTTPException(status_code=400, detail="Unknown part for this item")
        quantities = body.quantities
    for key, qty in quantities.items():
        row = db.get(ShoppingMarkRow, (trip.id, key))
        value = Decimal(str(round(qty, 3))) if qty is not None else None
        if row is None:
            db.add(ShoppingMarkRow(trip_id=trip.id, item_key=key, purchased_qty=value, checked_by=member.user_id))
        else:
            row.purchased_qty = value
            row.checked_by = member.user_id
            row.updated_at = utcnow()
    log_activity(db, member, "groceries.mark", {"key": body.key, "names": localized_names(body.key), "name": item["name"], "summary": f"got {item['name']}"})
    db.commit()
    return _payload(db, member, trip)


@router.post("/unmark")
def unmark(body: UnmarkIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Uncheck an item (or dismiss a "no longer needed" one): drops all its part marks."""
    trip = _require_trip(db, member)
    db.execute(
        delete(ShoppingMarkRow).where(ShoppingMarkRow.trip_id == trip.id, ShoppingMarkRow.item_key.startswith(f"{body.key}|", autoescape=True))
    )
    # Marks stored under pre-fuzzy keys also count as checked, so uncheck those too.
    try:
        legacy_keys = [k for p in _find_item(db, member, trip, body.key)["parts"] for k in p.get("legacyKeys", [])]
    except HTTPException:
        legacy_keys = []
    if legacy_keys:
        db.execute(delete(ShoppingMarkRow).where(ShoppingMarkRow.trip_id == trip.id, ShoppingMarkRow.item_key.in_(legacy_keys)))
    log_activity(db, member, "groceries.unmark", {"key": body.key, "names": localized_names(body.key), "summary": f"unchecked {body.key}"})
    db.commit()
    return _payload(db, member, trip)


@router.put("/have")
def set_have(body: HaveIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """"I have N at home" for one part of an item (kept apart from what was bought). Replaces the
    previous amount; null or 0 clears it (also allowed for amounts that match nothing needed
    any more). The amount is in `unit` and must be in the part's unit family."""
    trip = _require_trip(db, member)
    name, _, family = body.key.partition("|")
    quantity = body.quantity if body.quantity and body.quantity > EPSILON else None
    row = db.get(ShoppingHaveRow, (trip.id, body.key))
    if quantity is None:
        if row is not None:
            db.delete(row)
            log_activity(db, member, "groceries.have", {"key": name, "names": localized_names(name), "cleared": True, "summary": f"cleared what is at home of {name}"})
            db.commit()
        return _payload(db, member, trip)

    item = _find_item(db, member, trip, name)  # 404: not on the list
    part = next((p for p in item["parts"] if p["key"] == body.key), None)
    if part is None:
        raise HTTPException(status_code=404, detail="Item not on the list")
    if part["needed"] is None:
        raise HTTPException(status_code=400, detail="This item has no quantity to count")
    if body.unit:
        unit_fam, _base, factor = unit_family(body.unit, quantity)
        if unit_fam != family:
            raise HTTPException(status_code=400, detail="Unit does not match this item")
        base_qty = quantity * factor
    else:
        base_qty = quantity
    value = Decimal(str(round(base_qty, 3)))
    if row is None:
        db.add(ShoppingHaveRow(trip_id=trip.id, item_key=body.key, have_qty=value, updated_by=member.user_id))
    else:
        row.have_qty = value
        row.updated_by = member.user_id
        row.updated_at = utcnow()
    log_activity(db, member, "groceries.have", {
        "key": name, "names": localized_names(name), "name": item["name"], "cleared": False,
        "amount": amount_parts(base_qty, family, [normalize_unit(body.unit)] if body.unit else [], "metric"),
        "summary": f"has {item['name']} at home",
    })
    db.commit()
    return _payload(db, member, trip)


@router.post("/staples")
def promote_staple(body: StapleIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """"I need it": move a pantry staple from the collapsed section onto the real list."""
    trip = _require_trip(db, member)
    name = canonical_name(body.name)
    promoted = set(trip.promoted_staples or [])
    promoted.add(name) if body.promoted else promoted.discard(name)
    trip.promoted_staples = sorted(promoted)
    log_activity(db, member, "groceries.staple", {"key": name, "names": localized_names(name), "promoted": bool(body.promoted), "summary": f"needs {name}" if body.promoted else f"has {name}"})
    db.commit()
    return _payload(db, member, trip)


@router.post("/household-staples")
def set_household_staple(body: HouseholdStapleIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Add an ingredient to (or remove it from) the household's staples, from a grocery row.
    Stored by canonical name like the Household page editor. Idempotent. An item added while the
    plan still needs it stays on this shop's list (promoted = "needed"), so it never vanishes
    silently; removing also clears this shop's promotion. Returns the recomputed list."""
    trip = _require_trip(db, member)
    household = db.get(HouseholdRow, member.household_id)
    name = canonical_name(body.name)
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    current = set(household.pantry_staples if household.pantry_staples is not None else DEFAULT_STAPLES)
    promoted = set(trip.promoted_staples or [])
    changed = False
    if body.staple:
        if name not in current:
            household.pantry_staples = sorted(current | {name})
            changed = True
        if body.promoted is not False:
            on_list = any(i["key"] == name and i["state"] != "no_longer_needed" for i in trip_items(db, member, trip, household)[0])
            if on_list and name not in promoted:
                promoted.add(name)
                changed = True
        elif name in promoted:
            promoted.discard(name)
            changed = True
    else:
        if name in current:
            household.pantry_staples = sorted(current - {name})
            changed = True
        if name in promoted:
            promoted.discard(name)
            changed = True
    if changed:
        trip.promoted_staples = sorted(promoted)
        log_activity(db, member, "household.staples", {
            "key": name, "names": localized_names(name), "added": body.staple,
            "summary": f"added {name} to the staples" if body.staple else f"removed {name} from the staples",
        })
        db.commit()
    return _payload(db, member, trip)


@router.post("/extras")
def add_extra(body: ExtraIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    trip = _require_trip(db, member)
    name = body.name.strip()
    db.add(ShoppingExtraRow(trip_id=trip.id, name=name, quantity=(body.quantity or None), aisle=stamp_aisle(name, None, household_aisles(db, member.household_id)), added_by=member.user_id))
    log_activity(db, member, "groceries.extra", {"act": "add", "name": name, "names": localized_names(canonical_name(name)), "summary": f"added {name} to the list"})
    db.commit()
    return _payload(db, member, trip)


def _get_extra(db: Session, trip: ShoppingTripRow, extra_id: int) -> ShoppingExtraRow:
    extra = db.get(ShoppingExtraRow, extra_id)
    if extra is None or extra.trip_id != trip.id:
        raise HTTPException(status_code=404, detail="Item not found")
    return extra


@router.patch("/extras/{extra_id}")
def update_extra(extra_id: int, body: ExtraPatch, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    trip = _require_trip(db, member)
    extra = _get_extra(db, trip, extra_id)
    updates = body.model_dump(exclude_unset=True)
    if updates.get("name"):
        extra.name = updates["name"].strip()
        extra.aisle = stamp_aisle(extra.name, None, household_aisles(db, member.household_id))
    if "quantity" in updates:
        extra.quantity = updates["quantity"] or None
    if "checked" in updates and updates["checked"] is not None:
        extra.checked = updates["checked"]
        extra.checked_by = member.user_id if extra.checked else None
    log_activity(db, member, "groceries.extra", {"act": "got" if extra.checked else "update", "name": extra.name, "names": localized_names(canonical_name(extra.name)), "summary": f"{'got' if extra.checked else 'updated'} {extra.name}"})
    db.commit()
    return _payload(db, member, trip)


@router.delete("/extras/{extra_id}")
def delete_extra(extra_id: int, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    trip = _require_trip(db, member)
    extra = _get_extra(db, trip, extra_id)
    log_activity(db, member, "groceries.extra", {"act": "remove", "name": extra.name, "names": localized_names(canonical_name(extra.name)), "summary": f"removed {extra.name} from the list"})
    db.delete(extra)
    db.commit()
    return _payload(db, member, trip)


@router.post("/new-shop")
def new_shop(body: NewShopIn, member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """Close the current trip (its marks stay with it) and open a fresh one."""
    _check_range(body.start, body.end)
    current = _open_trip(db, member, None, create=False)
    if current is not None:
        current.closed_at = utcnow()
    trip = ShoppingTripRow(household_id=member.household_id, start_date=body.start, end_date=body.end, created_by=member.user_id, promoted_staples=[])
    db.add(trip)
    log_activity(db, member, "groceries.new_shop", {"summary": "started a new shop"})
    db.commit()
    return _payload(db, member, trip)


@router.get("/share-text")
def get_share_text(member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    trip = _require_trip(db, member)
    data = _payload(db, member, trip)
    title = f"Groceries {trip.start_date.strftime('%a %d')} - {trip.end_date.strftime('%a %d %b')}"
    return {"text": share_text(data["items"], data["extras"], title)}


@router.post("/seen", status_code=204)
def mark_seen(member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    """The caller just looked at the list: clears their "new" dots."""
    member.groceries_seen_at = utcnow()
    db.commit()


@router.get("/history")
def trip_history(member: HouseholdMemberRow = Depends(get_membership), db: Session = Depends(get_db)):
    rows = db.execute(
        select(ShoppingTripRow, func.count(ShoppingMarkRow.item_key))
        .outerjoin(ShoppingMarkRow, ShoppingMarkRow.trip_id == ShoppingTripRow.id)
        .where(ShoppingTripRow.household_id == member.household_id, ShoppingTripRow.closed_at.is_not(None))
        .group_by(ShoppingTripRow.id)
        .order_by(ShoppingTripRow.id.desc())
        .limit(10)
    ).all()
    return [
        {"id": t.id, "start": t.start_date.isoformat(), "end": t.end_date.isoformat(),
         "closedAt": iso_utc(t.closed_at), "marked": count}
        for t, count in rows
    ]
