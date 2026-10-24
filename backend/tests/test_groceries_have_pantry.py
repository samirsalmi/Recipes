"""Have-at-home amounts (kept apart from purchases) and pantry staple need/have."""

from app.groceries import Mark, at_home_memory, build_list, compute_needed
from tests.conftest import add_system_recipe
from tests.test_groceries_logic import by_name, entry, ing, recipe
from tests.test_plan_groceries_api import items_by_name

POTATO = "potato|count:piece"


def potatoes(qty=6):
    return {"stew": recipe("Stew", 2, [ing("potato", qty)])}


def build(needed, marks=None, have=None, **kw):
    return by_name(build_list(needed, marks or {}, have=have, **kw))


# ---------- pure maths ----------


def test_remaining_is_needed_minus_have_minus_purchased():
    needed = compute_needed([entry(1, "stew", 2)], potatoes())
    line = build(needed, have={POTATO: 3})["potato"]
    part = line["parts"][0]
    assert part["have"] == 3 and part["purchased"] == 0 and part["remaining"] == 3
    assert line["state"] == "to_buy" and line["hasHave"] and line["remainingLabel"] == "3"
    assert part["haveAmount"]["number"] == "3"
    # Bought 2 on top of the 3 at home: 1 left, and the two numbers stay separate.
    line = build(needed, {POTATO: Mark(purchased=2)}, {POTATO: 3})["potato"]
    assert line["parts"][0]["purchased"] == 2 and line["parts"][0]["have"] == 3 and line["parts"][0]["remaining"] == 1
    assert line["state"] == "to_buy" and line["moreNeeded"]
    # Bought the rest: in the cart.
    assert build(needed, {POTATO: Mark(purchased=3)}, {POTATO: 3})["potato"]["state"] == "in_cart"


def test_have_never_makes_remaining_negative_and_covers_the_line():
    needed = compute_needed([entry(1, "stew", 2)], potatoes())
    for qty in (6, 9):
        line = build(needed, have={POTATO: qty})["potato"]
        assert line["parts"][0]["remaining"] == 0
        assert line["state"] == "covered"
    # A purchase on top of a covering have still reads as checked, not covered.
    assert build(needed, {POTATO: Mark(purchased=1)}, {POTATO: 9})["potato"]["state"] == "in_cart"


def test_plan_change_moves_the_remaining():
    have = {POTATO: 3}
    six = compute_needed([entry(1, "stew", 2)], potatoes())
    eight = compute_needed([entry(1, "stew", 2)], potatoes(qty=8))
    assert build(six, have=have)["potato"]["parts"][0]["remaining"] == 3
    assert build(eight, have=have)["potato"]["parts"][0]["remaining"] == 5
    two = compute_needed([entry(1, "stew", 2)], potatoes(qty=2))
    assert build(two, have=have)["potato"]["state"] == "covered"


def test_unit_family_stays_separate_mass_vs_volume():
    recipes = {"r": recipe("R", 2, [ing("flour", 500, "g"), ing("flour", 1, "cup")])}
    needed = compute_needed([entry(1, "r", 2)], recipes)
    assert set(needed["flour"].parts) == {"flour|mass", "flour|volume"}
    line = build(needed, have={"flour|mass": 500})["flour"]
    parts = {p["family"]: p for p in line["parts"]}
    assert parts["mass"]["remaining"] == 0 and parts["volume"]["remaining"] == 240
    assert line["state"] == "to_buy"


def test_unquantified_parts_ignore_have():
    recipes = {"r": recipe("R", 2, [ing("saffron", None)])}
    needed = compute_needed([entry(1, "r", 2)], recipes)
    line = build(needed, have={"saffron|unquantified": 5})["saffron"]
    assert line["state"] == "to_buy" and not line["hasHave"]


