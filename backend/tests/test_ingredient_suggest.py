"""Ingredient type-ahead: ranking across English/French/Arabic, normalization, typos, the
household's custom ingredients, the strict exact match behind auto-translate, unit spellings."""

import pytest

from app.groceries import normalize_unit
from app.ingredient_suggest import exact_match, suggest_ingredients


def names(query, lang="en", custom=None, limit=6):
    return [i["name"] for i in suggest_ingredients(query, lang, custom, limit)]


def test_cross_language_names_are_shown_in_the_reader_language():
    first = suggest_ingredients("fromage", "en")[0]
    assert first["canonical"] == "cheese" and first["name"] == "cheese"
    assert first["matched"] == "fromage"  # the alias typed is shown when it differs
    assert first["match"] == "exact" and first["names"]["fr"] == "fromage" and first["aisle"] == "dairy-eggs"
    assert suggest_ingredients("cheese", "fr")[0]["name"] == "fromage"
    assert suggest_ingredients("cheese", "ar")[0]["name"] == "جبن"
    # no "matched" noise when the typed text is the displayed name
    assert suggest_ingredients("butter", "en")[0]["matched"] is None


def test_exact_and_prefix_come_before_partial_and_fuzzy():
    result = suggest_ingredients("butter", "en")
    assert result[0]["canonical"] == "butter" and result[0]["match"] == "exact"
    assert all(i["match"] != "fuzzy" for i in result[:2])
    assert suggest_ingredients("zaa", "en")[0]["canonical"] == "za'atar"
    pre = suggest_ingredients("chick", "en")
    assert pre[0]["match"] == "prefix"
    assert len(suggest_ingredients("a", "en")) == 0  # one character is not a query
    assert len(suggest_ingredients("ch", "en", limit=3)) <= 3


def test_typos_suggest_but_only_when_there_is_room():
    assert names("buttr")[0] == "butter"
    assert names("chiken", "fr")[0] == "poulet"
    assert names("olve oil")[0] == "olive oil"
    assert suggest_ingredients("buttr")[0]["match"] == "fuzzy"
    assert suggest_ingredients("zzzzqq") == []


def test_accents_case_and_arabic_variants_are_folded():
    assert names("CREME") == names("crème") == names("créme")
    assert suggest_ingredients("زبد", "fr")[0]["name"] == "beurre"
    assert suggest_ingredients("الزبدة", "en")[0]["canonical"] == "butter"  # article dropped
    assert suggest_ingredients("زُبْدَة", "en")[0]["canonical"] == "butter"  # tashkeel
    assert suggest_ingredients("طماطه", "en")[0]["canonical"] == "tomato"  # ة/ه fold
    assert suggest_ingredients("l'oignon", "en")[0]["canonical"] == "onion"
    assert suggest_ingredients("la farine", "en")[0]["canonical"] == "flour"


def test_one_result_per_ingredient_and_limit():
    result = suggest_ingredients("fromage", "fr", limit=6)
    canon = [i["canonical"] for i in result]
    assert len(canon) == len(set(canon)) <= 6
    assert len(suggest_ingredients("a" * 2, "en", limit=1)) <= 1


def test_household_custom_ingredients_are_suggested():
    custom = {"sumac blend": "spices", "ماء الزهر الخاص": "drinks"}
    result = suggest_ingredients("sumac b", "en", custom)
    assert result[0]["custom"] is True and result[0]["name"] == "sumac blend" and result[0]["aisle"] == "spices"
    assert result[0]["known"] is False
    ar = suggest_ingredients("ماء الزهر خ", "ar", custom)
    assert any(i["custom"] and i["aisle"] == "drinks" for i in ar)
    # a dictionary ingredient is never duplicated by a custom row of the same name
    dup = suggest_ingredients("butter", "en", {"butter": "pantry"})
    assert [i["canonical"] for i in dup].count("butter") == 1


def test_exact_match_is_strict():
    assert exact_match("Fromage")[0] == "cheese"
    assert exact_match("la farine")[0] == "flour"  # leading French article
    assert exact_match("buttter") is None  # typo: never rewritten
    assert exact_match("finely chopped basil") is None  # descriptor stripping is not "exact"
    assert exact_match("zorblax") is None
    canonical, languages = exact_match("fromage")
    assert "fr" in languages


def test_unit_spellings_normalise():
    table = {
        "tbsp": ["table spoon", "Table Spoons", "tablespoon", "tbs", "T", "soup spoon", "big spoon", "large spoon",
                 "cuillère à soupe", "c. à s.", "grande cuillère", "ملعقة كبيرة", "ملعقة طعام"],
        "tsp": ["tea spoon", "teaspoon", "tsp", "small spoon", "little spoon", "coffee spoon",
                "cuillère à café", "c. à c.", "cac", "petite cuillère", "ملعقة صغيرة", "ملعقة شاي"],
        "cup": ["cup", "glass", "verre", "tasse", "كوب"],
        "small cup": ["small cup", "coffee cup", "tea cup", "teacup", "demi-tasse", "tasse à café", "tasse à thé",
                      "petite tasse", "كوب صغير", "فنجان", "فناجين"],
        "pinch": ["pinch", "pincée", "رشة"],
        "clove": ["clove", "gousse", "فص"],
        "bunch": ["bunch", "botte", "حزمة"],
        "can": ["can", "tin", "boîte"],
        "handful": ["handful", "poignée", "قبضة", "حفنة"],
    }
    for code, spellings in table.items():
        for spelling in spellings:
            assert normalize_unit(spelling) == code, spelling
    assert normalize_unit("dessert spoon") == "dessert spoon"  # ~2 tsp: left as typed here


def test_ingredient_check_reports_exact_matches(client, register):
    h = register("anna")
    items = {i["name"]: i for i in client.post("/api/recipes/ingredient-check", headers=h, json={"names": ["fromage", "buttter", "tomatoes"]}).json()["items"]}
    assert items["fromage"]["exact"] is True and "fr" in items["fromage"]["languages"]
    assert items["buttter"]["known"] is True and items["buttter"]["exact"] is False


def test_suggest_endpoint(client, register):
    a, b = register("anna"), register("ben")
    assert client.get("/api/recipes/ingredient-suggest?q=fromage").status_code == 401
    res = client.get("/api/recipes/ingredient-suggest?q=fromage&lang=fr", headers=a)
    assert res.status_code == 200
    first = res.json()["items"][0]
    assert first["canonical"] == "cheese" and first["name"] == "fromage"
    assert len(client.get("/api/recipes/ingredient-suggest?q=ch&limit=3", headers=a).json()["items"]) <= 3
    assert client.get("/api/recipes/ingredient-suggest?q=ch&lang=xx", headers=a).status_code == 200  # falls back to English
    # the household's remembered custom ingredient shows up, for its own household only
    client.put("/api/recipes/ingredient-aisles", headers=a, json={"name": "Sumac blend", "aisle": "spices"})
    mine = client.get("/api/recipes/ingredient-suggest?q=sumac%20bl", headers=a).json()["items"]
    assert mine and mine[0]["custom"] is True and mine[0]["aisle"] == "spices"
    theirs = client.get("/api/recipes/ingredient-suggest?q=sumac%20bl", headers=b).json()["items"]
    assert all(not i["custom"] for i in theirs)
