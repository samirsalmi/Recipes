"""Language preference, canonical ingredient names stored at save time, localized names in
responses (en/fr/ar), backfill, unknown-ingredient passthrough, translations slot."""

from app.backfill_canonical import backfill_canonical, backfill_data
from app.localization import localized_names
from app.models import RecipeRow
from tests.conftest import add_system_recipe


def test_language_defaults_and_persists(client, register):
    res = client.post("/api/auth/register", json={"username": "lea", "password": "password123", "name": "Lea"})
    assert res.json()["user"]["language"] == "en"
    h = {"Authorization": f"Bearer {res.json()['access_token']}"}
    patched = client.patch("/api/auth/me", headers=h, json={"language": "ar"})
    assert patched.status_code == 200 and patched.json()["language"] == "ar"
    assert client.get("/api/auth/me", headers=h).json()["language"] == "ar"
    login = client.post("/api/auth/login", json={"username": "lea", "password": "password123"})
    assert login.json()["user"]["language"] == "ar"


def test_language_validation(client, register):
    h = register("sam")
    for bad in ("de", "", "EN", 5):
        assert client.patch("/api/auth/me", headers=h, json={"language": bad}).status_code == 422
    assert client.patch("/api/auth/me", headers=h, json={}).json()["language"] == "en"
    bad_reg = client.post("/api/auth/register", json={"username": "zed", "password": "password123", "name": "Z", "language": "xx"})
    assert bad_reg.status_code == 422
    fr = client.post("/api/auth/register", json={"username": "zoe", "password": "password123", "name": "Z", "language": "fr"})
    assert fr.json()["user"]["language"] == "fr"


def test_patch_me_requires_auth(client):
    assert client.patch("/api/auth/me", json={"language": "fr"}).status_code == 401


def make_recipe(client, h, names):
    body = {"name": "Mixed", "ingredients": [{"quantity": 1, "unit": "tbsp", "name": n} for n in names]}
    res = client.post("/api/recipes", headers=h, json=body)
    assert res.status_code in (200, 201), res.text
    return res.json()


def test_canonical_stored_and_localized_names(client, register, db):
    h = register("chef")
    recipe = make_recipe(client, h, ["beurre", "butter", "زبدة", "dragon fruit powder"])
    ings = recipe["ingredients"]
    assert [i["name"] for i in ings] == ["beurre", "butter", "زبدة", "dragon fruit powder"]  # as typed
    assert [i["canonical"] for i in ings[:3]] == ["butter"] * 3
    for i in ings[:3]:
        assert i["known"] is True
        assert i["names"]["en"] == "butter"
        assert i["names"]["fr"] == "beurre"
        assert i["names"]["ar"] == "زبدة"
    unknown = ings[3]
    assert unknown["known"] is False and unknown["names"] is None
    stored = db.get(RecipeRow, recipe["id"]).data["ingredients"]
    assert [i["canonical"] for i in stored[:3]] == ["butter"] * 3  # stored, not just computed
    assert "names" not in stored[0]  # localized names are derived on read
    fetched = client.get(f"/api/recipes/{recipe['id']}").json()
    assert fetched["ingredients"][0]["names"]["fr"] == "beurre"


def test_update_restamps_canonical(client, register):
    h = register("chef2")
    recipe = make_recipe(client, h, ["onion"])
    updated = client.patch(f"/api/recipes/{recipe['id']}", headers=h, json={"ingredients": [{"name": "oignon rouge", "quantity": 2}]})
    assert updated.json()["ingredients"][0]["canonical"] == "red onion"


def test_localized_names_table():
    assert localized_names("butter") == {"en": "butter", "fr": "beurre", "ar": "زبدة"}
    assert localized_names("not an ingredient") is None


def test_groceries_localized_names_and_amount_parts(client, register, db):
    add_system_recipe(db, "butter-dish", servings=1, ingredients=[
        {"quantity": 2, "unit": "tbsp", "name": "beurre"},
        {"quantity": 2, "unit": "cloves", "name": "ail"},
        {"quantity": 1, "unit": None, "name": "zorblax"},
        {"quantity": 1, "unit": None, "name": "persil", "optional": True},
    ])
    h = register("shopper")
    client.patch("/api/household", headers=h, json={"size": 1})
    client.post("/api/plan", headers=h, json={"date": "2026-10-19", "slot": "dinner", "recipeId": "butter-dish"})
    client.put("/api/groceries/range", headers=h, json={"start": "2026-10-19", "end": "2026-10-25"})
    payload = client.get("/api/groceries?today=2026-10-19", headers=h).json()
    items = {i["key"]: i for i in payload["items"]}
    assert items["butter"]["names"]["ar"] == "زبدة"
    assert items["garlic"]["names"]["fr"] == "ail"
    assert items["butter"]["parts"][0]["neededAmount"] == {"number": "2", "unit": "tbsp", "many": False}
    assert items["garlic"]["parts"][0]["neededAmount"] == {"number": "2", "unit": "clove", "many": True}
    assert items["zorblax"]["names"] is None
    opt = payload["optionalExtras"][0]
    assert opt["canonical"] == "parsley" and opt["names"]["fr"].startswith("persil")


