"""English / French / Modern Standard Arabic ingredient names: resolution, normalization,
units, merging across languages, aisles, the household aisle memory, and legacy mark keys."""

from datetime import date

import pytest

from app.groceries import Mark, build_list, compute_needed, normalize_unit, unit_family
from app.ingredient_names import NAMES
from app.ingredients import (
    _DICTIONARY,
    aisle_for,
    aisle_info,
    canonical_name,
    fuzzy_match,
    is_known,
    legacy_canonical_name,
    normalize_text,
)
from app.recipe_data import stamp_ingredients
from tests.conftest import add_system_recipe


def entry(i, recipe_id, servings, d="2026-10-21"):
    return {"id": i, "date": date.fromisoformat(d), "slot": "dinner", "recipe_id": recipe_id, "servings": servings}


def recipe(servings, ingredients):
    return {"name": "R", "servings": servings, "ingredients": ingredients}


def ing(name, quantity=None, unit=None, **extra):
    return {"name": name, "quantity": quantity, "unit": unit, **extra}


# ---------- dictionary coverage ----------


def test_every_canonical_ingredient_has_french_and_arabic_names():
    assert len(_DICTIONARY) >= 230
    missing = [k for k in _DICTIONARY if not NAMES.get(k, ([], []))[0] or not NAMES[k][1]]
    assert missing == []
    # Arabic names are pure Arabic script (digits aside): no Latin transliterations, no mixing.
    for canonical, (_fr, ar) in NAMES.items():
        for name in ar:
            letters = [c for c in name if c.isalpha()]
            assert letters and all("؀" <= c <= "ۿ" for c in letters), (canonical, name)


@pytest.mark.parametrize("name,canonical,aisle", [
    ("beurre", "butter", "dairy-eggs"),
    ("زبدة", "butter", "dairy-eggs"),
    ("lait", "milk", "dairy-eggs"),
    ("حليب", "milk", "dairy-eggs"),
    ("œufs", "egg", "dairy-eggs"),
    ("oeuf", "egg", "dairy-eggs"),
    ("بيض", "egg", "dairy-eggs"),
    ("farine", "flour", "pantry"),
    ("طحين", "flour", "pantry"),
    ("دقيق", "flour", "pantry"),
    ("semoule", "semolina", "pantry"),
    ("سميد", "semolina", "pantry"),
    ("oignon", "onion", "produce"),
    ("بصل", "onion", "produce"),
    ("ail", "garlic", "produce"),
    ("ثوم", "garlic", "produce"),
    ("poulet", "chicken", "meat-fish"),
    ("دجاج", "chicken", "meat-fish"),
    ("agneau", "lamb", "meat-fish"),
    ("لحم ضأن", "lamb", "meat-fish"),
    ("لحم ضان", "lamb", "meat-fish"),
    ("boeuf", "beef", "meat-fish"),
    ("bœuf", "beef", "meat-fish"),
    ("لحم بقر", "beef", "meat-fish"),
    ("huile d'olive", "olive oil", "pantry"),
    ("زيت الزيتون", "olive oil", "pantry"),
    ("pommes de terre", "potato", "produce"),
    ("بطاطس", "potato", "produce"),
    ("sel", "salt", "spices"),
    ("ملح", "salt", "spices"),
    ("poivre noir", "black pepper", "spices"),
    ("فلفل أسود", "black pepper", "spices"),
    ("cumin", "cumin", "spices"),
    ("كمون", "cumin", "spices"),
    ("pois chiches", "chickpeas", "pantry"),
    ("حمص", "chickpeas", "pantry"),
    ("eau de rose", "rose water", "pantry"),
    ("ماء الورد", "rose water", "pantry"),
    ("citron", "lemon", "produce"),
    ("ليمون", "lemon", "produce"),
    ("thé vert", "tea", "drinks"),
    ("شاي أخضر", "tea", "drinks"),
    ("sacs poubelle", "trash bags", "household"),
])
def test_french_and_arabic_names_resolve_to_english_canonical_and_aisle(name, canonical, aisle):
    assert canonical_name(name) == canonical
    assert aisle_for(name) == aisle
    assert is_known(name)


