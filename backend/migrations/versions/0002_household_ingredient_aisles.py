"""household ingredient aisles

The aisle a household picked for an ingredient the dictionary does not know (recipe form
"Which aisle?"), remembered for later recipes and the grocery list.

Revision ID: 0002_household_ingredient_aisles
Revises: 0001_v2_baseline
Create Date: 2026-10-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_household_ingredient_aisles"
down_revision: Union[str, Sequence[str], None] = "0001_v2_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "household_ingredient_aisles",
        sa.Column("id", sa.Integer(), sa.Identity(), primary_key=True),
        sa.Column("household_id", sa.Integer(), sa.ForeignKey("households.id", name="fk_ing_aisle_household", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("aisle", sa.String(32), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_ing_aisle_user", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("household_id", "name", name="uq_household_ingredient_aisle"),
    )
    op.create_index("ix_household_ingredient_aisles_household_id", "household_ingredient_aisles", ["household_id"])


def downgrade() -> None:
    op.drop_table("household_ingredient_aisles")
