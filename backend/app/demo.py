"""Demo data: two accounts sharing one household, the current week planned, and a partly
checked shop, so the collaboration can be shown straight away.

    python -m app.demo                    # uses today's date
    python -m app.demo --today 2026-10-21

Accounts (password for both: demo-pass-1):  alex.demo (owner)  and  amina.demo (member).
Safe to re-run: the two demo accounts and their household are deleted and recreated.
Needs recipes in the DB first (python -m app.content_import).
"""

import argparse
import random
import sys
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select

from .database import SessionLocal
from .households import delete_household, create_personal_household, join_household, log_activity, member_count
from .models import (
    AppStorageRow,
    FavoriteRow,
    HouseholdMemberRow,
    HouseholdRow,
    RecipeRow,
    ShoppingExtraRow,
    ShoppingMarkRow,
    ShoppingTripRow,
    MealPlanEntryRow,
    UserRow,
)
from .security import hash_password

PASSWORD = "demo-pass-1"
ACCOUNTS = [("alex.demo", "Alex"), ("amina.demo", "Amina")]


def _remove_demo_users(db) -> None:
    for username, _ in ACCOUNTS:
        user = db.execute(select(UserRow).where(UserRow.username == username)).scalar_one_or_none()
        if user is None:
            continue
        member = db.get(HouseholdMemberRow, user.id)
        if member is not None:
            household_id = member.household_id
            db.delete(member)
            db.flush()
            if member_count(db, household_id) == 0:
                delete_household(db, household_id)
        db.execute(delete(FavoriteRow).where(FavoriteRow.user_id == user.id))
        db.execute(delete(AppStorageRow).where(AppStorageRow.user_id == user.id))
        db.delete(user)
        db.flush()


def _pick(recipes: list[RecipeRow], meal_types: set[str], used: set[str], rng: random.Random) -> RecipeRow | None:
    pool = [r for r in recipes if set(r.data.get("mealTypes") or []) & meal_types and r.id not in used]
    if not pool:
        pool = [r for r in recipes if set(r.data.get("mealTypes") or []) & meal_types]
    if not pool:
        return None
    choice = rng.choice(pool)
    used.add(choice.id)
    return choice


def run(today: date) -> None:
    rng = random.Random(42)
    db = SessionLocal()
    try:
        recipes = db.execute(
            select(RecipeRow).where(RecipeRow.owner_id.is_(None), RecipeRow.parent_recipe_id.is_(None))
        ).scalars().all()
        if not recipes:
            print("No system recipes found - run `python -m app.content_import` first.", file=sys.stderr)
            sys.exit(1)

        _remove_demo_users(db)
        users = []
        for username, name in ACCOUNTS:
            user = UserRow(username=username, name=name, hashed_password=hash_password(PASSWORD))
            db.add(user)
            db.flush()
            users.append((user, create_personal_household(db, user)))
        (alex, alex_member), (amina, amina_member) = users
        household = db.get(HouseholdRow, alex_member.household_id)
        household.name = "Alex & Amina's kitchen"
        household.size = 2
        amina_member = join_household(db, amina_member, amina, household, today)

        # Plan the current week (Mon-Sun): dinner every day, a few breakfasts, real-life entries.
        monday = today - timedelta(days=today.weekday())
        used: set[str] = set()
        for offset in range(7):
            day = monday + timedelta(days=offset)
            adder = alex if offset % 2 == 0 else amina
            dinner = _pick(recipes, {"dinner"}, used, rng)
            if dinner:
                db.add(MealPlanEntryRow(household_id=household.id, date=day, slot="dinner", recipe_id=dinner.id, servings=2, added_by=adder.id))
            if offset in (0, 2, 5):
                breakfast = _pick(recipes, {"breakfast"}, used, rng)
                if breakfast:
                    db.add(MealPlanEntryRow(household_id=household.id, date=day, slot="breakfast", recipe_id=breakfast.id, servings=2, added_by=adder.id))
            if offset == 1:
                db.add(MealPlanEntryRow(household_id=household.id, date=day, slot="lunch", custom_title="Leftovers", servings=2, added_by=adder.id))
            if offset == 5:
                db.add(MealPlanEntryRow(household_id=household.id, date=day, slot="lunch", custom_title="Eating out", servings=2, added_by=adder.id))
        db.flush()
        log_activity(db, alex_member, "plan.copy", {"summary": "planned the week"})

        # Favorites for both, so the planner's "household favorites" tab has content.
        for user in (alex, amina):
            for r in rng.sample(recipes, k=min(4, len(recipes))):
                db.add(FavoriteRow(user_id=user.id, recipe_id=r.id))

        # A shop from today to Sunday, about a third checked off (one partly bought).
        trip = ShoppingTripRow(household_id=household.id, start_date=today, end_date=monday + timedelta(days=6), created_by=alex.id, promoted_staples=[])
        db.add(trip)
        db.flush()
        from .routers.groceries import trip_items  # local import: router module imports FastAPI bits

        items, _, _ = trip_items(db, alex_member, trip, household)
        to_buy = [i for i in items if i["state"] == "to_buy" and not i["staple"]]
        for index, item in enumerate(to_buy):
            if index % 3 != 0:
                continue
            for part in item["parts"]:
                qty = part["needed"]
                if qty is not None and index == 0:
                    qty = qty / 2  # partly bought: shows "+N more needed"
                db.add(ShoppingMarkRow(
                    trip_id=trip.id, item_key=part["key"],
                    purchased_qty=Decimal(str(round(qty, 3))) if qty is not None else None,
                    checked_by=amina.id,
                ))
            log_activity(db, amina_member, "groceries.mark", {"key": item["key"], "summary": f"got {item['name']}"})
        db.add(ShoppingExtraRow(trip_id=trip.id, name="paper towels", aisle="household", added_by=alex.id))
        db.add(ShoppingExtraRow(trip_id=trip.id, name="coffee", aisle="drinks", checked=True, checked_by=amina.id, added_by=amina.id))
        db.commit()
        planned = db.execute(select(MealPlanEntryRow).where(MealPlanEntryRow.household_id == household.id)).scalars().all()
        print(
            f"Demo ready: household '{household.name}' (invite code {household.invite_code}), "
            f"{len(planned)} plan entries, {len(to_buy)} items to buy.\n"
            f"Log in as alex.demo / amina.demo with password {PASSWORD}."
        )
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the two demo accounts")
    parser.add_argument("--today", type=date.fromisoformat, default=date.today())
    args = parser.parse_args(argv)
    run(args.today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