@pytest.mark.parametrize("name,canonical", [
    ("la farine", "flour"),
    ("le beurre", "butter"),
    ("les oignons", "onion"),
    ("l'ail", "garlic"),
    ("farine de blé", "flour"),
    ("de la farine", "flour"),
    ("Oignons ROUGES", "red onion"),
    ("crème fraîche", "creme fraiche"),
    ("poivre de Cayenne", "chili powder"),
    ("الزبدة", "butter"),
    ("الطحين", "flour"),
    ("البصل الأحمر", "red onion"),
    ("زبدة", "butter"),
    ("زُبْدَة", "butter"),  # tashkeel
    ("زبــدة", "butter"),  # tatweel
    ("اللحم المفروم", "ground beef"),
    ("بصل مفروم", "onion"),  # prep word dropped
    ("ثوم مفروم ناعم", "garlic"),
    ("beurre ou margarine", "butter"),
])
def test_articles_particles_and_diacritics_are_ignored(name, canonical):
    assert canonical_name(name) == canonical


def test_english_still_works_and_merges_with_the_other_languages():
    assert canonical_name("Butter") == canonical_name("beurre") == canonical_name("زبدة") == "butter"
    assert canonical_name("chicken breast") == canonical_name("blanc de poulet") == canonical_name("صدر دجاج")
    assert canonical_name("turmeric powder") == "turmeric"
    assert canonical_name("noix de coco") == canonical_name("جوز الهند") == "coconut"


# ---------- normalization ----------


def test_normalize_text_folds_french_and_arabic():
    assert normalize_text("Crème Brûlée") == "creme brulee"
    assert normalize_text("Œufs") == "oeufs"
    assert normalize_text("d’ail") == "d ail"
    assert normalize_text("أ إ آ") == "ا ا ا"
    assert normalize_text("مَاءٌ") == normalize_text("ماء")
    assert normalize_text("على") == normalize_text("علي")  # ى -> ي
    assert normalize_text("زبدة") == normalize_text("زبده")  # ة -> ه
    assert normalize_text("الزبدة") == normalize_text("زبدة")
    assert normalize_text("زيت الزيتون") == "زيت زيتون"
    assert normalize_text("٣ بيضات") == "3 بيضات"
    assert normalize_text("بصل، مقطع") == "بصل"  # Arabic comma starts a note
    assert normalize_text("ﬁsh") == "fish"  # NFKC ligature


def test_unreadable_before_means_empty_legacy_name_but_known_now():
    assert legacy_canonical_name("زبدة") == ""  # Arabic vanished under the old normalization
    assert canonical_name("زبدة") == "butter"


# ---------- fuzzy: same language only, conservative ----------


def test_fuzzy_typos_stay_inside_their_script_and_stay_conservative():
    assert canonical_name("beurrre") == "butter"  # French typo
    assert canonical_name("farinne") == "flour"
    assert canonical_name("زيت الزيتونن") == "olive oil"  # Arabic typo (long, multi-word)
    assert fuzzy_match("زبدا") is None  # short Arabic words never fuzzy-match
    assert fuzzy_match("بصلل") is None
    # Never crosses scripts: Latin never matches an Arabic alias and vice versa.
    assert fuzzy_match("zeet zeytoon") is None
    # Two canonicals at the same distance: no match.
    assert fuzzy_match("chicken stocj") in (None, "chicken stock")


def test_names_that_already_resolved_keep_their_key():
    # The first English dictionary's spellings and its fuzzy typos are untouched.
    for name, canonical in [
        ("buttter", "butter"), ("tomatoe", "tomato"), ("chiken breast", "chicken breast"),
        ("Oignons", "onion"), ("olive oil", "olive oil"), ("green chilli", "chili pepper"),
    ]:
        assert canonical_name(name) == canonical, name


# ---------- negative merges ----------


@pytest.mark.parametrize("name,not_canonical,canonical", [
    ("beurre de cacahuète", "butter", "peanut butter"),
    ("زبدة الفول السوداني", "butter", "peanut butter"),
    ("lait de coco", "milk", "coconut milk"),
    ("حليب جوز الهند", "milk", "coconut milk"),
    ("جوز الهند", "walnuts", "coconut"),
    ("جوزة الطيب", "walnuts", "nutmeg"),
    ("huile d'olive", "vegetable oil", "olive oil"),
    ("زيت السمسم", "vegetable oil", "sesame oil"),
    ("bouillon de poulet", "chicken", "chicken stock"),
    ("مرق دجاج", "chicken", "chicken stock"),
    ("poivron rouge", "chili pepper", "red bell pepper"),
    ("فلفل حار", "bell pepper", "chili pepper"),
    ("oignon vert", "onion", "spring onion"),
    ("eau de rose", "water", "rose water"),
    ("gingembre moulu", "ginger", "ginger powder"),
    ("agneau haché", "lamb", "ground lamb"),
    ("زعتر أخضر", "za'atar", "thyme"),
])
def test_different_things_do_not_merge(name, not_canonical, canonical):
    assert canonical_name(name) == canonical != not_canonical


