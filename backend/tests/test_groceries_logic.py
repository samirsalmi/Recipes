"""Pure grocery logic: unit-aware merging, scaling, purchased deltas, staples, optional."""

from datetime import date, datetime

from app.groceries import Mark, build_list, collect_optional, compute_needed, format_amount, nice_number, scale_quantity
from app.ingredients import aisle_for, canonical_name, legacy_canonical_name


def entry(i, recipe_id, servings, d="2026-10-20", slot="dinner"):
    return {"id": i, "date": date.fromisoformat(d), "slot": slot, "recipe_id": recipe_id, "servings": servings}


def recipe(name, servings, ingredients):
    return {"name": name, "servings": servings, "ingredients": ingredients}


def ing(name, quantity, unit=None, optional=False):
    return {"name": name, "quantity": quantity, "unit": unit, "optional": optional}


def by_name(items):
    return {i["name"]: i for i in items}


def test_aliases_merge_across_languages():
    assert canonical_name("Oignons") == canonical_name("onion") == "onion"
    assert canonical_name("pommes de terre") == "potato"
    assert canonical_name("Huile d'olive") == "olive oil"
    assert canonical_name("Fresh Parsley, chopped") == "parsley"
    assert canonical_name("eggs") == "egg"
    assert aisle_for("chicken thighs") == "meat-fish"
    assert aisle_for("something unknown") == "other"


def test_merge_within_mass_family_and_pretty_print():
    recipes = {
        "a": recipe("A", 4, [ing("potatoes", 1, "kg")]),
        "b": recipe("B", 4, [ing("pommes de terre", 500, "g")]),
    }
    items = by_name(build_list(compute_needed([entry(1, "a", 4), entry(2, "b", 4)], recipes), {}))
    potato = items["potato"]
    assert len(potato["parts"]) == 1
    assert potato["parts"][0]["needed"] == 1500
    assert potato["neededLabel"] == "1.5 kg"
    assert {s["recipeName"] for s in potato["sources"]} == {"A", "B"}


def test_spoons_merge_and_different_families_stay_one_item():
    recipes = {
        "a": recipe("A", 2, [ing("butter", 200, "g"), ing("cumin", 1, "tsp")]),
        "b": recipe("B", 2, [ing("butter", 2, "tbsp"), ing("ground cumin", 0.5, "tbsp")]),
    }
    items = by_name(build_list(compute_needed([entry(1, "a", 2), entry(2, "b", 2)], recipes), {}))
    butter = items["butter"]
    assert sorted(p["family"] for p in butter["parts"]) == ["mass", "volume"]
    assert butter["neededLabel"] in ("200 g + 2 tbsp", "2 tbsp + 200 g")
    cumin = items["cumin"]
    assert len(cumin["parts"]) == 1
    assert cumin["parts"][0]["needed"] == 5 + 7.5
    assert cumin["neededLabel"] == "2½ tsp"


def test_count_units_do_not_merge_with_each_other():
    recipes = {"a": recipe("A", 2, [ing("garlic", 2, "clove"), ing("garlic", 1, None)])}
    items = by_name(build_list(compute_needed([entry(1, "a", 2)], recipes), {}))
    assert sorted(p["family"] for p in items["garlic"]["parts"]) == ["count:clove", "count:piece"]


def test_scaling_by_entry_servings():
    assert scale_quantity(400, 4, 6) == 600
    assert scale_quantity(None, 4, 6) is None
    recipes = {"a": recipe("A", 4, [ing("eggs", 2), ing("milk", 200, "ml")])}
    items = by_name(build_list(compute_needed([entry(1, "a", 6)], recipes), {}))
    assert items["egg"]["parts"][0]["needed"] == 3
    assert items["milk"]["neededLabel"] == "300 ml"


def test_purchased_delta_shows_more_needed():
    recipes = {"a": recipe("A", 2, [ing("eggs", 6)])}
    needed = compute_needed([entry(1, "a", 2)], recipes)
    marks = {"egg|count:piece": Mark(purchased=6)}
    assert by_name(build_list(needed, marks))["egg"]["state"] == "in_cart"
    # The plan grows after shopping: 10 eggs needed, 6 bought.
    needed = compute_needed([entry(1, "a", 2), entry(2, "a", 2, d="2026-10-21")], {"a": recipe("A", 2, [ing("eggs", 5)])})
    egg = by_name(build_list(needed, marks))["egg"]
    assert egg["state"] == "to_buy"
    assert egg["moreNeeded"] is True
    assert egg["remainingLabel"] == "4"