def test_legacy_keys_for_have_current_wins_else_summed():
    recipes = {"a": recipe("A", 2, [ing("green chilli", 4), ing("green chillies", 2)])}
    needed = compute_needed([entry(1, "a", 2)], recipes)
    current = "chili pepper|count:piece"
    legacy = "green chilli|count:piece"
    assert legacy in needed["chili pepper"].parts[current].legacy_keys
    line = build(needed, have={legacy: 2})["chili pepper"]
    assert line["parts"][0]["have"] == 2 and line["parts"][0]["remaining"] == 4
    assert at_home_memory(needed, {legacy: 2}) == []  # not an orphan
    both = build(needed, have={legacy: 2, current: 1})["chili pepper"]
    assert both["parts"][0]["have"] == 1  # current key wins, no double counting
    assert at_home_memory(needed, {legacy: 2, current: 1}) == []


def test_stale_have_goes_to_the_at_home_memory():
    needed = compute_needed([entry(1, "stew", 2)], potatoes())
    memory = at_home_memory(needed, {POTATO: 3, "carrot|count:piece": 2, "rice|mass": 500})
    assert [m["key"] for m in memory] == ["carrot|count:piece", "rice|mass"]
    assert memory[0]["haveAmount"]["number"] == "2"
    assert memory[1]["haveAmount"] == {"number": "500", "unit": "g", "many": False}
    assert memory[0]["names"]["fr"]


def test_pantry_state_field():
    recipes = {"r": recipe("R", 2, [ing("olive oil", 1, "tbsp"), ing("potato", 2)])}
    needed = compute_needed([entry(1, "r", 2)], recipes)
    assert build(needed)["olive oil"]["pantryState"] == "have"
    assert build(needed, promoted=["olive oil"])["olive oil"]["pantryState"] == "need"
    assert build(needed)["potato"]["pantryState"] is None


# ---------- API ----------


def setup_stew(client, register, db, who="cook"):
    add_system_recipe(db, "stew", servings=2, ingredients=[
        {"quantity": 6, "unit": None, "name": "potato"},
        {"quantity": 500, "unit": "g", "name": "beef"},
        {"quantity": 1, "unit": "tbsp", "name": "olive oil"},
        {"quantity": None, "unit": None, "name": "thyme"},
    ])
    h = register(who)
    client.post("/api/plan", headers=h, json={"date": "2026-10-21", "slot": "dinner", "recipeId": "stew", "servings": 2})
    client.get("/api/groceries?today=2026-10-21", headers=h)
    return h


def put_have(client, h, key, quantity, unit=None):
    return client.put("/api/groceries/have", headers=h, json={"key": key, "quantity": quantity, "unit": unit})


def test_have_endpoint_flow_and_progress(client, register, db):
    h = setup_stew(client, register, db)
    g = put_have(client, h, POTATO, 3).json()
    potato = items_by_name(g)["potato"]
    assert potato["parts"][0]["have"] == 3 and potato["remainingLabel"] == "3" and potato["state"] == "to_buy"
    total = g["progress"]["total"]
    # Cover it: the done count goes up, the line is "covered".
    g = put_have(client, h, POTATO, 6).json()
    assert items_by_name(g)["potato"]["state"] == "covered"
    assert g["progress"]["done"] == 1 and g["progress"]["total"] == total
    # Editing and clearing at any time.
    g = put_have(client, h, POTATO, 2).json()
    assert items_by_name(g)["potato"]["parts"][0]["remaining"] == 4 and g["progress"]["done"] == 0
    for clear in (None, 0):
        put_have(client, h, POTATO, 2)
        g = put_have(client, h, POTATO, clear).json()
        potato = items_by_name(g)["potato"]
        assert potato["parts"][0]["have"] == 0 and not potato["hasHave"] and potato["remainingLabel"] == "6"