def test_unknown_names_stay_their_own_item_in_their_script():
    assert not is_known("pâte de dattes maison")
    assert canonical_name("حلاوة طحينية") != "tahini"
    assert canonical_name("المنسف") == "منسف"  # unknown Arabic keeps its folded key
    assert aisle_info("المنسف") == ("other", False)
    assert aisle_for("jus de pomme") == "drinks"  # French keyword fallback
    assert aisle_for("جبنة كريمية") == "dairy-eggs"  # Arabic keyword fallback


# ---------- units ----------


@pytest.mark.parametrize("unit,expected", [
    ("cuillère à soupe", "tbsp"), ("c. à s.", "tbsp"), ("c. à c.", "tsp"), ("CàS", "tbsp"), ("cuillères à café", "tsp"),
    ("tasse", "cup"), ("pincée", "pinch"), ("gousses", "clove"), ("boîte", "can"), ("kilogramme", "kg"),
    ("ملعقة كبيرة", "tbsp"), ("ملاعق كبيرة", "tbsp"), ("ملعقة صغيرة", "tsp"), ("ملعقة شاي", "tsp"),
    ("كوب", "cup"), ("أكواب", "cup"), ("كأس", "cup"), ("جرام", "g"), ("غرام", "g"), ("كيلو", "kg"),
    ("لتر", "l"), ("مل", "ml"), ("قرصة", "pinch"), ("فص", "clove"), ("فصوص", "clove"), ("علبة", "can"),
    ("حزمة", "bunch"), ("شريحة", "slice"), ("حبة", "piece"),
    ("tbsp", "tbsp"), ("g", "g"), ("bag", "bag"),  # English unchanged, unknown units untouched
])
def test_unit_spellings(unit, expected):
    assert normalize_unit(unit) == expected


def test_units_families_in_other_languages():
    assert unit_family("كيلو", 2) == ("mass", "g", 1000.0)
    assert unit_family("cuillère à soupe", 1) == ("volume", "ml", 15.0)
    assert unit_family("كوب", 1) == ("volume", "ml", 240.0)


# ---------- merging across languages on the grocery list ----------


def test_butter_beurre_and_zebda_in_arabic_make_one_line_in_dairy():
    recipes = {
        "a": recipe(2, [ing("butter", 100, "g")]),
        "b": recipe(2, [ing("beurre", 50, "g")]),
        "c": recipe(2, [ing("زبدة", 0.1, "كيلو")]),
        "d": recipe(2, [ing("الزبدة", 1, "ملعقة كبيرة")]),
    }
    items = build_list(compute_needed([entry(i, k, 2) for i, k in enumerate("abcd", 1)], recipes), {})
    assert [i["name"] for i in items] == ["butter"]
    line = items[0]
    assert line["aisle"] == "dairy-eggs"
    assert line["neededLabel"] == "250 g + 1 tbsp"  # mass and volume are never converted into each other
    assert {s["recipeId"] for s in line["sources"]} == {"a", "b", "c", "d"}


def test_flour_in_three_languages_with_units_in_each():
    recipes = {
        "a": recipe(1, [ing("flour", 200, "g")]),
        "b": recipe(1, [ing("farine", 250, "g")]),
        "c": recipe(1, [ing("طحين", 2, "كوب")]),
        "d": recipe(1, [ing("دقيق", 100, "غرام")]),
    }
    items = build_list(compute_needed([entry(i, k, 1) for i, k in enumerate("abcd", 1)], recipes), {})
    assert [i["name"] for i in items] == ["flour"]
    assert items[0]["neededLabel"] == "550 g + 2 cup"
    assert items[0]["aisle"] == "pantry"
    assert items[0]["staple"] is True


