"""Households: membership checks, join + merge rule, leave/remove, invite codes, activity."""

from datetime import date, timedelta

from tests.conftest import add_system_recipe

TODAY = date(2026, 10, 21)  # a Wednesday


def test_register_creates_personal_household(client, register):
    h = register("samir", "Samir Salmi")
    res = client.get("/api/household", headers=h)
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Samir's kitchen"
    assert body["myRole"] == "owner"
    assert len(body["inviteCode"]) == 8
    assert [m["username"] for m in body["members"]] == ["samir"]


def test_household_endpoints_require_auth(client):
    for method, path in [("get", "/api/household"), ("get", "/api/plan?start=2026-10-19&end=2026-10-25"),
                         ("get", "/api/groceries"), ("get", "/api/favorites"), ("get", "/api/household/activity")]:
        assert getattr(client, method)(path).status_code == 401


def test_user_a_cannot_touch_household_b(client, register, db):
    add_system_recipe(db, "soup")
    a, b = register("alice"), register("bob")
    entry = client.post("/api/plan", headers=b, json={"date": "2026-10-21", "slot": "dinner", "recipeId": "soup"}).json()
    # Alice can't see, edit or delete Bob's plan entry.
    assert client.get("/api/plan?start=2026-10-19&end=2026-10-25", headers=a).json() == []
    assert client.patch(f"/api/plan/{entry['id']}", headers=a, json={"servings": 9}).status_code == 404
    assert client.delete(f"/api/plan/{entry['id']}", headers=a).status_code == 404
    # ...nor Bob's grocery extras.
    client.get("/api/groceries?today=2026-10-21", headers=b)
    extra = client.post("/api/groceries/extras", headers=b, json={"name": "paper towels"}).json()["extras"][0]
    client.get("/api/groceries?today=2026-10-21", headers=a)
    assert client.patch(f"/api/groceries/extras/{extra['id']}", headers=a, json={"checked": True}).status_code == 404
    assert client.delete(f"/api/groceries/extras/{extra['id']}", headers=a).status_code == 404
    # ...nor remove Bob from his household.
    bob_id = client.get("/api/household", headers=b).json()["myUserId"]
    assert client.delete(f"/api/household/members/{bob_id}", headers=a).status_code == 404
    # ...nor read Bob's activity.
    assert client.get("/api/household/activity", headers=a).json()["events"] == []
    assert client.get(f"/api/plan?start=2026-10-19&end=2026-10-25", headers=b).json()[0]["servings"] != 9


def test_join_merges_future_entries_when_alone(client, register, db):
    add_system_recipe(db, "soup")
    owner, joiner = register("owner"), register("joiner")
    code = client.get("/api/household", headers=owner).json()["inviteCode"]
    old_household = client.get("/api/household", headers=joiner).json()["id"]
    past = (TODAY - timedelta(days=2)).isoformat()
    future = (TODAY + timedelta(days=1)).isoformat()
    client.post("/api/plan", headers=joiner, json={"date": past, "slot": "dinner", "recipeId": "soup"})
    client.post("/api/plan", headers=joiner, json={"date": future, "slot": "lunch", "recipeId": "soup"})
    client.post("/api/plan", headers=joiner, json={"date": TODAY.isoformat(), "slot": "dinner", "customTitle": "Leftovers"})

    res = client.post("/api/household/join", headers=joiner, json={"code": code.lower(), "today": TODAY.isoformat()})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["myRole"] == "member"
    assert len(body["members"]) == 2
    entries = client.get(f"/api/plan?start={past}&end={future}", headers=owner).json()
    assert sorted((e["date"], e["slot"]) for e in entries) == [(TODAY.isoformat(), "dinner"), (future, "lunch")]
    # The old one-person household is gone.
    from app.models import HouseholdRow

    assert db.get(HouseholdRow, old_household) is None
    # Join shows up in the owner's activity feed.
    events = client.get("/api/household/activity", headers=owner).json()["events"]
    assert any(e["type"] == "household.join" for e in events)


