"""The grocery list for a shop, derived live from the meal plan.

Pure functions only (no DB access) so they are unit-testable; routers/groceries.py loads the
rows and calls `compute_needed()` then `build_list()`.

Model:
- An *item* is one canonical ingredient name (see ingredients.canonical_name), shown as one
  line ("Butter: 200 g + 2 tbsp").
- An item has one *part* per unit family. Part key = "<canonical name>|<family>"; that is the
  key `shopping_marks.item_key` stores. Families: "mass" (base g), "volume" (base ml),
  "count:<unit>" (piece, clove, can, bunch, ... each its own family, never converted), and
  "unquantified" ("salt, to taste"). Mass and volume are never converted into each other.
- Needed = sum over plan entries in the trip range of ingredient quantity scaled by
  entry servings / recipe servings, converted to the family's base unit.
- A mark stores the purchased quantity per part (base unit; None = "checked, no quantity").
  remaining = needed - have - purchased, where `have` is what the household already has at
  home (shopping_have, same keys, stored apart from purchases). That gives the states the UI shows: to buy ("+N more
  needed" when something was already bought), in the cart, and "no longer needed, already
  bought" when the plan shrank after shopping, and "covered" when what is at home alone
  covers the need (nothing bought, nothing to buy).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable

from .ingredients import AISLES, DEFAULT_STAPLES, aisle_info, canonical_name, legacy_canonical_name, normalize_text
from .localization import localized_names
from .models import as_utc

EPSILON = 1e-6

MASS_UNITS = {"g": 1.0, "kg": 1000.0, "oz": 28.3495, "lb": 453.592}
VOLUME_UNITS = {"ml": 1.0, "l": 1000.0, "tsp": 5.0, "tbsp": 15.0, "small cup": 120.0, "cup": 240.0, "fl oz": 29.5735}
SPOON_UNITS = ("tsp", "tbsp", "small cup", "cup")

# Spellings seen in recipes (EN + FR) -> canonical unit.
UNIT_ALIASES = {
    "g": "g", "gram": "g", "grams": "g", "gramme": "g", "grammes": "g", "gr": "g",
    "kg": "kg", "kilo": "kg", "kilos": "kg", "kilogram": "kg", "kilograms": "kg",
    "oz": "oz", "ounce": "oz", "ounces": "oz",
    "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
    "ml": "ml", "millilitre": "ml", "milliliter": "ml", "millilitres": "ml", "milliliters": "ml",
    "cl": "cl", "dl": "dl",
    "l": "l", "litre": "l", "liter": "l", "litres": "l", "liters": "l",
    "tsp": "tsp", "teaspoon": "tsp", "teaspoons": "tsp", "c. a cafe": "tsp", "cac": "tsp",
    "tbsp": "tbsp", "tablespoon": "tbsp", "tablespoons": "tbsp", "tbs": "tbsp", "c. a soupe": "tbsp", "cas": "tbsp",
    "cup": "cup", "cups": "cup", "tasse": "cup", "tasses": "cup", "verre": "cup",
    "fl oz": "fl oz",
    "pinch": "pinch", "pinches": "pinch", "pincee": "pinch", "pincees": "pinch",
    "clove": "clove", "cloves": "clove", "gousse": "clove", "gousses": "clove",
    "can": "can", "cans": "can", "tin": "can", "tins": "can", "boite": "can",
    "bunch": "bunch", "bunches": "bunch", "botte": "bunch",
    "slice": "slice", "slices": "slice", "tranche": "slice", "tranches": "slice",
    "piece": "piece", "pieces": "piece", "whole": "piece", "pc": "piece", "pcs": "piece",
    "sprig": "sprig", "sprigs": "sprig", "brin": "sprig",
    "stick": "stick", "sticks": "stick",
    "leaf": "leaf", "leaves": "leaf", "feuille": "leaf", "feuilles": "leaf",
    "handful": "handful", "handfuls": "handful", "poignee": "handful",
}
# More French and Modern Standard Arabic unit spellings. Looked up in normalized form (accents,
# dots, hamza seats and ة/ه folded), so "c. à s.", "c a s" and "cuillère à soupe" all land here.
_EXTRA_UNITS = {
    # French
    "cuillere a soupe": "tbsp", "cuilleres a soupe": "tbsp", "cuillere a cafe": "tsp", "cuilleres a cafe": "tsp",
    "c. a s.": "tbsp", "c. a c.": "tsp", "c a s": "tbsp", "c a c": "tsp", "cs": "tbsp", "cc": "tsp",
    "kilogramme": "kg", "kilogrammes": "kg", "centilitre": "cl", "centilitres": "cl", "decilitre": "dl",
    "decilitres": "dl", "boites": "can", "conserve": "can", "bouquet": "bunch", "bouquets": "bunch",
    "morceau": "piece", "morceaux": "piece", "unite": "piece", "unites": "piece",
    "rondelle": "slice", "rondelles": "slice", "branche": "sprig", "branches": "sprig",
    "batonnet": "stick", "batonnets": "stick", "poignees": "handful",
    # Modern Standard Arabic
    "غ": "g", "غم": "g", "جم": "g", "جرام": "g", "غرام": "g", "جرامات": "g", "غرامات": "g",
    "كغ": "kg", "كجم": "kg", "كغم": "kg", "كيلو": "kg", "كيلوجرام": "kg", "كيلوغرام": "kg", "كيلوجرامات": "kg",
    "مل": "ml", "مليلتر": "ml", "ميليلتر": "ml", "ملليلتر": "ml", "ل": "l", "لتر": "l", "لترات": "l",
    "سل": "cl", "سنتيلتر": "cl", "ديسيلتر": "dl",
    "ملعقة كبيرة": "tbsp", "ملاعق كبيرة": "tbsp", "ملعقة طعام": "tbsp", "ملاعق طعام": "tbsp",
    "ملعقة صغيرة": "tsp", "ملاعق صغيرة": "tsp", "ملعقة شاي": "tsp", "ملاعق شاي": "tsp",
    "كوب": "cup", "أكواب": "cup", "كأس": "cup", "كؤوس": "cup", "كاسات": "cup",
    "أونصة": "oz", "أونصات": "oz", "أوقية": "oz", "رطل": "lb", "أرطال": "lb",
    "قرصة": "pinch", "قرصات": "pinch", "رشة": "pinch", "رشات": "pinch",
    "فص": "clove", "فصوص": "clove", "علبة": "can", "علب": "can",
    "حزمة": "bunch", "حزم": "bunch", "باقة": "bunch", "باقات": "bunch",
    "شريحة": "slice", "شرائح": "slice", "حبة": "piece", "حبات": "piece", "قطعة": "piece", "قطع": "piece",
    "غصن": "sprig", "أغصان": "sprig", "عود": "stick", "أعواد": "stick", "ورقة": "leaf", "أوراق": "leaf",
    "حفنة": "handful", "حفنات": "handful",
}
_EXTRA_UNITS.update({
    # Loose spoken spellings ("table spoon", "big spoon"...); a dessert spoon is ~2 tsp, so the
    # recipe form converts it itself and it stays as typed here.
    "table spoon": "tbsp", "table spoons": "tbsp", "tablespoonful": "tbsp", "tbl": "tbsp", "tblsp": "tbsp", "tbsps": "tbsp",
    "soup spoon": "tbsp", "soup spoons": "tbsp", "big spoon": "tbsp", "large spoon": "tbsp", "t": "tbsp",
    "tea spoon": "tsp", "tea spoons": "tsp", "teaspoonful": "tsp", "tsps": "tsp", "tspn": "tsp", "small spoon": "tsp",
    "little spoon": "tsp", "coffee spoon": "tsp", "coffee spoons": "tsp",
    "glass": "cup", "glasses": "cup", "verres": "cup",
    "cuillere a the": "tsp", "c. a the": "tsp", "petite cuillere": "tsp", "petites cuilleres": "tsp",
    "grande cuillere": "tbsp", "grandes cuilleres": "tbsp",
    # "Small cup" is an app convention of 120 ml (coffee / tea cup, demi-tasse); "cup" stays 240 ml.
    "small cup": "small cup", "small cups": "small cup", "coffee cup": "small cup", "coffee cups": "small cup",
    "tea cup": "small cup", "tea cups": "small cup", "teacup": "small cup", "teacups": "small cup",
    "demi tasse": "small cup", "demi-tasse": "small cup", "demi tasses": "small cup", "demi-tasses": "small cup",
    "tasse a cafe": "small cup", "tasses a cafe": "small cup", "tasse a the": "small cup", "tasses a the": "small cup",
    "petite tasse": "small cup", "petites tasses": "small cup",
    "كوب صغير": "small cup", "أكواب صغيرة": "small cup",
    "فنجان": "small cup", "فناجين": "small cup", "قبضة": "handful", "قبضات": "handful", "كاس": "cup",
})
_EXTRA_FACTORS = {"cl": ("ml", 10.0), "dl": ("ml", 100.0)}

FRACTIONAL_COUNT_UNITS = {"pinch", "handful"}

# English display spelling where it differs from the canonical code (share text).
UNIT_DISPLAY = {"l": "L"}

COUNT_PLURALS = {
    "clove": "cloves", "can": "cans", "bunch": "bunches", "slice": "slices", "sprig": "sprigs",
    "stick": "sticks", "leaf": "leaves", "pinch": "pinches", "handful": "handfuls",
}


_UNIT_LOOKUP = {normalize_text(k): v for k, v in {**UNIT_ALIASES, **_EXTRA_UNITS}.items()}


def normalize_unit(unit: str | None) -> str | None:
    if unit is None:
        return None
    u = unit.strip().lower().replace("à", "a").replace("é", "e").rstrip(".")
    if not u:
        return None
    if u in UNIT_ALIASES:
        return UNIT_ALIASES[u]
    # Folded lookup (French accents/abbreviations, Arabic spellings); unknown units stay as typed.
    return _UNIT_LOOKUP.get(normalize_text(u), u)


def unit_family(unit: str | None, quantity: float | None) -> tuple[str, str, float]:
    """(family, base unit, factor to base) for a quantity in `unit`."""
    if quantity is None:
        return "unquantified", "", 1.0
    u = normalize_unit(unit)
    if u in _EXTRA_FACTORS:
        base, factor = _EXTRA_FACTORS[u]
        return "volume", base, factor
    if u in MASS_UNITS:
        return "mass", "g", MASS_UNITS[u]
    if u in VOLUME_UNITS:
        return "volume", "ml", VOLUME_UNITS[u]
    count_unit = u or "piece"
    return f"count:{count_unit}", count_unit, 1.0


def scale_quantity(quantity: float | None, recipe_servings: int, servings: int) -> float | None:
    if quantity is None:
        return None
    if not recipe_servings:
        return quantity
    return quantity * servings / recipe_servings


# ---------- number formatting ----------

_FRACTIONS = [(0.0, ""), (1 / 8, "⅛"), (1 / 4, "¼"), (1 / 3, "⅓"), (1 / 2, "½"), (2 / 3, "⅔"), (3 / 4, "¾"), (1.0, "")]


def nice_number(x: float) -> str:
    """1.5 -> "1½", 0.25 -> "¼", 2.0 -> "2"; falls back to one decimal."""
    if x <= 0:
        return "0"
    if x < 1:
        # Small amounts (spoons of spice) read best as a kitchen fraction: snap to the nearest.
        best = min(_FRACTIONS[1:], key=lambda f: abs(f[0] - x))
        return "1" if best[0] == 1.0 else best[1]
    whole = math.floor(x)
    frac = x - whole
    best = min(_FRACTIONS, key=lambda f: abs(f[0] - frac))
    if abs(best[0] - frac) <= 0.07:
        if best[0] == 1.0:
            return str(whole + 1)
        if best[1] == "":
            return str(whole)
        return f"{whole}{best[1]}" if whole else best[1]
    return f"{x:.1f}".rstrip("0").rstrip(".")


def _metric_number(x: float) -> str:
    if x >= 100:
        return str(int(round(x / 5.0) * 5))
    if x >= 10:
        return str(int(round(x)))
    return f"{x:.1f}".rstrip("0").rstrip(".")


def amount_parts(base_qty: float | None, family: str, units_seen: Iterable[str] = (), unit_system: str = "metric") -> dict[str, Any] | None:
    """A quantity held in its family's base unit as {number, unit, many}: `number` is the
    pretty number ("½", "250", "1.5"), `unit` a canonical unit code (g, kg, oz, lb, ml, l, tsp,
    tbsp, cup, or a count unit such as clove; None for plain pieces) and `many` says the unit
    should be plural. Clients localize the unit; format_amount() renders the English text."""
    if base_qty is None or family == "unquantified":
        return None
    seen = {u for u in units_seen if u}
    if family == "mass":
        if unit_system == "us":
            oz = base_qty / MASS_UNITS["oz"]
            return {"number": nice_number(oz / 16), "unit": "lb", "many": False} if oz >= 16 else {"number": nice_number(oz), "unit": "oz", "many": False}
        if base_qty >= 1000:
            return {"number": f"{(base_qty / 1000):.2f}".rstrip("0").rstrip("."), "unit": "kg", "many": False}
        return {"number": _metric_number(base_qty), "unit": "g", "many": False}
    if family == "volume":
        spoon_only = seen and seen <= set(SPOON_UNITS)
        if spoon_only or unit_system == "us" or base_qty < 30:
            if len(seen) == 1 and spoon_only:
                unit = next(iter(seen))
            elif base_qty >= 60:
                unit = "cup"
            elif base_qty >= 15:
                unit = "tbsp"
            else:
                unit = "tsp"
            return {"number": nice_number(base_qty / VOLUME_UNITS[unit]), "unit": unit, "many": False}
        if base_qty >= 1000:
            return {"number": f"{(base_qty / 1000):.2f}".rstrip("0").rstrip("."), "unit": "l", "many": False}
        return {"number": _metric_number(base_qty), "unit": "ml", "many": False}
    # count family: you can't buy ⅔ of an onion or ⅓ of a bunch, so round up to whole units
    # (pinch/handful stay fractional - nobody buys those).
    unit = family.split(":", 1)[1] if ":" in family else "piece"
    if unit in FRACTIONAL_COUNT_UNITS:
        number = nice_number(base_qty)
    else:
        base_qty = max(1, math.ceil(base_qty - 0.05))
        number = str(base_qty)
    return {"number": number, "unit": None if unit == "piece" else unit, "many": base_qty > 1 + EPSILON}


def format_amount(base_qty: float | None, family: str, units_seen: Iterable[str] = (), unit_system: str = "metric") -> str:
    """Pretty-print a quantity held in its family's base unit (English)."""
    parts = amount_parts(base_qty, family, units_seen, unit_system)
    if parts is None:
        return ""
    unit = parts["unit"]
    if unit is None:
        return parts["number"]
    if parts["many"]:
        unit = COUNT_PLURALS.get(unit, unit)
    unit = UNIT_DISPLAY.get(unit, unit)
    return f"{parts['number']} {unit}"