def test_unknown_arabic_name_is_kept_and_shown_as_typed():
    recipes = {"a": recipe(1, [ing("مَنسف", 1, "علبة"), ing("منسف", 1, "علبة")])}
    items = build_list(compute_needed([entry(1, "a", 1)], recipes), {})
    assert len(items) == 1 and items[0]["name"] == "منسف"
    assert items[0]["aisle"] == "other"
    assert items[0]["parts"][0]["family"] == "count:can"


def test_aisle_precedence_dictionary_then_household_then_stored_then_keyword():
    mem = {canonical_name("مَنسف"): "frozen", canonical_name("beurre"): "frozen"}
    recipes = {"a": recipe(1, [
        ing("مَنسف", 1, aisle="pantry"),  # household memory beats the stored aisle
        ing("beurre", 1, aisle="frozen"),  # the dictionary beats everything for known names
        ing("sauce au piment maison", 1, aisle="spices"),  # stored non-"other" aisle used
        ing("sauce inconnue", 1),  # keyword guess
    ])}
    items = {i["name"]: i for i in build_list(compute_needed([entry(1, "a", 1)], recipes, mem), {}, household_aisles=mem)}
    assert items["منسف"]["aisle"] == "frozen"
    assert items["butter"]["aisle"] == "dairy-eggs"
    assert items[canonical_name("sauce au piment maison")]["aisle"] == "spices"
    assert items["sauce inconnue"]["aisle"] == "pantry"
    # Without memory, the stored aisle is the user's pick.
    no_mem = {i["name"]: i for i in build_list(compute_needed([entry(1, "a", 1)], recipes), {})}
    assert no_mem["منسف"]["aisle"] == "pantry"


def test_stamping_uses_user_pick_then_household_memory_but_never_over_the_dictionary():
    rows = stamp_ingredients(
        [
            {"name": "ماء الزهر الخاص", "aisle": "drinks"},  # unknown, user picked
            {"name": "ماء الزهر الخاص ٢"},  # unknown, remembered by the household
            {"name": "زبدة", "aisle": "frozen"},  # known: dictionary wins
            {"name": "قطعة مجهولة"},  # unknown, nothing known
        ],
        {canonical_name("ماء الزهر الخاص ٢"): "bakery"},
    )
    assert [r["aisle"] for r in rows] == ["drinks", "bakery", "dairy-eggs", "other"]


# ---------- marks (purchases) keep working ----------


def test_marks_under_old_and_current_keys_still_count():
    # "la farine" used to be its own (unknown) line; its mark stays attached to the merged flour line.
    recipes = {"a": recipe(1, [ing("la farine", 200, "g"), ing("flour", 300, "g")])}
    needed = compute_needed([entry(1, "a", 1)], recipes)
    assert list(needed) == ["flour"]
    part = needed["flour"].parts["flour|mass"]
    assert "la farine|mass" in part.legacy_keys
    items = build_list(needed, {"la farine|mass": Mark(purchased=200)})
    assert [i["name"] for i in items] == ["flour"]  # no orphan line for the legacy key
    assert items[0]["parts"][0]["purchased"] == 200 and items[0]["parts"][0]["remaining"] == 300
    # An English mark under the unchanged canonical key behaves as before.
    items = build_list(needed, {"flour|mass": Mark(purchased=500)})
    assert items[0]["state"] == "in_cart"


def test_arabic_names_have_no_legacy_key():
    needed = compute_needed([entry(1, "a", 1)], {"a": recipe(1, [ing("زبدة", 100, "g")])})
    assert needed["butter"].parts["butter|mass"].legacy_keys == set()


# ---------- API: ingredient-check, household aisle memory, isolation ----------


def test_ingredient_check_reports_unknown_names_and_remembered_choices(client, register):
    h = register("anna")
    res = client.post("/api/recipes/ingredient-check", headers=h, json={"names": ["beurre", "زبدة", "ماء الزهر الخاص", "butter"]})
    assert res.status_code == 200
    items = {i["name"]: i for i in res.json()["items"]}
    assert items["beurre"]["known"] and items["beurre"]["canonical"] == "butter" and items["beurre"]["aisle"] == "dairy-eggs"
    assert items["زبدة"]["canonical"] == items["butter"]["canonical"] == "butter"  # one answer per typed spelling
    assert len(res.json()["items"]) == 4
    unknown = items["ماء الزهر الخاص"]
    assert unknown["known"] is False and unknown["remembered"] is False

    put = client.put("/api/recipes/ingredient-aisles", headers=h, json={"name": "ماء الزهر الخاص", "aisle": "drinks"})
    assert put.status_code == 200 and put.json()["stored"] is True
    again = client.post("/api/recipes/ingredient-check", headers=h, json={"names": ["الماء الزهر الخاص"]}).json()["items"][0]
    assert again["remembered"] is True and again["aisle"] == "drinks"
    assert client.post("/api/recipes/ingredient-check", json={"names": ["x"]}).status_code == 401