def test_meal_removed_after_purchase_is_no_longer_needed():
    marks = {"egg|count:piece": Mark(purchased=6), "salt|unquantified": Mark(purchased=None)}
    items = by_name(build_list({}, marks))
    assert items["egg"]["state"] == "no_longer_needed"
    assert items["egg"]["purchasedLabel"] == "6"
    assert items["salt"]["state"] == "no_longer_needed"


def test_checked_without_quantity_counts_as_bought():
    recipes = {"a": recipe("A", 2, [ing("flour", 500, "g"), ing("salt", None)])}
    needed = compute_needed([entry(1, "a", 2)], recipes)
    items = by_name(build_list(needed, {"flour|mass": Mark(purchased=None), "salt|unquantified": Mark(purchased=None)}))
    assert items["flour"]["state"] == "in_cart"
    assert items["salt"]["state"] == "in_cart"


def test_pantry_staples_and_promotion():
    recipes = {"a": recipe("A", 2, [ing("salt", None), ing("olive oil", 2, "tbsp"), ing("onion", 1)])}
    needed = compute_needed([entry(1, "a", 2)], recipes)
    items = by_name(build_list(needed, {}))  # default staples
    assert items["salt"]["staple"] and items["olive oil"]["staple"]
    assert not items["onion"]["staple"]
    items = by_name(build_list(needed, {}, staples=["salt"], promoted=["salt"]))
    assert items["salt"]["staple"] is False and items["salt"]["promoted"] is True
    assert items["olive oil"]["staple"] is False  # household removed it from its staples


def test_optional_ingredients_excluded_from_needed_but_offered():
    recipes = {"a": recipe("A", 4, [ing("rice", 300, "g"), ing("peanuts", 30, "g", optional=True)])}
    entries = [entry(1, "a", 8)]
    items = by_name(build_list(compute_needed(entries, recipes), {}))
    assert "peanuts" not in items
    assert "rice" in items
    optional = collect_optional(entries, recipes)
    assert len(optional) == 1
    assert optional[0]["name"] == "peanuts"
    assert optional[0]["amount"] == "60 g"
    assert optional[0]["recipeName"] == "A"


def test_new_dot_only_for_other_members_changes():
    recipes = {"a": recipe("A", 2, [ing("onion", 1)])}
    e = entry(1, "a", 2) | {"added_by": 2, "updated_at": datetime(2026, 10, 20, 12)}
    needed = compute_needed([e], recipes)
    assert by_name(build_list(needed, {}, seen_at=datetime(2026, 10, 20, 11), viewer_id=1))["onion"]["isNew"]
    assert not by_name(build_list(needed, {}, seen_at=datetime(2026, 10, 20, 11), viewer_id=2))["onion"]["isNew"]
    assert not by_name(build_list(needed, {}, seen_at=datetime(2026, 10, 20, 13), viewer_id=1))["onion"]["isNew"]


def test_formatting():
    assert nice_number(0.5) == "½"
    assert nice_number(1.5) == "1½"
    assert nice_number(2.0) == "2"
    assert nice_number(0.33) == "⅓"
    assert nice_number(0.2) == "¼"
    assert nice_number(0.05) == "⅛"
    assert nice_number(2.8) == "2¾"
    assert nice_number(2.6) == "2⅔"
    assert format_amount(12.5, "volume", ["tsp"]) == "2½ tsp"  # base unit is ml
    assert format_amount(750, "volume", ["ml"]) == "750 ml"
    assert format_amount(1250, "volume", ["ml"]) == "1.25 L"
    assert format_amount(3, "count:clove") == "3 cloves"
    assert format_amount(1, "count:clove") == "1 clove"
    assert format_amount(453.592, "mass", ["g"], unit_system="us") == "1 lb"


def test_counts_round_up_and_rounding_dust_is_ignored():
    assert format_amount(4.2, "count:piece") == "5"
    assert format_amount(0.5, "count:piece") == "1"
    assert format_amount(1.02, "count:piece") == "1"
    assert format_amount(0.33, "count:bunch") == "1 bunch"
    assert format_amount(0.5, "count:pinch") == "½ pinch"
    recipes = {"a": recipe("A", 3, [ing("rice", 100, "g")])}
    needed = compute_needed([entry(1, "a", 4)], recipes)  # 133.333... g
    items = by_name(build_list(needed, {"rice|mass": Mark(purchased=133.333)}))
    assert items["rice"]["state"] == "in_cart"