def test_extras_typed_in_french_get_names(client, register):
    h = register("extra")
    client.get("/api/groceries?today=2026-10-19", headers=h)
    res = client.post("/api/groceries/extras", headers=h, json={"name": "lait"})
    extra = res.json()["extras"][0]
    assert extra["name"] == "lait" and extra["names"]["en"] == "milk"


def test_backfill_adds_canonical_and_is_idempotent(db):
    row = RecipeRow(id="old", data={"id": "old", "name": "Old", "ingredients": [{"name": "farine", "quantity": 1}, {"name": "xyzzy"}]}, owner_id=None, is_public=True)
    db.add(row)
    db.commit()
    assert backfill_canonical(db) == 1
    db.refresh(row)
    assert [i["canonical"] for i in row.data["ingredients"]] == ["flour", "xyzzy"]
    assert backfill_canonical(db) == 0
    assert backfill_data(row.data) is None


def test_translations_slot_roundtrip(client, register):
    h = register("author")
    body = {
        "name": "Soup",
        "ingredients": [{"name": "water"}],
        "steps": [{"text": "Boil."}],
        "translations": {"fr": {"name": "Soupe", "steps": ["Faire bouillir."]}},
    }
    recipe = client.post("/api/recipes", headers=h, json=body).json()
    assert recipe["translations"]["fr"]["name"] == "Soupe"
    plain = client.post("/api/recipes", headers=h, json={"name": "Tea", "ingredients": [{"name": "water"}]}).json()
    assert plain["translations"] is None
    bad = client.post("/api/recipes", headers=h, json={**body, "translations": {"de": {"name": "Suppe"}}})
    assert bad.status_code == 422
    patched = client.patch(f"/api/recipes/{plain['id']}", headers=h, json={"translations": {"ar": {"name": "شاي"}}})
    assert patched.json()["translations"]["ar"]["name"] == "شاي"


def test_household_isolation_unaffected(client, register, db):
    add_system_recipe(db, "soup")
    a, b = register("amy"), register("bob")
    client.post("/api/plan", headers=a, json={"date": "2026-10-19", "slot": "dinner", "recipeId": "soup"})
    client.patch("/api/auth/me", headers=b, json={"language": "ar"})
    assert client.get("/api/plan?start=2026-10-19&end=2026-10-25", headers=b).json() == []
    assert client.get("/api/auth/me", headers=a).json()["language"] == "en"


# ---------- dairy spellings and stale stored canonicals ----------

import pytest as _pytest

from app.backfill_canonical import backfill_data
from app.ingredients import canonical_name as _canon
from app.localization import enrich_ingredient, localized_names as _ln


@_pytest.mark.parametrize("typed,canonical", [
    ("fromage", "cheese"), ("Fromage", "cheese"), ("fromages", "cheese"), ("fromage râpé", "cheese"),
    ("جبن", "cheese"),
    ("creme liquide", "cream"), ("crème liquide", "cream"), ("crème fleurette", "cream"),
    ("creme fleurette", "cream"), ("crème entière", "cream"), ("crème légère", "cream"),
    ("creme legere", "cream"), ("heavy cream", "cream"), ("whipping cream", "cream"),
    ("double cream", "cream"), ("single cream", "cream"), ("cooking cream", "cream"),
    ("cream", "cream"), ("creme", "cream"), ("كريمة", "cream"), ("كريمة سائلة", "cream"),
    ("كريمة الطهي", "cream"), ("كريمة الطبخ", "cream"),
    ("crème fraîche", "creme fraiche"), ("creme fraiche", "creme fraiche"),
    ("crème épaisse", "creme fraiche"), ("creme epaisse", "creme fraiche"),
    ("sour cream", "sour cream"), ("crème aigre", "sour cream"), ("كريمة حامضة", "sour cream"),
    ("cream cheese", "cream cheese"), ("fromage à la crème", "cream cheese"),
    ("lait", "milk"),
])
def test_dairy_spellings_resolve(typed, canonical):
    assert _canon(typed) == canonical
    assert _ln(canonical) is not None


def test_english_names_for_french_dairy():
    assert _ln(_canon("fromage"))["en"] == "cheese"
    assert _ln(_canon("crème liquide")) == {"en": "cream", "fr": "crème liquide", "ar": "كريمة سائلة"}
    assert _ln("creme fraiche")["en"] == "crème fraîche"


def test_stale_unknown_stored_canonical_is_reresolved_on_read():
    # saved before the dictionary knew the word: canonical was the raw normalized text
    ing = enrich_ingredient({"name": "fromage", "canonical": "fromage"})
    assert ing["canonical"] == "cheese" and ing["names"]["en"] == "cheese" and ing["known"]
    ing = enrich_ingredient({"name": "crème liquide", "canonical": "creme liquide"})
    assert ing["canonical"] == "cream" and ing["names"]["en"] == "cream"


def test_known_stored_canonical_is_kept():
    assert enrich_ingredient({"name": "fromage", "canonical": "cheddar"})["canonical"] == "cheddar"


def test_backfill_refreshes_stale_canonical_and_is_idempotent():
    data = {"ingredients": [{"name": "fromage", "canonical": "fromage"}], "translations": None}
    fixed = backfill_data(data)
    assert fixed["ingredients"][0]["canonical"] == "cheese"
    assert backfill_data(fixed) is None