# ---------- needed (from the plan) ----------


def _item_aisle(raw_name: str, stored: str | None, household_aisles: dict[str, str] | None = None) -> str:
    """Aisle of a needed item. A name the dictionary knows (any language, typos included) always
    uses the dictionary's aisle. Otherwise: what the household chose before for this name, then
    the aisle stored on the recipe ingredient when it is not "other" (the user's pick or the
    keyword guess made at save time), then the keyword guess, then "other"."""
    derived, known = aisle_info(raw_name)
    if known:
        return derived
    chosen = (household_aisles or {}).get(canonical_name(raw_name))
    if chosen in AISLES:
        return chosen
    if stored in AISLES and stored != "other":
        return stored
    return derived


@dataclass
class Part:
    key: str
    family: str
    base_unit: str
    needed: float | None = None  # None for unquantified
    units_seen: set[str] = field(default_factory=set)
    legacy_keys: set[str] = field(default_factory=set)  # pre-fuzzy mark keys, see build_list


@dataclass
class NeededItem:
    name: str
    aisle: str
    display: str = ""  # shown instead of `name` for unknown Arabic names (the key is letter-folded)
    parts: dict[str, Part] = field(default_factory=dict)
    sources: list[dict[str, Any]] = field(default_factory=list)


def _display_name(canonical: str, raw_name: str) -> str:
    """Known names show the English canonical name. An unknown Arabic name shows the typed
    words (the key itself is letter-folded, which reads wrong: ة becomes ه)."""
    if not any("\u0621" <= ch <= "\u064a" for ch in canonical):
        return ""
    cleaned = "".join(ch for ch in raw_name if not ("\u064b" <= ch <= "\u065f" or ch in "\u0640\u0670"))
    return " ".join(re.split(r"[,،]", cleaned)[0].split())


