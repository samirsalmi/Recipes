"""Meal plan + groceries endpoints end to end (two members sharing a household)."""

from tests.conftest import add_system_recipe


def household_pair(client, register):
    a, b = register("anna"), register("ben")
    code = client.get("/api/household", headers=a).json()["inviteCode"]
    client.post("/api/household/join", headers=b, json={"code": code})
    return a, b


def items_by_name(payload):
    return {i["name"]: i for i in payload["items"]}


def test_plan_crud_and_copy_week(client, register, db):
    add_system_recipe(db, "soup")
    add_system_recipe(db, "stew")
    a, b = household_pair(client, register)
    client.patch("/api/household", headers=a, json={"size": 3})
    e = client.post("/api/plan", headers=a, json={"date": "2026-10-19", "slot": "dinner", "recipeId": "soup"}).json()
    assert e["servings"] == 3  # default = household size
    assert e["recipe"]["name"] == "Soup" and e["addedByName"] == "Anna"
    assert client.post("/api/plan", headers=a, json={"date": "2026-10-19", "slot": "dinner"}).status_code == 400
    assert client.post("/api/plan", headers=a, json={"date": "2026-10-19", "slot": "dinner", "recipeId": "nope"}).status_code == 400
    lo = client.post("/api/plan", headers=b, json={"date": "2026-10-20", "slot": "lunch", "customTitle": "Leftovers"}).json()
    assert lo["recipeId"] is None and lo["customTitle"] == "Leftovers"

    moved = client.patch(f"/api/plan/{e['id']}", headers=b, json={"date": "2026-10-23", "servings": 5}).json()
    assert moved["date"] == "2026-10-23" and moved["servings"] == 5
    swapped = client.patch(f"/api/plan/{e['id']}", headers=b, json={"recipeId": "stew"}).json()
    assert swapped["recipeId"] == "stew"

    copied = client.post("/api/plan/copy-week", headers=a, json={"fromStart": "2026-10-19", "toStart": "2026-10-26"}).json()
    assert sorted(c["date"] for c in copied) == ["2026-10-27", "2026-10-30"]
    assert client.delete(f"/api/plan/{lo['id']}", headers=a).status_code == 204
    week = client.get("/api/plan?start=2026-10-19&end=2026-10-25", headers=b).json()
    assert [w["recipeId"] for w in week] == ["stew"]
    cooked = client.get("/api/plan/cooked?before=2026-11-30", headers=a).json()
    assert {c["recipeId"]: c["count"] for c in cooked} == {"stew": 2}


def test_fill_suggestions_respects_diet_and_empty_slots(client, register, db):
    add_system_recipe(db, "veg-curry", diet={"vegetarian": True}, cuisine="Indian", cook=40, budget="low")
    add_system_recipe(db, "veg-pasta", diet={"vegetarian": True}, cuisine="Italian", prep=5, cook=10)
    add_system_recipe(db, "pork-stew", diet={"containsPork": True}, cuisine="French")
    add_system_recipe(db, "pancakes", meal_types=("breakfast",), diet={"vegetarian": True})
    h = register("cook")
    client.patch("/api/household", headers=h, json={"diet": ["vegetarian"]})
    client.post("/api/plan", headers=h, json={"date": "2026-10-19", "slot": "dinner", "customTitle": "Eating out"})
    proposals = client.post("/api/plan/fill-suggestions", headers=h, json={"start": "2026-10-19", "end": "2026-10-21"}).json()
    assert [p["date"] for p in proposals] == ["2026-10-20", "2026-10-21"]
    assert {p["recipeId"] for p in proposals} == {"veg-curry", "veg-pasta"}
    # Weekday: the quick one (15 min) beats the 50-min one when cuisines tie;
    # both are fresh cuisines here, so quick wins on the first day.
    assert proposals[0]["recipeId"] == "veg-pasta"
    # Budget week: the low-budget curry now comes first, via the request or the household setting.
    budget = client.post("/api/plan/fill-suggestions", headers=h, json={"start": "2026-10-19", "end": "2026-10-21", "budget": True}).json()
    assert budget[0]["recipeId"] == "veg-curry"
    assert client.patch("/api/household", headers=h, json={"preferBudget": True}).json()["preferBudget"] is True
    again = client.post("/api/plan/fill-suggestions", headers=h, json={"start": "2026-10-19", "end": "2026-10-21"}).json()
    assert again[0]["recipeId"] == "veg-curry"


