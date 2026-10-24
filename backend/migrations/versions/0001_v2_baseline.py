"""v2 baseline schema for PostgreSQL

Full schema: users, recipes, app_storage, households, household_members, meal_plan_entries,
favorites, shopping_trips, shopping_marks, shopping_extras, household_activity.

Revision ID: 0001_v2_baseline
Revises:
Create Date: 2026-10-20

The project moved from MySQL to PostgreSQL with no data to carry over, so the old MySQL
history was squashed into this single baseline. JSONB for JSON columns, TIMESTAMPTZ for
timestamps (server default now()), DATE for plan/trip dates, real BOOLEANs, and indexes on
foreign-key / filter columns. Must stay in sync with backend/app/models.py.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_v2_baseline"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSONB = postgresql.JSONB(none_as_null=True)
NOW = sa.text("now()")


def ts(name: str, nullable: bool = False, default: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable, server_default=NOW if default else None)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        ts("created_at"),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)

    op.create_table(
        "recipes",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("data", JSONB, nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_recipes_owner_id_users"), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_official", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("parent_recipe_id", sa.String(64), sa.ForeignKey("recipes.id", name="fk_recipes_parent_recipe_id_recipes"), nullable=True),
    )
    op.create_index("ix_recipes_owner_id", "recipes", ["owner_id"])
    op.create_index("ix_recipes_parent_recipe_id", "recipes", ["parent_recipe_id"])

    op.create_table(
        "app_storage",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_app_storage_user"), primary_key=True),
        sa.Column("key", sa.String(255), primary_key=True),
        sa.Column("value", JSONB, nullable=True),
    )

    op.create_table(
        "households",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("invite_code", sa.String(16), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("diet", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("units", sa.String(16), nullable=False, server_default="metric"),
        sa.Column("pantry_staples", JSONB, nullable=True),
        sa.Column("prefer_budget", sa.Boolean(), nullable=False, server_default=sa.false()),
        ts("created_at"),
        sa.UniqueConstraint("invite_code", name="households_invite_code_key"),
    )

    op.create_table(
        "household_members",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_members_user", ondelete="CASCADE"), primary_key=True),
        sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", name="fk_members_household", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        ts("joined_at"),
        ts("groceries_seen_at", nullable=True, default=False),
    )
    op.create_index("ix_household_members_household_id", "household_members", ["household_id"])

    op.create_table(
        "meal_plan_entries",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", name="fk_plan_household", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("slot", sa.String(16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recipe_id", sa.String(64), sa.ForeignKey("recipes.id", name="fk_plan_recipe", ondelete="SET NULL"), nullable=True),
        sa.Column("custom_title", sa.String(255), nullable=True),
        sa.Column("servings", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("added_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_plan_added_by", ondelete="SET NULL"), nullable=True),
        ts("created_at"),
        ts("updated_at"),
    )
    op.create_index("ix_meal_plan_household_date", "meal_plan_entries", ["household_id", "date"])
    op.create_index("ix_meal_plan_entries_recipe_id", "meal_plan_entries", ["recipe_id"])

    op.create_table(
        "favorites",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_favorites_user", ondelete="CASCADE"), primary_key=True),
        sa.Column("recipe_id", sa.String(64), sa.ForeignKey("recipes.id", name="fk_favorites_recipe", ondelete="CASCADE"), primary_key=True),
        ts("created_at"),
    )
    op.create_index("ix_favorites_recipe_id", "favorites", ["recipe_id"])

    op.create_table(
        "shopping_trips",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", name="fk_trips_household", ondelete="CASCADE"), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("promoted_staples", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_trips_created_by", ondelete="SET NULL"), nullable=True),
        ts("created_at"),
        ts("closed_at", nullable=True, default=False),
    )
    op.create_index("ix_shopping_trips_household_id", "shopping_trips", ["household_id"])

    op.create_table(
        "shopping_marks",
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("shopping_trips.id", name="fk_marks_trip", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_key", sa.String(191), primary_key=True),
        sa.Column("purchased_qty", sa.Numeric(12, 3), nullable=True),
        sa.Column("checked_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_marks_checked_by", ondelete="SET NULL"), nullable=True),
        ts("updated_at"),
    )

    op.create_table(
        "shopping_extras",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("shopping_trips.id", name="fk_extras_trip", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("quantity", sa.String(64), nullable=True),
        sa.Column("aisle", sa.String(32), nullable=False, server_default="other"),
        sa.Column("checked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("checked_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_extras_checked_by", ondelete="SET NULL"), nullable=True),
        sa.Column("added_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_extras_added_by", ondelete="SET NULL"), nullable=True),
        ts("created_at"),
    )
    op.create_index("ix_shopping_extras_trip_id", "shopping_extras", ["trip_id"])

    op.create_table(
        "household_activity",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", name="fk_activity_household", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_activity_user", ondelete="SET NULL"), nullable=True),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        ts("created_at"),
    )
    op.create_index("ix_activity_household_id_id", "household_activity", ["household_id", "id"])


def downgrade() -> None:
    for table in (
        "household_activity",
        "shopping_extras",
        "shopping_marks",
        "shopping_trips",
        "favorites",
        "meal_plan_entries",
        "household_members",
        "households",
        "app_storage",
        "recipes",
        "users",
    ):
        op.drop_table(table)