def part_key(name: str, family: str) -> str:
    return f"{name}|{family}"


def compute_needed(
    entries: Iterable[dict[str, Any]],
    recipes: dict[str, dict[str, Any]],
    household_aisles: dict[str, str] | None = None,
) -> dict[str, NeededItem]:
    """entries: dicts with id, date, slot, recipe_id, servings (+ optional created_at,
    updated_at, added_by). recipes: recipe id -> recipe data (servings, name, ingredients).
    household_aisles: canonical name -> aisle the household picked for names we don't know."""
    items: dict[str, NeededItem] = {}
    for entry in entries:
        recipe = recipes.get(entry.get("recipe_id") or "")
        if not recipe:
            continue
        recipe_servings = int(recipe.get("servings") or 1)
        servings = int(entry.get("servings") or recipe_servings)
        for ing in recipe.get("ingredients", []):
            if ing.get("optional"):
                continue  # optional add-ins are offered separately, see collect_optional()
            raw_name = ing.get("name") or ""
            name = canonical_name(raw_name)
            if not name:
                continue
            qty = ing.get("quantity")
            qty = float(qty) if qty is not None else None
            unit = normalize_unit(ing.get("unit"))
            family, base_unit, factor = unit_family(unit, qty)
            scaled = scale_quantity(qty, recipe_servings, servings)
            item = items.get(name)
            if item is None:
                item = items[name] = NeededItem(
                    name=name,
                    aisle=_item_aisle(raw_name, ing.get("aisle"), household_aisles),
                    display=_display_name(name, raw_name),
                )
            key = part_key(name, family)
            part = item.parts.get(key)
            if part is None:
                part = item.parts[key] = Part(key=key, family=family, base_unit=base_unit)
            legacy_name = legacy_canonical_name(raw_name)  # "" for names unreadable before (Arabic)
            legacy_key = part_key(legacy_name, family)
            if legacy_name and legacy_key != key:
                part.legacy_keys.add(legacy_key)
            if scaled is not None:
                part.needed = (part.needed or 0.0) + scaled * factor
                if unit:
                    part.units_seen.add(unit)
            item.sources.append({
                "entryId": entry.get("id"),
                "date": _iso(entry.get("date")),
                "slot": entry.get("slot"),
                "recipeId": entry.get("recipe_id"),
                "recipeName": recipe.get("name", ""),
                "servings": servings,
                "amountParts": amount_parts(scaled * factor, family, [unit] if unit else []) if scaled is not None else None,
                "amount": format_amount(scaled * factor, family, [unit] if unit else []) if scaled is not None else "",
                "addedBy": entry.get("added_by"),
                "updatedAt": entry.get("updated_at") or entry.get("created_at"),
            })
    return items


