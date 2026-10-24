"""Ingredient name suggestions for the recipe form ("type-ahead") and the strict exact-match test
behind the form's auto-translate.

`suggest_ingredients()` ranks every spelling the dictionary knows (English, French, Modern
Standard Arabic) against what was typed: exact, then prefix, then a later word's prefix, then
substring, then (only when that left room) a one-edit typo. Matching is accent- and
Arabic-normalization-insensitive (`normalize_text()`), and one result is returned per
ingredient, shown in the requested language with the matched alias when it differs. The
household's remembered custom ingredients (names it filed under an aisle) take part too.

`exact_match()` is deliberately stricter than `canonical_name()` (which also strips descriptors,
singularizes and fuzzy-matches): it only answers for a spelling that is itself in the
dictionary, so the client can safely rewrite it to the reader's language."""

from dataclasses import dataclass
from functools import lru_cache

from .ingredient_names import EN_DISPLAY, EXTRA_EN, NAMES
from .ingredients import _ALIASES, _DICTIONARY, _distance, normalize_text
from .localization import localized_names

DEFAULT_LIMIT = 6
MAX_LIMIT = 12
_LEADING_ARTICLES = {"le", "la", "les", "l", "un", "une"}

_TIER_NAMES = {0: "exact", 1: "prefix", 2: "prefix", 3: "contains", 4: "fuzzy"}


@dataclass(frozen=True)
class _Alias:
    key: str  # normalized spelling
    text: str  # as written in the dictionary (accents, hamza...)
    canonical: str
    languages: frozenset[str]


@lru_cache(maxsize=1)
def _index() -> tuple[tuple[_Alias, ...], dict[str, _Alias]]:
    langs: dict[str, set[str]] = {}
    raw: dict[str, tuple[str, str]] = {}  # key -> (text, canonical)

    def add(text: str, canonical: str, lang: str) -> None:
        key = normalize_text(text)
        # A spelling that the resolver sends to another ingredient is not this one's alias.
        if not key or _ALIASES.get(key) != canonical:
            return
        langs.setdefault(key, set()).add(lang)
        raw.setdefault(key, (text, canonical))

    for canonical, (_aisle, _staple, names) in _DICTIONARY.items():
        add(EN_DISPLAY.get(canonical, canonical), canonical, "en")
        add(canonical, canonical, "en")
        for name in [*names, *EXTRA_EN.get(canonical, [])]:
            add(name, canonical, "en")
    for canonical, (fr, ar) in NAMES.items():
        for name in fr:
            add(name, canonical, "fr")
        for name in ar:
            add(name, canonical, "ar")
    by_key = {k: _Alias(k, t, c, frozenset(langs[k])) for k, (t, c) in raw.items()}
    return tuple(by_key.values()), by_key


def _strip_articles(key: str) -> str:
    words = key.split()
    while len(words) > 1 and words[0] in _LEADING_ARTICLES:
        words.pop(0)
    return " ".join(words)


def exact_match(name: str) -> tuple[str, frozenset[str]] | None:
    """(canonical, languages the spelling belongs to) when `name` is itself a dictionary
    spelling (accents/case/Arabic variants folded, a leading French article ignored), else None.
    No plurals, descriptors or typos: those are never rewritten."""
    _aliases, by_key = _index()
    key = normalize_text(name)
    alias = by_key.get(key) or by_key.get(_strip_articles(key))
    return (alias.canonical, alias.languages) if alias else None


def _tier(key: str, q: str, allow_fuzzy: bool) -> int | None:
    if key == q:
        return 0
    if key.startswith(q):
        return 1
    words = key.split()
    if len(words) > 1 and any(w.startswith(q) for w in words[1:]):
        return 2
    if len(q) >= 3 and q in key:
        return 3
    if allow_fuzzy and len(q) >= 4 and key[0] == q[0]:
        # a typo in what was typed so far: compare with the same-length start of the spelling
        # (or the whole spelling, for a typo in a finished word)
        head = key[: len(q)]
        if _distance(q, head) <= 1 or _distance(q, key) <= 1:
            return 4
    return None


def suggest_ingredients(
    query: str,
    lang: str = "en",
    custom: dict[str, str] | None = None,
    limit: int = DEFAULT_LIMIT,
) -> list[dict]:
    """Up to `limit` suggestions for the typed `query`. `custom` maps the household's remembered
    custom ingredient names to their aisle."""
    limit = max(1, min(limit, MAX_LIMIT))
    q = normalize_text(query)
    if len(q) < 2:
        return []
    queries = [q] if _strip_articles(q) == q else [q, _strip_articles(q)]
    aliases, _by_key = _index()

    # best alias per canonical: (tier, spelling length, preferred language, alias)
    best: dict[str, tuple[int, int, int, _Alias]] = {}
    custom_hits: dict[str, tuple[int, int, int, str]] = {}

    def scan(allow_fuzzy: bool) -> None:
        for alias in aliases:
            for needle in queries:
                tier = _tier(alias.key, needle, allow_fuzzy)
                if tier is None or (tier == 4 and not allow_fuzzy):
                    continue
                score = (tier, len(alias.key), 0 if lang in alias.languages else 1)
                current = best.get(alias.canonical)
                if current is None or score < current[:3]:
                    best[alias.canonical] = (*score, alias)
        for name, _aisle in (custom or {}).items():
            key = normalize_text(name)
            for needle in queries:
                tier = _tier(key, needle, allow_fuzzy)
                if tier is not None:
                    score = (tier, len(key), 0)
                    if name not in custom_hits or score < custom_hits[name][:3]:
                        custom_hits[name] = (*score, name)

    scan(allow_fuzzy=False)
    if len(best) + len(custom_hits) < limit:
        scan(allow_fuzzy=True)

    rows: list[tuple[tuple[int, int, int, str], dict]] = []
    for canonical, (tier, length, pref, alias) in best.items():
        names = localized_names(canonical) or {"en": canonical, "fr": canonical, "ar": canonical}
        shown = names.get(lang) or names["en"]
        matched = alias.text if normalize_text(shown) != alias.key else None
        rows.append(((tier, length, pref, canonical), {
            "canonical": canonical,
            "name": shown,
            "matched": matched,
            "names": names,
            "aisle": _DICTIONARY[canonical][0],
            "known": True,
            "custom": False,
            "match": _TIER_NAMES[tier],
        }))
    known_keys = {normalize_text(c) for c in best}
    for name, (tier, length, pref, _n) in custom_hits.items():
        if normalize_text(name) in known_keys:
            continue
        rows.append(((tier, length, pref, name), {
            "canonical": name,
            "name": name,
            "matched": None,
            "names": None,
            "aisle": (custom or {}).get(name, "other"),
            "known": False,
            "custom": True,
            "match": _TIER_NAMES[tier],
        }))
    rows.sort(key=lambda r: r[0])
    return [item for _key, item in rows[:limit]]