def test_have_is_independent_from_purchases(client, register, db):
    h = setup_stew(client, register, db)
    put_have(client, h, POTATO, 3)
    # Checking the line off buys what is still needed (3), not the full 6.
    g = client.post("/api/groceries/mark", headers=h, json={"key": "potato"}).json()
    potato = items_by_name(g)["potato"]
    assert potato["parts"][0]["purchased"] == 3 and potato["parts"][0]["have"] == 3 and potato["state"] == "in_cart"
    # Lowering have re-opens the line for the difference; the purchase is untouched.
    potato = items_by_name(put_have(client, h, POTATO, 1).json())["potato"]
    assert potato["parts"][0]["purchased"] == 3 and potato["parts"][0]["remaining"] == 2 and potato["state"] == "to_buy"
    # Unchecking drops the purchase and keeps what is at home.
    g = client.post("/api/groceries/unmark", headers=h, json={"key": "potato"}).json()
    part = items_by_name(g)["potato"]["parts"][0]
    assert part["purchased"] == 0 and part["have"] == 1


def test_have_unit_conversion_and_family_validation(client, register, db):
    h = setup_stew(client, register, db)
    beef = items_by_name(put_have(client, h, "beef|mass", 0.2, "kg").json())["beef"]["parts"][0]
    assert beef["have"] == 200 and beef["remaining"] == 300
    g = put_have(client, h, "beef|mass", 8, "oz").json()
    assert round(items_by_name(g)["beef"]["parts"][0]["have"]) == 227
    assert put_have(client, h, "beef|mass", 1, "cup").status_code == 400  # volume unit on a mass part
    assert put_have(client, h, POTATO, 1, "kg").status_code == 400
    assert put_have(client, h, "beef|mass", -1).status_code == 422
    assert put_have(client, h, "beef|mass", 1e9).status_code == 422
    assert put_have(client, h, "thyme|unquantified", 1).status_code == 400
    assert put_have(client, h, "unicorn|mass", 1).status_code == 404
    assert put_have(client, h, "beef|volume", 1, "ml").status_code == 404  # family not needed for beef
    assert client.put("/api/groceries/have", headers=h, json={"quantity": 1}).status_code == 422


def test_stale_have_is_memory_and_returns_with_the_plan(client, register, db):
    h = setup_stew(client, register, db)
    put_have(client, h, POTATO, 3)
    entry_id = client.get("/api/plan?start=2026-10-19&end=2026-10-25", headers=h).json()[0]["id"]
    client.delete(f"/api/plan/{entry_id}", headers=h)
    g = client.get("/api/groceries", headers=h).json()
    assert "potato" not in items_by_name(g)
    assert [m["key"] for m in g["atHome"]] == [POTATO]
    # The plan comes back: the amount is on the line again and the memory is empty.
    client.post("/api/plan", headers=h, json={"date": "2026-10-22", "slot": "dinner", "recipeId": "stew", "servings": 2})
    g = client.get("/api/groceries", headers=h).json()
    assert items_by_name(g)["potato"]["parts"][0]["have"] == 3 and g["atHome"] == []
    # Clearing the memory works for a key that is no longer needed.
    entry_id = client.get("/api/plan?start=2026-10-19&end=2026-10-25", headers=h).json()[0]["id"]
    client.delete(f"/api/plan/{entry_id}", headers=h)
    g = put_have(client, h, POTATO, None).json()
    assert g["atHome"] == []


def test_new_shop_starts_without_have(client, register, db):
    h = setup_stew(client, register, db)
    put_have(client, h, POTATO, 3)
    g = client.post("/api/groceries/new-shop", headers=h, json={"start": "2026-10-21", "end": "2026-10-25"}).json()
    assert items_by_name(g)["potato"]["parts"][0]["have"] == 0 and g["atHome"] == []


