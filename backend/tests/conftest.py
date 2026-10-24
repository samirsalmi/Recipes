"""Tests run on in-memory SQLite by default (fast, no server needed), or against PostgreSQL
when TEST_DATABASE_URL is set, e.g.
    TEST_DATABASE_URL=postgresql+psycopg://recipe_user:PASS@localhost:5433/recipe_manager_test
Every test drops and recreates all tables, so the database name must contain "test".
Redis is disabled. The env vars must be set before any app module is imported, since
settings/engine are created at import time."""

import os

_test_url = os.environ.get("TEST_DATABASE_URL", "sqlite://")
if not _test_url.startswith("sqlite") and "test" not in _test_url.rsplit("/", 1)[-1]:
    raise RuntimeError("TEST_DATABASE_URL must point at a database whose name contains 'test' (tables are dropped)")
os.environ["DATABASE_URL"] = _test_url
os.environ["REDIS_URL"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401 - registers tables
from app.cache import invalidate_recipes  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import RecipeRow  # noqa: E402
from app.recipe_data import build_data  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    invalidate_recipes()  # the process-local cache outlives the database reset
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def register(client):
    """register("alice") -> auth headers for a new account."""

    def _register(username: str, name: str | None = None) -> dict:
        res = client.post("/api/auth/register", json={"username": username, "password": "password123", "name": name or username.title()})
        assert res.status_code == 200, res.text
        return {"Authorization": f"Bearer {res.json()['access_token']}"}

    return _register


def add_system_recipe(db, recipe_id: str, *, servings: int = 4, ingredients=None, meal_types=("dinner",), diet=None, cuisine="Testish", prep=10, cook=20, budget=None, traditional=False):
    fields = {
        "name": recipe_id.replace("-", " ").title(),
        "servings": servings,
        "mealTypes": list(meal_types),
        "cuisine": cuisine,
        "prepTime": prep,
        "cookTime": cook,
        "diet": diet or {},
        "ingredients": ingredients or [{"quantity": 1, "unit": None, "name": "onion"}],
        "steps": [{"text": "Cook."}],
        "budget": budget,
        "traditional": traditional,
    }
    row = RecipeRow(id=recipe_id, data=build_data(fields, recipe_id=recipe_id, author=None), owner_id=None, is_public=True, is_official=True)
    db.add(row)
    db.commit()
    return row
