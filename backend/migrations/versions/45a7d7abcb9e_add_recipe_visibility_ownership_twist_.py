"""add recipe visibility ownership twist and admin columns

Revision ID: 45a7d7abcb9e
Revises: 84e71ad0e7c3
Create Date: 2026-09-28 10:08:47.464425

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45a7d7abcb9e'
down_revision: Union[str, Sequence[str], None] = '84e71ad0e7c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="0"))
    op.add_column("recipes", sa.Column("owner_id", sa.Integer(), nullable=True))
    op.add_column(
        "recipes", sa.Column("is_public", sa.Boolean(), nullable=False, server_default="1")
    )
    op.add_column(
        "recipes", sa.Column("is_official", sa.Boolean(), nullable=False, server_default="0")
    )
    op.add_column("recipes", sa.Column("parent_recipe_id", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_recipes_owner_id_users", "recipes", "users", ["owner_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_recipes_parent_recipe_id_recipes", "recipes", "recipes", ["parent_recipe_id"], ["id"]
    )
    # Existing seed recipes have no owner, so they're the "official" baseline by origin.
    op.execute("UPDATE recipes SET is_official = 1 WHERE owner_id IS NULL")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_recipes_parent_recipe_id_recipes", "recipes", type_="foreignkey")
    op.drop_constraint("fk_recipes_owner_id_users", "recipes", type_="foreignkey")
    op.drop_column("recipes", "parent_recipe_id")
    op.drop_column("recipes", "is_official")
    op.drop_column("recipes", "is_public")
    op.drop_column("recipes", "owner_id")
    op.drop_column("users", "is_admin")