def test_have_is_household_scoped_and_live(client, register, db):
    h = setup_stew(client, register, db, "anna")
    stranger = register("zed")
    client.get("/api/groceries?today=2026-10-21", headers=stranger)
    assert put_have(client, stranger, POTATO, 3).status_code == 404  # not on zed's list
    assert items_by_name(client.get("/api/groceries", headers=h).json())["potato"]["parts"][0]["have"] == 0
    # A housemate sees it, and the event is logged for polling.
    code = client.get("/api/household", headers=h).json()["inviteCode"]
    ben = register("ben")
    client.post("/api/household/join", headers=ben, json={"code": code})
    cursor = client.get("/api/household/activity", headers=ben).json()["events"][-1]["id"]
    put_have(client, h, POTATO, 3)
    events = client.get(f"/api/household/activity?since={cursor}", headers=ben).json()["events"]
    ev = [e for e in events if e["type"] == "groceries.have"]
    assert len(ev) == 1 and ev[0]["payload"]["key"] == "potato" and ev[0]["payload"]["amount"]["number"] == "3"
    assert items_by_name(client.get("/api/groceries", headers=ben).json())["potato"]["parts"][0]["have"] == 3
    put_have(client, h, POTATO, None)
    events = client.get(f"/api/household/activity?since={ev[0]['id']}", headers=ben).json()["events"]
    assert events[-1]["type"] == "groceries.have" and events[-1]["payload"]["cleared"] is True


def test_staple_need_have_undo_and_pantry_state(client, register, db):
    h = setup_stew(client, register, db)
    oil = items_by_name(client.get("/api/groceries", headers=h).json())["olive oil"]
    assert oil["staple"] and oil["pantryState"] == "have" and not oil["promoted"]
    g = client.post("/api/groceries/staples", headers=h, json={"name": "olive oil", "promoted": True}).json()
    oil = items_by_name(g)["olive oil"]
    assert oil["promoted"] and not oil["staple"] and oil["pantryState"] == "need" and oil["state"] == "to_buy"
    # Put it back at any time (even after other changes), idempotently.
    put_have(client, h, POTATO, 1)
    for _ in range(2):
        g = client.post("/api/groceries/staples", headers=h, json={"name": "olive oil", "promoted": False}).json()
        oil = items_by_name(g)["olive oil"]
        assert oil["staple"] and oil["pantryState"] == "have"


def test_staple_state_is_household_scoped_and_logged(client, register, db):
    h = setup_stew(client, register, db, "anna")
    code = client.get("/api/household", headers=h).json()["inviteCode"]
    ben = register("ben")
    client.post("/api/household/join", headers=ben, json={"code": code})
    cursor = client.get("/api/household/activity", headers=ben).json()["events"][-1]["id"]
    client.post("/api/groceries/staples", headers=h, json={"name": "olive oil", "promoted": True})
    client.post("/api/groceries/staples", headers=h, json={"name": "olive oil", "promoted": False})
    events = client.get(f"/api/household/activity?since={cursor}", headers=ben).json()["events"]
    assert [e["payload"]["promoted"] for e in events if e["type"] == "groceries.staple"] == [True, False]
    # Another household never sees or changes it.
    zed = register("zed")
    client.get("/api/groceries?today=2026-10-21", headers=zed)
    client.post("/api/groceries/staples", headers=zed, json={"name": "olive oil", "promoted": True})
    assert items_by_name(client.get("/api/groceries", headers=h).json())["olive oil"]["pantryState"] == "have"


def test_share_text_uses_remaining_after_have(client, register, db):
    h = setup_stew(client, register, db)
    put_have(client, h, "beef|mass", 200, "g")
    put_have(client, h, POTATO, 6)
    text = client.get("/api/groceries/share-text", headers=h).json()["text"]
    assert "- beef: 300 g" in text and "potato" not in text


def test_have_rows_removed_with_the_household(client, register, db):
    from app.models import ShoppingHaveRow

    h = setup_stew(client, register, db)
    put_have(client, h, POTATO, 3)
    assert db.query(ShoppingHaveRow).count() == 1


# ---------- household staples from a grocery row ----------


def put_staple(client, h, name, staple=True, **kw):
    return client.post("/api/groceries/household-staples", headers=h, json={"name": name, "staple": staple, **kw})


