"""Localized ingredient names for the API.

Recipes store what the author typed (`name`, in any of English/French/Arabic) plus the English
`canonical` name resolved at save time. Responses add `names` ({en, fr, ar}) for known
ingredients so the client can show each reader their own language. Unknown ingredients (no
dictionary entry) get no `names`: the client shows them as typed."""

from typing import Any

from .ingredient_names import EN_DISPLAY, NAMES
from .ingredients import canonical_name, is_known

LANGUAGES = ("en", "fr", "ar")
DEFAULT_LANGUAGE = "en"


def localized_names(canonical: str) -> dict[str, str] | None:
    """{en, fr, ar} display names for a canonical ingredient, or None when it is not in the
    dictionary. The first listed French/Arabic name is the preferred display form."""
    entry = NAMES.get(canonical)
    if entry is None:
        return None
    fr, ar = entry
    return {"en": EN_DISPLAY.get(canonical, canonical), "fr": fr[0] if fr else canonical, "ar": ar[0] if ar else canonical}


def canonical_for(name: str, stored: str | None = None) -> str:
    """The canonical (English) merge name. A stored canonical is kept only while the dictionary
    knows it; a stored *unknown* one (saved before the dictionary learned the word, e.g. "fromage"
    or "creme liquide") is re-resolved, so dictionary growth reaches existing recipes without a
    backfill."""
    if stored and stored in NAMES:
        return stored
    return canonical_name(name)


def enrich_ingredient(ing: dict[str, Any]) -> dict[str, Any]:
    """An ingredient as the API returns it: original `name`, `canonical`, `known` and `names`."""
    name = ing.get("name") or ""
    canonical = canonical_for(name, ing.get("canonical"))
    names = localized_names(canonical)
    return {**ing, "canonical": canonical, "known": names is not None, "names": names}


def valid_language(value: str | None) -> str:
    return value if value in LANGUAGES else DEFAULT_LANGUAGE