def test_new_dot_with_aware_and_mixed_datetimes():
    """PostgreSQL returns aware TIMESTAMPTZ values; SQLite returns naive UTC. Both must compare."""
    from datetime import timezone

    recipes = {"a": recipe("A", 2, [ing("onion", 1)])}
    aware = entry(1, "a", 2) | {"added_by": 2, "updated_at": datetime(2026, 10, 20, 12, tzinfo=timezone.utc)}
    needed = compute_needed([aware], recipes)
    seen_aware = datetime(2026, 10, 20, 11, tzinfo=timezone.utc)
    assert by_name(build_list(needed, {}, seen_at=seen_aware, viewer_id=1))["onion"]["isNew"]
    # Mixed: aware source vs naive seen_at (and the reverse) must not raise.
    assert by_name(build_list(needed, {}, seen_at=datetime(2026, 10, 20, 13), viewer_id=1))["onion"]["isNew"] is False
    naive = entry(1, "a", 2) | {"added_by": 2, "updated_at": datetime(2026, 10, 20, 12)}
    assert by_name(build_list(compute_needed([naive], recipes), {}, seen_at=seen_aware, viewer_id=1))["onion"]["isNew"]
    # Sources serialise with an explicit UTC offset.
    assert by_name(build_list(needed, {}))["onion"]["sources"][0]["updatedAt"].endswith("+00:00")


def test_typos_resolve_to_canonical_names():
    for typo, expected in [
        ("buttter", "butter"), ("bUtter", "butter"), ("Buttter ", "butter"), ("tomatoe", "tomato"),
        ("chiken breast", "chicken breast"), ("flour,", "flour"), ("buter", "butter"),
        ("onoin", "onion"), ("2 buttter", "butter"), ("buttters", "butter"),
    ]:
        assert canonical_name(typo) == expected, typo
    assert aisle_for("buttter") == "dairy-eggs"
    assert aisle_for("chiken breast") == "meat-fish"


def test_near_misses_that_must_not_merge():
    assert canonical_name("pear") == "pear"
    assert canonical_name("pears") != "peas"
    assert canonical_name("lime") == "lime" and canonical_name("lemon") == "lemon"
    assert canonical_name("melon") == "melon"
    assert canonical_name("oil") != "foil" and canonical_name("foil") == "aluminum foil"
    assert canonical_name("peach") == "peach"
    assert canonical_name("salt") == "salt" and canonical_name("malt") == "malt"
    assert canonical_name("basel") == "basel"  # equidistant from basil and basal(onion): ambiguous


def test_typo_merges_with_correct_spelling_and_uses_derived_aisle():
    recipes = {
        "a": recipe("A", 2, [ing("butter", 100, "g")]),
        "b": recipe("B", 2, [{**ing("buttter", 50, "g"), "aisle": "other"}]),  # stored by the old code
    }
    items = build_list(compute_needed([entry(1, "a", 2), entry(2, "b", 2)], recipes), {})
    assert [i["name"] for i in items] == ["butter"]
    assert items[0]["aisle"] == "dairy-eggs"


# ---------- canonical keys are stable; legacy marks are honored ----------


def _curated_names():
    import json
    from pathlib import Path

    from app.ingredients import _DICTIONARY

    names = set()
    for k, (_a, _s, aliases) in _DICTIONARY.items():
        names.add(k)
        names.update(aliases)
    for f in (Path(__file__).resolve().parents[2] / "content" / "recipes").glob("*.json"):
        def walk(o):
            if isinstance(o, dict):
                for ing_ in o.get("ingredients", []) if isinstance(o.get("ingredients"), list) else []:
                    if isinstance(ing_, dict) and ing_.get("name"):
                        names.add(ing_["name"])
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(json.loads(f.read_text(encoding="utf8")))
    return names


# The only curated spellings whose key changed, each deliberately (explicit chili aliases).
CHILI_CHANGES = {
    "dried red chillies": "chili pepper",
    "green chilli": "chili pepper",
    "green chillies": "chili pepper",
    "red chile flakes": "chili powder",
    "red chilli": "chili pepper",
    "red chillies": "chili pepper",
    "red chilli flakes": "chili powder",
}


