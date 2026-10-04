from datetime import datetime, timezone

from sqlalchemy import Boolean, JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class RecipeRow(Base):
    """One row per recipe; `data` holds the full Recipe object exactly as the frontend models it,
    except for ownership/visibility/curation/lineage, which are real columns so discovery can
    filter on them in SQL. The API composes the response by merging `data` with these columns
    (see `_to_response` in routers/recipes.py)."""

    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    is_official: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    parent_recipe_id: Mapped[str | None] = mapped_column(ForeignKey("recipes.id"), nullable=True)


class UserRow(Base):
    """A registered account. Passwords are bcrypt hashes, never plaintext."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")


class AppStorageRow(Base):
    """Generic key/value store mirroring StorageService's old localStorage keys (favorites,
    ratings, collections, mealPlan, shoppingList, notes_<recipeId>, darkMode), one row per
    (user, key) so each account gets its own state."""

    __tablename__ = "app_storage"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=True)