def test_groceries_flow_with_deltas_and_optional(client, register, db):
    add_system_recipe(db, "omelette", servings=2, ingredients=[
        {"quantity": 3, "unit": None, "name": "eggs"},
        {"quantity": 10, "unit": "g", "name": "butter"},
        {"quantity": None, "unit": None, "name": "salt"},
        {"quantity": 1, "unit": "bunch", "name": "chives", "optional": True},
    ])
    a, b = household_pair(client, register)
    e1 = client.post("/api/plan", headers=a, json={"date": "2026-10-21", "slot": "breakfast", "recipeId": "omelette", "servings": 2}).json()
    g = client.get("/api/groceries?today=2026-10-21", headers=b).json()
    assert g["trip"]["start"] == "2026-10-21" and g["trip"]["end"] == "2026-10-25"  # today -> Sunday
    items = items_by_name(g)
    assert items["egg"]["neededLabel"] == "3"
    assert items["salt"]["staple"] is True
    assert "chives" not in items
    assert [o["name"] for o in g["optionalExtras"]] == ["chives"]

    # Ben checks the eggs off in the store.
    g = client.post("/api/groceries/mark", headers=b, json={"key": "egg"}).json()
    assert items_by_name(g)["egg"]["state"] == "in_cart"
    # Anna adds another omelette on Thursday: 3 more eggs needed.
    client.post("/api/plan", headers=a, json={"date": "2026-10-22", "slot": "breakfast", "recipeId": "omelette", "servings": 2})
    egg = items_by_name(client.get("/api/groceries", headers=b).json())["egg"]
    assert egg["state"] == "to_buy" and egg["moreNeeded"] and egg["remainingLabel"] == "3"
    # Both omelettes are removed: the eggs bought are "no longer needed".
    for entry in client.get("/api/plan?start=2026-10-19&end=2026-10-25", headers=a).json():
        client.delete(f"/api/plan/{entry['id']}", headers=a)
    egg = items_by_name(client.get("/api/groceries", headers=a).json())["egg"]
    assert egg["state"] == "no_longer_needed" and egg["purchasedLabel"] == "3"
    g = client.post("/api/groceries/unmark", headers=a, json={"key": "egg"}).json()
    assert "egg" not in items_by_name(g)
    assert e1["id"]


def test_partial_quantities_staples_extras_share_and_new_shop(client, register, db):
    add_system_recipe(db, "rice-bowl", servings=2, ingredients=[
        {"quantity": 400, "unit": "g", "name": "rice"},
        {"quantity": 1, "unit": "tbsp", "name": "olive oil"},
    ])
    h = register("cook")
    client.post("/api/plan", headers=h, json={"date": "2026-10-21", "slot": "dinner", "recipeId": "rice-bowl", "servings": 2})
    client.get("/api/groceries?today=2026-10-21", headers=h)
    g = client.post("/api/groceries/mark", headers=h, json={"key": "rice", "quantities": {"rice|mass": 250}}).json()
    rice = items_by_name(g)["rice"]
    assert rice["state"] == "to_buy" and rice["moreNeeded"] and rice["remainingLabel"] == "150 g"
    assert client.post("/api/groceries/mark", headers=h, json={"key": "rice", "quantities": {"bogus|mass": 1}}).status_code == 400
    assert client.post("/api/groceries/mark", headers=h, json={"key": "nothing"}).status_code == 404

    g = client.post("/api/groceries/staples", headers=h, json={"name": "olive oil"}).json()
    assert items_by_name(g)["olive oil"]["promoted"] is True

    g = client.post("/api/groceries/extras", headers=h, json={"name": "Paper towels", "quantity": "2 rolls"}).json()
    extra = g["extras"][0]
    assert extra["aisle"] == "household"
    g = client.patch(f"/api/groceries/extras/{extra['id']}", headers=h, json={"checked": True}).json()
    assert g["extras"][0]["checked"] is True

    text = client.get("/api/groceries/share-text", headers=h).json()["text"]
    assert "- rice: 150 g" in text and "Pantry" in text and "Paper towels" not in text

    g = client.post("/api/groceries/new-shop", headers=h, json={"start": "2026-10-26", "end": "2026-11-01"}).json()
    assert g["trip"]["start"] == "2026-10-26" and g["extras"] == [] and g["items"] == []
    assert len(client.get("/api/groceries/history", headers=h).json()) == 1
    assert client.put("/api/groceries/range", headers=h, json={"start": "2026-10-19", "end": "2026-10-25"}).json()["trip"]["start"] == "2026-10-19"