def test_join_from_shared_household_passes_ownership(client, register):
    a, b, c = register("anna"), register("ben"), register("cleo")
    code_a = client.get("/api/household", headers=a).json()["inviteCode"]
    client.post("/api/household/join", headers=b, json={"code": code_a})
    code_c = client.get("/api/household", headers=c).json()["inviteCode"]
    # Anna (owner, not alone) leaves for Cleo's household; Ben becomes owner of the old one.
    client.post("/api/household/join", headers=a, json={"code": code_c})
    ben = client.get("/api/household", headers=b).json()
    assert ben["myRole"] == "owner"
    assert [m["username"] for m in ben["members"]] == ["ben"]


def test_join_rejects_bad_or_own_code(client, register):
    a = register("anna")
    own = client.get("/api/household", headers=a).json()["inviteCode"]
    assert client.post("/api/household/join", headers=a, json={"code": own}).status_code == 400
    assert client.post("/api/household/join", headers=a, json={"code": "NOPE2345"}).status_code == 404


def test_owner_only_actions_and_leave(client, register):
    owner, member = register("owner"), register("member")
    code = client.get("/api/household", headers=owner).json()["inviteCode"]
    client.post("/api/household/join", headers=member, json={"code": code})
    assert client.post("/api/household/invite-code", headers=member).status_code == 403
    new_code = client.post("/api/household/invite-code", headers=owner).json()["inviteCode"]
    assert new_code != code
    owner_id = client.get("/api/household", headers=owner).json()["myUserId"]
    assert client.delete(f"/api/household/members/{owner_id}", headers=member).status_code == 403

    # Member leaves -> gets a fresh personal household.
    left = client.post("/api/household/leave", headers=member).json()
    assert left["myRole"] == "owner" and len(left["members"]) == 1
    # Owner can't leave a household they're alone in.
    assert client.post("/api/household/leave", headers=owner).status_code == 400

    # Owner removes a member.
    client.post("/api/household/join", headers=member, json={"code": new_code})
    member_id = client.get("/api/household", headers=member).json()["myUserId"]
    res = client.delete(f"/api/household/members/{member_id}", headers=owner)
    assert res.status_code == 200 and len(res.json()["members"]) == 1
    assert client.get("/api/household", headers=member).json()["members"][0]["username"] == "member"


def test_settings_update_and_validation(client, register):
    h = register("cook")
    res = client.patch("/api/household", headers=h, json={"size": 4, "diet": ["vegetarian", "no-pork"], "units": "us", "pantryStaples": ["Sel", "olive oil"]})
    assert res.status_code == 200
    body = res.json()
    assert body["size"] == 4 and body["units"] == "us"
    assert body["diet"] == ["no-pork", "vegetarian"]
    assert body["pantryStaples"] == ["olive oil", "salt"]
    assert client.patch("/api/household", headers=h, json={"diet": ["carnivore"]}).status_code == 422


def test_activity_cursor(client, register, db):
    add_system_recipe(db, "soup")
    a, b = register("anna"), register("ben")
    code = client.get("/api/household", headers=a).json()["inviteCode"]
    client.post("/api/household/join", headers=b, json={"code": code})
    cursor = client.get("/api/household/activity", headers=a).json()["cursor"]
    client.post("/api/plan", headers=b, json={"date": "2026-10-22", "slot": "dinner", "recipeId": "soup"})
    res = client.get(f"/api/household/activity?since={cursor}", headers=a).json()
    assert [e["type"] for e in res["events"]] == ["plan.add"]
    assert res["events"][0]["userName"] == "Ben"
    assert "Soup" in res["events"][0]["payload"]["summary"]
    assert client.get(f"/api/household/activity?since={res['cursor']}", headers=a).json()["events"] == []


def test_login_and_me_recreate_a_missing_household(client, register, db):
    from app.models import HouseholdMemberRow

    h = register("orphan")
    user_id = client.get("/api/auth/me", headers=h).json()["id"]
    db.delete(db.get(HouseholdMemberRow, user_id))
    db.commit()
    res = client.post("/api/auth/login", json={"username": "orphan", "password": "password123"})
    assert res.status_code == 200
    db.expire_all()
    assert db.get(HouseholdMemberRow, user_id) is not None