def test_add_staple_keeps_needed_item_on_list_then_remove(client, register, db):
    h = setup_stew(client, register, db)
    assert "potato" not in client.get("/api/household", headers=h).json()["pantryStaples"]
    g = put_staple(client, h, "potato").json()
    potato = items_by_name(g)["potato"]
    # Still on the list for this shop, flagged as a staple that is needed.
    assert potato["pantryState"] == "need" and potato["promoted"] and not potato["staple"] and potato["state"] == "to_buy"
    hh = client.get("/api/household", headers=h).json()
    assert "potato" in hh["pantryStaples"] and hh["stapleNames"]["potato"]["fr"]
    assert "olive oil" in hh["pantryStaples"]  # the defaults were materialised, not lost
    # Idempotent: a second call changes nothing and logs nothing more.
    n = len(client.get("/api/household/activity", headers=h).json()["events"])
    put_staple(client, h, "potato")
    assert len(client.get("/api/household/activity", headers=h).json()["events"]) == n
    assert client.get("/api/household", headers=h).json()["pantryStaples"].count("potato") == 1
    # "I have it" tucks it into the pantry; removal makes it an ordinary item again.
    g = client.post("/api/groceries/staples", headers=h, json={"name": "potato", "promoted": False}).json()
    assert items_by_name(g)["potato"]["pantryState"] == "have"
    g = put_staple(client, h, "potato", False).json()
    potato = items_by_name(g)["potato"]
    assert potato["pantryState"] is None and not potato["staple"] and not potato["promoted"]
    assert "potato" not in client.get("/api/household", headers=h).json()["pantryStaples"]
    assert items_by_name(put_staple(client, h, "potato", False).json())["potato"]["pantryState"] is None


def test_add_staple_resolves_typos_and_undo_can_restore_pantry_state(client, register, db):
    h = setup_stew(client, register, db)
    g = put_staple(client, h, "Potatoe").json()  # typo / unnormalised key still lands on "potato"
    assert items_by_name(g)["potato"]["pantryState"] == "need"
    g = put_staple(client, h, "olive oil", False).json()
    assert items_by_name(g)["olive oil"]["pantryState"] is None
    g = put_staple(client, h, "olive oil", True, promoted=False).json()  # undo of a removal
    assert items_by_name(g)["olive oil"]["pantryState"] == "have"


def test_add_staple_not_in_plan_is_not_promoted(client, register, db):
    h = setup_stew(client, register, db)
    put_staple(client, h, "flour")
    assert "flour" in client.get("/api/household", headers=h).json()["pantryStaples"]
    g = client.get("/api/groceries", headers=h).json()
    assert "flour" not in items_by_name(g)


def test_household_staple_scoped_logged_and_validated(client, register, db):
    h = setup_stew(client, register, db, "anna")
    code = client.get("/api/household", headers=h).json()["inviteCode"]
    ben = register("ben")
    client.post("/api/household/join", headers=ben, json={"code": code})
    cursor = client.get("/api/household/activity", headers=ben).json()["events"][-1]["id"]
    put_staple(client, h, "potato")
    put_staple(client, h, "potato", False)
    events = client.get(f"/api/household/activity?since={cursor}", headers=ben).json()["events"]
    ev = [e for e in events if e["type"] == "household.staples"]
    assert [e["payload"]["added"] for e in ev] == [True, False] and ev[0]["payload"]["key"] == "potato"
    assert client.post("/api/groceries/household-staples", headers=h, json={"name": ""}).status_code == 422
    # Another household is untouched.
    zed = register("zed")
    client.get("/api/groceries?today=2026-10-21", headers=zed)
    put_staple(client, zed, "potato")
    assert "potato" not in client.get("/api/household", headers=h).json()["pantryStaples"]
    assert client.post("/api/groceries/household-staples", json={"name": "potato"}).status_code in (401, 403)
