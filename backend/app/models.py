from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    false,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

# JSONB on PostgreSQL (production), plain JSON elsewhere (the SQLite test database).
JSONType = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")
# TIMESTAMPTZ on PostgreSQL.
TS = DateTime(timezone=True)


def utcnow() -> datetime:
    """Timezone-aware UTC timestamp; every timestamp column uses it (plus a now() server default)."""
    return datetime.now(timezone.utc)


def as_utc(value: datetime | None) -> datetime | None:
    """Aware UTC datetime. PostgreSQL (TIMESTAMPTZ) already returns aware values; the SQLite
    test database returns naive ones, which are UTC by construction (utcnow)."""
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def iso_utc(value: datetime | None) -> str | None:
    """ISO 8601 with an explicit +00:00 offset, for API responses."""
    aware = as_utc(value)
    return aware.isoformat() if aware else None


class RecipeRow(Base):
    """One row per recipe; `data` holds the content fields (recipe model v2: mealTypes, diet,
    ingredients with group/note/aisle, steps with text/timerMinutes, source, imageCredit,
    nutrition), while ownership/visibility/curation/lineage are real columns so discovery can
    filter on them in SQL. The API merges both into one flat shape (`to_response` in
    routers/recipes.py). System recipes (from content/recipes) have owner_id NULL."""

    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSONType, nullable=False)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    is_official: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    parent_recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id"), nullable=True, index=True)


class UserRow(Base):
    """A registered account. Passwords are bcrypt hashes, never plaintext."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Preferred UI language: "en" | "fr" | "ar" (validated in schemas.Language).
    language: Mapped[str] = mapped_column(String(8), default="en", server_default="en")


class AppStorageRow(Base):
    """Generic per-user key/value store for small per-account preferences that don't need to
    be shared (per-recipe notes, recentViews, darkMode, collections). Meal plans, favorites
    and shopping lists moved to real tables below."""

    __tablename__ = "app_storage"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONType, nullable=True)


class HouseholdRow(Base):
    """A shared kitchen: plan, groceries and activity belong to a household, never a user.
    Settings live here too (size = default servings, diet prefs, units, pantry staples)."""

    __tablename__ = "households"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    invite_code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    size: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    # List of preference slugs, see schemas.DIET_PREFS (vegetarian, no-pork, ...).
    diet: Mapped[list] = mapped_column(JSONType, nullable=False, default=list, server_default=text("'[]'"))
    units: Mapped[str] = mapped_column(String(16), default="metric", server_default="metric")
    # Canonical ingredient names; NULL means "use the default staples" (groceries.DEFAULT_STAPLES).
    pantry_staples: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    # "Prefer budget recipes": Fill empty dinners favours budget "low" by default.
    prefer_budget: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())


class HouseholdMemberRow(Base):
    """Membership: user_id is the primary key, so a user belongs to exactly one household."""

    __tablename__ = "household_members"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), default="member", nullable=False)  # owner | member
    joined_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())
    # Last time this member opened the groceries list - drives the "new" dot.
    groceries_seen_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class MealPlanEntryRow(Base):
    """One planned meal. Either recipe_id or custom_title is set (Leftovers / Eating out /
    free text). Dates are plain local dates (no time zone) end to end."""

    __tablename__ = "meal_plan_entries"
    __table_args__ = (Index("ix_meal_plan_household_date", "household_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    slot: Mapped[str] = mapped_column(String(16), nullable=False)  # breakfast|lunch|dinner|snack
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    recipe_id: Mapped[str | None] = mapped_column(
        ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    custom_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    servings: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    added_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, server_default=func.now())


class FavoriteRow(Base):
    """Per-user favorite; household members can see each other's in the planner."""

    __tablename__ = "favorites"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    recipe_id: Mapped[str] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())


class ShoppingTripRow(Base):
    """"A shop": the grocery list is derived live from the plan entries in [start, end].
    One open trip (closed_at NULL) per household."""

    __tablename__ = "shopping_trips"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Pantry staples the household promoted to the real list for this trip ("I need it").
    promoted_staples: Mapped[list] = mapped_column(JSONType, nullable=False, default=list, server_default=text("'[]'"))
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class ShoppingMarkRow(Base):
    """What was bought for one grocery item part (item_key = canonical name + unit family).
    purchased_qty is in the part's base unit (g, ml, or the count unit); NULL means
    "checked, no quantity" (e.g. "salt, to taste")."""

    __tablename__ = "shopping_marks"

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("shopping_trips.id", ondelete="CASCADE"), primary_key=True
    )
    item_key: Mapped[str] = mapped_column(String(191), primary_key=True)
    purchased_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    checked_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, server_default=func.now())


class ShoppingHaveRow(Base):
    """How much of a grocery item part the household already has at home for this trip
    (item_key = canonical name + unit family, same key as shopping_marks). have_qty is in the
    part's base unit and is kept apart from purchased_qty: remaining = needed - have - purchased.
    No row = nothing at home."""

    __tablename__ = "shopping_have"

    trip_id: Mapped[int] = mapped_column(
        ForeignKey("shopping_trips.id", ondelete="CASCADE"), primary_key=True
    )
    item_key: Mapped[str] = mapped_column(String(191), primary_key=True)
    have_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, server_default=func.now())


class ShoppingExtraRow(Base):
    """A manual item on a trip ("paper towels"), auto-categorized into an aisle."""

    __tablename__ = "shopping_extras"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    trip_id: Mapped[int] = mapped_column(
        ForeignKey("shopping_trips.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[str | None] = mapped_column(String(64), nullable=True)  # free text, "2 rolls"
    aisle: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    checked: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    checked_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    added_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())


class HouseholdIngredientAisleRow(Base):
    """The aisle a household picked for an ingredient the dictionary does not know. `name` is
    the canonical (normalized) ingredient name; used by new recipes and the grocery list."""

    __tablename__ = "household_ingredient_aisles"
    __table_args__ = (UniqueConstraint("household_id", "name", name="uq_household_ingredient_aisle"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    aisle: Mapped[str] = mapped_column(String(32), nullable=False)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow, server_default=func.now())


class HouseholdActivityRow(Base):
    """Append-only event log; clients poll it with an id cursor for live updates."""

    __tablename__ = "household_activity"
    __table_args__ = (Index("ix_activity_household_id_id", "household_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    household_id: Mapped[int] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict, server_default=text("'{}'"))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, server_default=func.now())