def test_favorites_visible_to_household(client, register, db):
    add_system_recipe(db, "soup")
    a, b = household_pair(client, register)
    outsider = register("zed")
    assert client.put("/api/favorites/soup", headers=a).status_code == 204
    assert client.put("/api/favorites/nope", headers=a).status_code == 404
    favs = client.get("/api/favorites", headers=b).json()
    assert [(f["recipeId"], f["userName"]) for f in favs] == [("soup", "Anna")]
    assert client.get("/api/favorites", headers=outsider).json() == []
    client.delete("/api/favorites/soup", headers=a)
    assert client.get("/api/favorites", headers=a).json() == []


def test_fill_suggestions_cuisine_selection_spreads_and_validates(client, register, db):
    for i in range(3):
        add_system_recipe(db, f"thai-{i}", cuisine="Thai")
        add_system_recipe(db, f"greek-{i}", cuisine="Greek")
    add_system_recipe(db, "pizza", cuisine="Italian")
    h = register("cook")
    body = {"start": "2026-10-19", "end": "2026-10-24", "cuisines": ["Thai", "Greek"]}
    for _ in range(5):  # randomized: the spread must hold on every draw
        proposals = client.post("/api/plan/fill-suggestions", headers=h, json=body).json()
        cuisines = [p["recipe"]["cuisine"] for p in proposals]
        assert len(proposals) == 6 and sorted(cuisines) == ["Greek"] * 3 + ["Thai"] * 3
        assert len({p["recipeId"] for p in proposals}) == 6  # no repeats
        assert cuisines[0] != cuisines[1] and cuisines[2] != cuisines[3]  # alternates
    # A single cuisine with too few recipes: fills what it can, no repeats.
    few = client.post("/api/plan/fill-suggestions", headers=h, json={**body, "cuisines": ["Italian"]}).json()
    assert [p["recipeId"] for p in few] == ["pizza"]
    # Empty list = any cuisine; unknown cuisine = 400.
    anyc = client.post("/api/plan/fill-suggestions", headers=h, json={**body, "cuisines": []}).json()
    assert len(anyc) == 6
    assert client.post("/api/plan/fill-suggestions", headers=h, json={**body, "cuisines": ["Atlantean"]}).status_code == 400


def test_fill_suggestions_cuisines_still_respect_diet(client, register, db):
    add_system_recipe(db, "thai-veg", cuisine="Thai", diet={"vegetarian": True})
    add_system_recipe(db, "thai-pork", cuisine="Thai", diet={"containsPork": True})
    h = register("cook")
    client.patch("/api/household", headers=h, json={"diet": ["vegetarian"]})
    out = client.post("/api/plan/fill-suggestions", headers=h, json={"start": "2026-10-19", "end": "2026-10-21", "cuisines": ["Thai"]}).json()
    assert [p["recipeId"] for p in out] == ["thai-veg"]
