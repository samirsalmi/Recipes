"""what the household already has at home, per grocery item part

shopping_have keeps "I have 3 potatoes at home" apart from shopping_marks.purchased_qty, so
"bought 2" and "have 3" are never mixed: remaining = needed - have - purchased.

Revision ID: 0004_shopping_have
Revises: 0003_user_language
Create Date: 2026-10-21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_shopping_have"
down_revision: Union[str, Sequence[str], None] = "0003_user_language"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shopping_have",
        sa.Column("trip_id", sa.Integer(), sa.ForeignKey("shopping_trips.id", name="fk_have_trip", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_key", sa.String(191), primary_key=True),
        sa.Column("have_qty", sa.Numeric(12, 3), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", name="fk_have_updated_by", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("shopping_have")
