"""Recipe model v2 API and the content importer (fixture content, fake uploader)."""

import json
from datetime import date
from pathlib import Path

import pytest

from app.content_import import ContentError, load_content, resolve_images, sync
from app.models import MealPlanEntryRow, RecipeRow
from tests.conftest import add_system_recipe

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "content" / "recipes"


def test_create_recipe_minimal_assigns_server_fields(client, register):
    h = register("cook", "Cook Person")
    res = client.post("/api/recipes", headers=h, json={
        "name": "Toast",
        "ingredients": [{"quantity": 2, "unit": "slice", "name": "bread"}, {"name": "butter", "note": "soft", "optional": True}],
        "prepTime": 2, "cookTime": 3, "id": "hacked", "rating": 5,
    })
    assert res.status_code == 200, res.text
    r = res.json()
    assert r["id"] != "hacked" and "rating" not in r and "reviewCount" not in r
    assert r["author"] == "Cook Person" and r["ownerId"] and r["isPublic"] is True
    assert r["totalTime"] == 5 and r["servings"] == 4
    assert r["traditional"] is False and r["budget"] is None
    assert [i["aisle"] for i in r["ingredients"]] == ["bakery", "dairy-eggs"]
    assert r["ingredients"][1]["optional"] is True
    assert client.post("/api/recipes", headers=h, json={"name": "Nothing", "ingredients": []}).status_code == 422
    # PATCH re-derives aisles; only the owner may edit.
    patched = client.patch(f"/api/recipes/{r['id']}", headers=h, json={
        "ingredients": [{"name": "chicken thighs", "quantity": 1, "unit": "kg"}], "isPublic": False,
    }).json()
    assert patched["ingredients"][0]["aisle"] == "meat-fish" and patched["isPublic"] is False
    other = register("other")
    assert client.patch(f"/api/recipes/{r['id']}", headers=other, json={"name": "x"}).status_code == 403


def test_private_import_draft_can_be_saved_private(client, register):
    h = register("cook")
    r = client.post("/api/recipes", headers=h, json={
        "name": "Imported", "isPublic": False, "ingredients": [{"name": "salt"}],
        "source": {"url": "https://example.com/x", "title": "Example"},
    }).json()
    assert r["isPublic"] is False and r["source"]["url"] == "https://example.com/x"
    assert all(x["id"] != r["id"] for x in client.get("/api/recipes").json())


def test_load_content_fixture_is_valid():
    recipes = load_content(FIXTURE_DIR)
    assert [r.id for r in recipes] == ["fixture-chana-masala", "fixture-buttered-eggs", "fixture-lemon-rice"]


def test_load_content_reports_file_id_and_field(tmp_path):
    good = json.loads((FIXTURE_DIR / "fixture.json").read_text(encoding="utf-8"))
    bad = dict(good[1], id="bad-one", difficulty="impossible")
    bad["ingredients"] = [dict(bad["ingredients"][0], unit="bucket")]
    (tmp_path / "batch.json").write_text(json.dumps([good[0], bad, dict(good[0])]), encoding="utf-8")
    with pytest.raises(ContentError) as err:
        load_content(tmp_path)
    message = str(err.value)
    assert "batch.json: bad-one: difficulty" in message
    assert "batch.json: bad-one: ingredients.0.unit" in message
    assert "fixture-chana-masala: id: duplicate" in message


def test_images_use_lockfile_and_abort_on_failure(tmp_path):
    recipes = load_content(FIXTURE_DIR)
    lock = tmp_path / "images.lock.json"
    calls = []

    def fake_upload(recipe_id, source_url):
        calls.append(recipe_id)
        return f"https://res.cloudinary.com/demo/image/upload/recipes/{recipe_id}.avif"

    urls = resolve_images(recipes, lock, uploader=fake_upload)
    assert calls == ["fixture-chana-masala"]
    assert urls["fixture-buttered-eggs"] == ""
    resolve_images(recipes, lock, uploader=fake_upload)
    assert calls == ["fixture-chana-masala"]  # cached by the lockfile

    def failing(recipe_id, source_url):
        raise RuntimeError("Invalid Signature")

    lock.unlink()
    with pytest.raises(ContentError, match="Image upload failed for fixture-chana-masala"):
        resolve_images(recipes, lock, uploader=failing)


def test_sync_touches_only_system_rows(client, register, db):
    h = register("cook")
    mine = client.post("/api/recipes", headers=h, json={"name": "Mine", "ingredients": [{"name": "salt"}]}).json()
    add_system_recipe(db, "old-system-recipe")
    db.add(MealPlanEntryRow(household_id=1, date=date(2026, 10, 21), slot="dinner", recipe_id="old-system-recipe", servings=2))
    db.commit()

    recipes = load_content(FIXTURE_DIR)
    urls = {r.id: "" for r in recipes}
    assert sync(db, recipes, urls) == (3, 0, 1)
    assert db.get(RecipeRow, mine["id"]) is not None  # user recipe untouched
    assert db.get(RecipeRow, "old-system-recipe") is None
    entry = db.query(MealPlanEntryRow).one()
    assert entry.recipe_id is None and entry.custom_title == "Old System Recipe"

    chana = db.get(RecipeRow, "fixture-chana-masala").data
    assert chana["totalTime"] == 35 and chana["source"]["license"] == "Public domain"
    assert chana["traditional"] is True and chana["budget"] == "low"
    assert next(i for i in chana["ingredients"] if i["name"] == "cilantro")["optional"] is True
    assert {i["aisle"] for i in chana["ingredients"]} >= {"produce", "spices", "pantry"}
    assert sync(db, recipes, urls) == (0, 0, 0)  # idempotent

    listed = {r["id"] for r in client.get("/api/recipes").json()}
    assert {"fixture-chana-masala", "fixture-buttered-eggs", "fixture-lemon-rice", mine["id"]} <= listed


def test_real_content_batches_validate():
    """Whatever batches exist in content/recipes must pass the importer's validation."""
    from app.content_import import DEFAULT_DIR

    if not any(DEFAULT_DIR.glob("*.json")):
        pytest.skip("no content batches yet")
    assert len(load_content(DEFAULT_DIR)) > 0


def test_original_recipes_are_accepted(tmp_path):
    good = json.loads((FIXTURE_DIR / "fixture.json").read_text(encoding="utf-8"))
    original = dict(good[1], id="mise-original", source={
        "title": "Mise kitchen", "author": "Mise kitchen", "year": None, "url": "https://example.org/reference",
        "license": "Original", "adaptation": "Written from the traditional method.",
    })
    no_link = dict(good[2], id="mise-original-2", source={"title": "Mise kitchen", "author": "Mise kitchen", "license": "Original"})
    bad = dict(good[2], id="needs-a-link", source={"title": "Some book", "license": "Public domain"})
    (tmp_path / "a.json").write_text(json.dumps([original, no_link]), encoding="utf-8")
    assert [r.source.license for r in load_content(tmp_path)] == ["Original", "Original"]
    (tmp_path / "b.json").write_text(json.dumps([bad]), encoding="utf-8")
    with pytest.raises(ContentError, match="needs-a-link: source"):
        load_content(tmp_path)
