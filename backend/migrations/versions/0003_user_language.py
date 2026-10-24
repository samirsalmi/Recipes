"""user language + canonical ingredient names

users.language: the preferred UI language (en | fr | ar). Existing recipes get their
ingredients' English `canonical` name (and a null `translations` slot) in the data blob.

Revision ID: 0003_user_language
Revises: 0002_household_ingredient_aisles
Create Date: 2026-10-21
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_user_language"
down_revision: Union[str, Sequence[str], None] = "0002_household_ingredient_aisles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("language", sa.String(8), nullable=False, server_default="en"))

    from app.backfill_canonical import backfill_data

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, data FROM recipes")).fetchall()
    for recipe_id, data in rows:
        if isinstance(data, str):
            data = json.loads(data)
        updated = backfill_data(data)
        if updated is not None:
            bind.execute(
                sa.text("UPDATE recipes SET data = CAST(:data AS JSONB) WHERE id = :id"),
                {"data": json.dumps(updated), "id": recipe_id},
            )


def downgrade() -> None:
    op.drop_column("users", "language")