def test_known_names_are_not_stored_and_choices_can_change(client, register):
    h = register("anna")
    known = client.put("/api/recipes/ingredient-aisles", headers=h, json={"name": "beurre", "aisle": "frozen"}).json()
    assert known == {"id": None, "name": "butter", "aisle": "dairy-eggs", "known": True, "stored": False}
    first = client.put("/api/recipes/ingredient-aisles", headers=h, json={"name": "Spécialité du chef", "aisle": "pantry"}).json()
    second = client.put("/api/recipes/ingredient-aisles", headers=h, json={"name": "specialite du chef", "aisle": "frozen"}).json()
    assert first["id"] == second["id"] and second["aisle"] == "frozen"
    assert [(r["name"], r["aisle"]) for r in client.get("/api/recipes/ingredient-aisles", headers=h).json()] == [("specialite du chef", "frozen")]
    assert client.put("/api/recipes/ingredient-aisles", headers=h, json={"name": "x", "aisle": "nope"}).status_code == 422


def test_aisle_memory_is_shared_inside_a_household_and_isolated_across_households(client, register):
    a, b = register("anna"), register("ben")  # two separate households
    c = register("cleo")
    code = client.get("/api/household", headers=a).json()["inviteCode"]
    assert client.post("/api/household/join", headers=c, json={"code": code}).status_code == 200  # cleo joins anna

    stored = client.put("/api/recipes/ingredient-aisles", headers=a, json={"name": "ماء الزهر الخاص", "aisle": "drinks"}).json()
    check = lambda h: client.post("/api/recipes/ingredient-check", headers=h, json={"names": ["ماء الزهر الخاص"]}).json()["items"][0]
    assert check(c)["remembered"] is True  # same household
    assert check(b)["remembered"] is False  # other household
    assert client.get("/api/recipes/ingredient-aisles", headers=b).json() == []
    assert client.delete(f"/api/recipes/ingredient-aisles/{stored['id']}", headers=b).status_code == 404
    assert client.delete("/api/recipes/ingredient-aisles/99999", headers=b).status_code == 404
    assert check(a)["remembered"] is True  # b's attempt changed nothing
    assert client.delete(f"/api/recipes/ingredient-aisles/{stored['id']}", headers=c).status_code == 204
    assert check(a)["remembered"] is False


def test_recipe_and_grocery_list_use_the_chosen_and_remembered_aisle(client, register, db):
    h = register("anna")
    body = {
        "name": "Mansaf",
        "servings": 2,
        "ingredients": [
            {"name": "لحم ضأن", "quantity": 500, "unit": "غرام"},
            {"name": "زبدة", "quantity": 2, "unit": "ملعقة كبيرة", "aisle": "frozen"},  # dictionary wins
            {"name": "جميد", "quantity": 1, "unit": "كيلو", "aisle": "dairy-eggs"},  # unknown: the user's pick
            {"name": "خضار مشكلة", "quantity": 1, "unit": "علبة"},  # unknown, no pick
        ],
    }
    created = client.post("/api/recipes", headers=h, json=body)
    assert created.status_code == 200, created.text
    stored = {i["name"]: i["aisle"] for i in created.json()["ingredients"]}
    assert stored == {"لحم ضأن": "meat-fish", "زبدة": "dairy-eggs", "جميد": "dairy-eggs", "خضار مشكلة": "produce"}

    recipe_id = created.json()["id"]
    client.post("/api/plan", headers=h, json={"date": "2026-10-21", "slot": "dinner", "recipeId": recipe_id, "servings": 2})
    groceries = client.get("/api/groceries?today=2026-10-21", headers=h).json()
    by_name = {i["name"]: i for i in groceries["items"]}
    assert by_name["lamb"]["aisle"] == "meat-fish" and by_name["butter"]["aisle"] == "dairy-eggs"
    assert by_name["جميد"]["aisle"] == "dairy-eggs"
    assert by_name["خضار مشكلة"]["aisle"] == "produce"  # keyword guess

    # The household later files the unknown item under Pantry: the list follows, without editing the recipe.
    client.put("/api/recipes/ingredient-aisles", headers=h, json={"name": "جميد", "aisle": "pantry"})
    by_name = {i["name"]: i for i in client.get("/api/groceries?today=2026-10-21", headers=h).json()["items"]}
    assert by_name["جميد"]["aisle"] == "pantry"

    # A new recipe from the same household picks the remembered aisle up without any pick.
    again = client.post("/api/recipes", headers=h, json={"name": "Another", "ingredients": [{"name": "جميد"}]}).json()
    assert again["ingredients"][0]["aisle"] == "pantry"