def collect_optional(entries: Iterable[dict[str, Any]], recipes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Optional ingredients of the planned recipes, excluded from "needed" and offered as
    one-tap extras: one row per (entry, ingredient) with the scaled amount as text."""
    out = []
    for entry in entries:
        recipe = recipes.get(entry.get("recipe_id") or "")
        if not recipe:
            continue
        recipe_servings = int(recipe.get("servings") or 1)
        servings = int(entry.get("servings") or recipe_servings)
        for ing in recipe.get("ingredients", []):
            if not ing.get("optional"):
                continue
            qty = ing.get("quantity")
            unit = normalize_unit(ing.get("unit"))
            family, _base, factor = unit_family(unit, float(qty) if qty is not None else None)
            scaled = scale_quantity(float(qty), recipe_servings, servings) if qty is not None else None
            out.append({
                "name": ing.get("name", ""),
                "canonical": canonical_name(ing.get("name", "")),
                "names": localized_names(canonical_name(ing.get("name", ""))),
                "amountParts": amount_parts(scaled * factor, family, [unit] if unit else []) if scaled is not None else None,
                "amount": format_amount(scaled * factor, family, [unit] if unit else []) if scaled is not None else "",
                "note": ing.get("note"),
                "entryId": entry.get("id"),
                "date": _iso(entry.get("date")),
                "slot": entry.get("slot"),
                "recipeId": entry.get("recipe_id"),
                "recipeName": recipe.get("name", ""),
            })
    return out


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return as_utc(value).isoformat()
    return value.isoformat() if isinstance(value, date) else value


# ---------- the list (needed + marks) ----------


@dataclass
class Mark:
    purchased: float | None  # None = checked without a quantity
    checked_by: int | None = None


def _tolerance(needed: float) -> float:
    # Marks are stored with 3 decimals; ignore rounding dust (and < 0.5 % leftovers).
    return max(0.001, needed * 0.005)


def _part_state(part_needed: float | None, mark: Mark | None, have: float = 0.0) -> tuple[float | None, float | None, bool]:
    """(purchased, remaining, done) for one part. remaining = needed - have - purchased (>= 0);
    `have` is what is at home and is never mixed into `purchased`."""
    if part_needed is None:  # unquantified: done when checked
        return None, None, mark is not None
    have = max(have, 0.0)
    if mark is None:
        remaining = max(part_needed - have, 0.0)
        if have > 0 and remaining <= _tolerance(part_needed):
            remaining = 0.0
        return 0.0, remaining, remaining <= EPSILON
    if mark.purchased is None:
        return None, 0.0, True
    remaining = max(part_needed - have - mark.purchased, 0.0)
    if remaining <= _tolerance(part_needed):
        remaining = 0.0
    return mark.purchased, remaining, remaining <= EPSILON


def resolve_have(needed: dict[str, NeededItem], have: dict[str, float]) -> tuple[dict[str, float], set[str]]:
    """What is at home per current part key, plus the keys that were used. Same rule as marks:
    the current key wins; otherwise amounts stored under legacy (pre-fuzzy) keys are summed."""
    out: dict[str, float] = {}
    consumed: set[str] = set()
    for item in needed.values():
        for key, part in item.parts.items():
            legacy = [k for k in sorted(part.legacy_keys) if k in have]
            consumed.update(legacy)  # never an orphan, even when the current key wins
            if key in have:
                out[key] = have[key]
                consumed.add(key)
            elif legacy:
                out[key] = sum(have[k] for k in legacy)
    return out, consumed


def at_home_memory(needed: dict[str, NeededItem], have: dict[str, float], unit_system: str = "metric") -> list[dict[str, Any]]:
    """Have-amounts that match nothing needed right now (the plan changed): a small "at home"
    memory the client can show and clear. They come back by themselves if the plan needs the item again."""
    _, consumed = resolve_have(needed, have)
    out = []
    for key, qty in sorted(have.items()):
        if key in consumed or qty <= EPSILON:
            continue
        name, _, family = key.partition("|")
        out.append({
            "key": key,
            "itemKey": name,
            "name": name,
            "names": localized_names(name),
            "family": family,
            "have": qty,
            "haveAmount": amount_parts(qty, family, (), unit_system),
        })
    return out


def build_list(
    needed: dict[str, NeededItem],
    marks: dict[str, Mark],
    *,
    staples: Iterable[str] | None = None,
    promoted: Iterable[str] = (),
    unit_system: str = "metric",
    seen_at: datetime | None = None,
    viewer_id: int | None = None,
    household_aisles: dict[str, str] | None = None,
    have: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Merge the needed items with the trip's marks (and what is at home) into the list the API returns."""
    staple_set = set(DEFAULT_STAPLES if staples is None else staples)
    promoted_set = set(promoted)
    out: list[dict[str, Any]] = []

    # Marks for parts that are no longer in the plan at all (meal removed after shopping).
    # A mark stored under a legacy key (pre-fuzzy spelling) still counts for the merged part.
    # The current key wins; otherwise the legacy marks are summed (they were separate lines
    # then, each bought on its own), so nothing is counted twice.
    part_marks: dict[str, Mark | None] = {}
    consumed: set[str] = set()
    for item in needed.values():
        for key, part in item.parts.items():
            mark = marks.get(key)
            legacy = [(k, marks[k]) for k in sorted(part.legacy_keys) if k in marks]
            consumed.update(k for k, _ in legacy)  # never shown as a separate orphan line
            if mark is None:
                if legacy:
                    amounts = [m.purchased for _, m in legacy if m.purchased is not None]
                    mark = Mark(purchased=sum(amounts) if amounts else None, checked_by=legacy[0][1].checked_by)
            part_marks[key] = mark

    part_have, _ = resolve_have(needed, have or {})

    orphan_marks: dict[str, dict[str, Mark]] = {}
    for key, mark in marks.items():
        name, _, family = key.partition("|")
        if key in consumed:
            continue
        if name in needed and key in needed[name].parts:
            continue
        orphan_marks.setdefault(name, {})[family] = mark

    for name, item in needed.items():
        parts_out = []
        all_done = True
        more_needed = False
        any_mark = False
        any_have = False
        for key, part in item.parts.items():
            mark = part_marks.get(key)
            part_at_home = part_have.get(key, 0.0) if part.needed is not None else 0.0
            purchased, remaining, done = _part_state(part.needed, mark, part_at_home)
            all_done = all_done and done
            any_mark = any_mark or mark is not None
            any_have = any_have or part_at_home > EPSILON
            if not done and purchased and purchased > EPSILON:
                more_needed = True
            parts_out.append({
                "key": key,
                "legacyKeys": sorted(part.legacy_keys),
                "family": part.family,
                "needed": part.needed,
                "purchased": purchased,
                "remaining": remaining,
                "checked": mark is not None,
                "have": part_at_home,
                "haveAmount": amount_parts(part_at_home, part.family, part.units_seen, unit_system) if part_at_home > EPSILON else None,
                "neededAmount": amount_parts(part.needed, part.family, part.units_seen, unit_system),
                "remainingAmount": amount_parts(remaining, part.family, part.units_seen, unit_system) if remaining else None,
                "neededLabel": format_amount(part.needed, part.family, part.units_seen, unit_system),
                "remainingLabel": format_amount(remaining, part.family, part.units_seen, unit_system) if remaining else "",
            })
        # Surplus marks for families no longer needed for this item are ignored for state.
        is_new = False
        seen = as_utc(seen_at)
        if seen is not None:
            for src in item.sources:
                ts = src.get("updatedAt")
                # Both sides normalised to aware UTC: PostgreSQL returns aware, SQLite naive.
                if isinstance(ts, datetime) and as_utc(ts) > seen and src.get("addedBy") != viewer_id:
                    is_new = True
        if not all_done:
            state = "to_buy"
        elif any_have and not any_mark:
            state = "covered"  # what is at home covers it: nothing bought, nothing to buy
        else:
            state = "in_cart"
        pantry_state = "need" if name in promoted_set else ("have" if name in staple_set else None)
        out.append({
            "key": name,
            "name": item.display or name,
            "names": localized_names(name),
            "aisle": item.aisle,
            "state": state,
            "moreNeeded": more_needed,
            "staple": name in staple_set and name not in promoted_set,
            "promoted": name in promoted_set,
            "pantryState": pantry_state,
            "hasHave": any_have,
            "isNew": is_new and state == "to_buy",
            "neededLabel": _join(p["neededLabel"] for p in parts_out),
            "remainingLabel": _join(p["remainingLabel"] for p in parts_out if not _done_part(p)),
            "parts": parts_out,
            "sources": [{k: _iso(v) for k, v in s.items()} for s in item.sources],
        })

    for name, fam_marks in orphan_marks.items():
        if name in needed:
            continue  # only a family vanished; item still listed above
        labels = []
        for family, mark in fam_marks.items():
            if mark.purchased is not None:
                labels.append(format_amount(mark.purchased, family, (), unit_system))
        out.append({
            "key": name,
            "name": name,
            "names": localized_names(name),
            "aisle": _item_aisle(name, None, household_aisles),
            "state": "no_longer_needed",
            "moreNeeded": False,
            "staple": False,
            "promoted": False,
            "pantryState": None,
            "hasHave": False,
            "isNew": False,
            "neededLabel": "",
            "remainingLabel": "",
            "purchasedLabel": _join(labels),
            "purchasedAmounts": [a for a in (amount_parts(m.purchased, f, (), unit_system) for f, m in fam_marks.items() if m.purchased is not None) if a],
            "parts": [
                {"key": f"{name}|{family}", "family": family, "needed": 0.0, "purchased": m.purchased,
                 "remaining": 0.0, "checked": True, "neededAmount": None, "remainingAmount": None, "neededLabel": "", "remainingLabel": ""}
                for family, m in fam_marks.items()
            ],
            "sources": [],
        })

    aisle_rank = {a: i for i, a in enumerate(AISLES)}
    state_rank = {"to_buy": 0, "in_cart": 1, "covered": 1, "no_longer_needed": 2}
    out.sort(key=lambda i: (aisle_rank.get(i["aisle"], len(AISLES)), state_rank[i["state"]], i["name"]))
    return out


def _done_part(p: dict[str, Any]) -> bool:
    return p["remaining"] is not None and p["remaining"] <= EPSILON or (p["remaining"] is None and p["checked"])


def _join(labels: Iterable[str]) -> str:
    return " + ".join(label for label in labels if label)


def default_marks_for_item(item: dict[str, Any]) -> dict[str, float | None]:
    """Checking an item off without quantities marks every part as bought: what is still
    needed beyond what is at home (None for unquantified parts)."""
    return {
        p["key"]: (None if p["needed"] is None else max(p["needed"] - (p.get("have") or 0.0), 0.0))
        for p in item["parts"]
    }


def share_text(items: list[dict[str, Any]], extras: list[dict[str, Any]], title: str) -> str:
    """Plain-text list of what is still to buy, grouped by aisle (for WhatsApp etc.)."""
    by_aisle: dict[str, list[str]] = {}
    for item in items:
        if item["state"] != "to_buy" or item["staple"]:
            continue
        label = item["remainingLabel"] or item["neededLabel"]
        by_aisle.setdefault(item["aisle"], []).append(f"- {item['name']}" + (f": {label}" if label else ""))
    for extra in extras:
        if extra.get("checked"):
            continue
        qty = extra.get("quantity")
        by_aisle.setdefault(extra.get("aisle") or "other", []).append(f"- {extra['name']}" + (f": {qty}" if qty else ""))
    lines = [title]
    for aisle in AISLES:
        if aisle in by_aisle:
            lines.append("")
            lines.append(AISLE_LABELS[aisle])
            lines.extend(by_aisle[aisle])
    return "\n".join(lines)


AISLE_LABELS = {
    "produce": "Produce",
    "meat-fish": "Meat & fish",
    "dairy-eggs": "Dairy & eggs",
    "bakery": "Bakery",
    "pantry": "Pantry",
    "spices": "Spices",
    "frozen": "Frozen",
    "drinks": "Drinks",
    "household": "Household",
    "other": "Other",
}