def test_fuzzy_never_changes_a_curated_name():
    from app.ingredients import normalize_text

    assert len(_curated_names()) > 500
    from app.ingredients import _DICTIONARY_V1

    changed = {}
    for n in _curated_names():
        text = normalize_text(n)
        if not text or " or " in text:
            continue
        # Only names the original dictionary already resolved are protected: a spelling that
        # used to be its own unknown line may later be recognized (new French/Arabic/English
        # names), which legacy_canonical_name() / legacy mark keys cover.
        if legacy_canonical_name(n) in _DICTIONARY_V1 and canonical_name(n) != legacy_canonical_name(n):
            changed[n] = canonical_name(n)
    assert changed == {}
    # The chili variants are the deliberate exceptions (they were their own lines before).
    assert {n: canonical_name(n) for n in CHILI_CHANGES} == CHILI_CHANGES


def test_chili_variants():
    for n in ("chilli", "chile", "green chilli", "red chillies", "green chillies", "chili pepper"):
        assert canonical_name(n) == "chili pepper", n
    for n in ("chili flakes", "red chile flakes", "red chilli flakes"):
        assert canonical_name(n) == canonical_name("chili flakes"), n
    assert canonical_name("chili powder") == "chili powder"


def test_legacy_mark_still_checks_the_merged_line():
    recipes = {"a": recipe("A", 2, [ing("green chilli", 2), ing("green chillies", 1)])}
    needed = compute_needed([entry(1, "a", 2)], recipes)
    assert list(needed) == ["chili pepper"]
    legacy = "green chilli|count:piece"
    assert legacy in needed["chili pepper"].parts["chili pepper|count:piece"].legacy_keys
    items = build_list(needed, {legacy: Mark(purchased=2)})
    assert [i["name"] for i in items] == ["chili pepper"]  # mark is not an orphan line
    assert items[0]["parts"][0]["purchased"] == 2 and items[0]["parts"][0]["remaining"] == 1
    # Unquantified legacy check, and the current key winning without double counting.
    whole = build_list(needed, {legacy: Mark(purchased=None)})
    assert whole[0]["state"] == "in_cart"
    both = build_list(needed, {legacy: Mark(purchased=2), "chili pepper|count:piece": Mark(purchased=1)})
    assert both[0]["parts"][0]["purchased"] == 1 and len(both) == 1


def test_unrelated_marks_stay_orphans():
    needed = compute_needed([entry(1, "a", 2)], {"a": recipe("A", 2, [ing("green chilli", 2)])})
    items = by_name(build_list(needed, {"saffron|count:piece": Mark(purchased=None)}))
    assert items["saffron"]["state"] == "no_longer_needed"


def test_typos_still_resolve_and_negatives_do_not_merge():
    for a, b in [("buttter", "butter"), ("bUtter", "butter"), ("tomatoe", "tomato"), ("chiken breast", "chicken breast"),
                 ("buter", "butter"), ("onoin", "onion"), ("2 buttter", "butter")]:
        assert canonical_name(a) == canonical_name(b), a
    assert aisle_for("buttter") == "dairy-eggs"
    for a, b in [("pear", "peas"), ("lime", "lemon"), ("oil", "foil"), ("salt", "malt"),
                 ("beef steak", "beef stock"), ("coconut oil", "coconut milk")]:
        assert canonical_name(a) != canonical_name(b), (a, b)


def test_small_cup_is_a_120_ml_volume_unit():
    from app.groceries import normalize_unit, unit_family

    assert normalize_unit("فنجان") == "small cup"
    assert normalize_unit("coffee cup") == "small cup"
    assert normalize_unit("cup") == "cup" and normalize_unit("كوب") == "cup"
    assert unit_family("small cup", 2) == ("volume", "ml", 120.0)
    assert unit_family("cup", 1) == ("volume", "ml", 240.0)
    assert format_amount(240, "volume", ["small cup"]) == "2 small cup"
    assert format_amount(360, "volume", ["small cup", "cup"]) == "1½ cup"


def test_small_cup_merges_with_cups_and_ml():
    from app.groceries import unit_family

    total = 0.0
    for qty, unit in [(2, "فنجان"), (1, "cup"), (100, "ml")]:
        family, base, factor = unit_family(unit, qty)
        assert (family, base) == ("volume", "ml")
        total += qty * factor
    assert total == 580.0