def test_multilingual_recipes_merge_on_the_api_grocery_list(client, register, db):
    add_system_recipe(db, "fr-cake", servings=2, ingredients=[
        {"quantity": 200, "unit": "g", "name": "farine"},
        {"quantity": 2, "unit": None, "name": "œufs"},
        {"quantity": 100, "unit": "g", "name": "beurre"},
    ])
    add_system_recipe(db, "ar-cake", servings=2, ingredients=[
        {"quantity": 0.25, "unit": "كيلو", "name": "دقيق"},
        {"quantity": 3, "unit": None, "name": "بيض"},
        {"quantity": 50, "unit": "جرام", "name": "زبدة"},
    ])
    add_system_recipe(db, "en-cake", servings=2, ingredients=[
        {"quantity": 100, "unit": "g", "name": "flour"},
        {"quantity": 1, "unit": None, "name": "egg"},
        {"quantity": 50, "unit": "g", "name": "butter"},
    ])
    h = register("anna")
    for i, r in enumerate(("fr-cake", "ar-cake", "en-cake")):
        client.post("/api/plan", headers=h, json={"date": "2026-10-21", "slot": "dinner" if i == 0 else "lunch" if i == 1 else "snack", "recipeId": r, "servings": 2})
    items = {i["name"]: i for i in client.get("/api/groceries?today=2026-10-21", headers=h).json()["items"]}
    assert set(items) == {"flour", "egg", "butter"}
    assert items["flour"]["neededLabel"] == "550 g"
    assert items["egg"]["neededLabel"] == "6"
    assert items["butter"]["neededLabel"] == "200 g" and items["butter"]["aisle"] == "dairy-eggs"

    # Checking the merged line off marks it once, whichever language each recipe used.
    res = client.post("/api/groceries/mark", headers=h, json={"key": "butter"})
    assert res.status_code == 200, res.text
    after = {i["name"]: i for i in res.json()["items"]}
    assert after["butter"]["state"] == "in_cart"


# ---------- cheese: generic + specific, serving words in the name ----------


@pytest.mark.parametrize("text", [
    "fromage", "cheese", "جبن", "جبنة", "fromage râpé", "جبن مبشور", "shredded cheese",
    "portions de fromage", "fromage portions", "cheese portions", "pieces of cheese",
    "cheese slices", "tranches de fromage", "شرائح جبن", "حصص جبن", "grated cheese",
])
def test_generic_cheese_resolves_whatever_the_serving_words(text):
    assert canonical_name(text) == "cheese"
    assert aisle_for(text) == "dairy-eggs"


def test_generic_cheese_display_names():
    from app.localization import localized_names

    assert localized_names("cheese") == {"en": "cheese", "fr": "fromage", "ar": "جبن"}


def test_fromage_frais_keeps_its_old_canonical_key():
    assert canonical_name("fromage frais") == "cheese"


def test_serving_words_do_not_change_legacy_keys():
    # Old purchase-mark keys were computed without these descriptors.
    assert legacy_canonical_name("cheese slices") == "cheese slices"
    assert legacy_canonical_name("fromage") == "cheese"


def test_count_units_for_cheese_lines():
    assert unit_family("piece", 4)[0] == "count:piece"
    assert normalize_unit("tranches") == "slice"
    assert normalize_unit("morceaux") == "piece"
    assert normalize_unit("شرائح") == "slice"
    assert normalize_unit("قطع") == "piece"
