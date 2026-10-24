"""Import a recipe draft from a web page's schema.org `Recipe` JSON-LD.

`fetch_html()` is the only network code and is guarded against SSRF: http/https only,
every resolved address (and every redirect hop's) must be public, redirects are followed
manually (max 3), a 10 s timeout and a 2 MB size cap. `parse_recipe_html()` is pure and is
what the tests exercise on a saved fixture page.

Known limit: the hostname is resolved for the check and again by urllib for the connect, so
a DNS-rebinding host could in theory answer differently the second time.
"""

import ipaddress
import json
import re
import socket
import urllib.error
import urllib.request
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlparse

MAX_BYTES = 2 * 1024 * 1024
TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 3
USER_AGENT = "MiseRecipeImporter/1.0 (+recipe import for a personal meal planner)"


class ImportError_(Exception):
    """User-facing import failure (bad URL, blocked address, no recipe found...)."""


# ---------- fetching ----------


def _is_public_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or (isinstance(addr, ipaddress.IPv4Address) and addr in ipaddress.ip_network("100.64.0.0/10"))
    )


def check_url(url: str) -> None:
    """Raise ImportError_ unless `url` is http(s) and every address it resolves to is public."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ImportError_("Only http and https links can be imported")
    host = parsed.hostname
    if not host:
        raise ImportError_("That doesn't look like a web address")
    if parsed.username or parsed.password:
        raise ImportError_("Links with credentials can't be imported")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ImportError_("Couldn't find that website")
    if not infos or not all(_is_public_ip(info[4][0]) for info in infos):
        raise ImportError_("That address isn't allowed")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 - urllib hook
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def fetch_html(url: str) -> tuple[str, str]:
    """(final url, html text). Every hop is re-checked."""
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        check_url(current)
        req = urllib.request.Request(current, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"})
        try:
            resp = _opener.open(req, timeout=TIMEOUT_SECONDS)
        except urllib.error.HTTPError as err:
            if err.code in (301, 302, 303, 307, 308) and err.headers.get("Location"):
                current = urljoin(current, err.headers["Location"])
                continue
            raise ImportError_(f"The page answered with an error ({err.code})")
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ImportError_("Couldn't load that page")
        with resp:
            content_type = resp.headers.get("Content-Type", "")
            if "html" not in content_type and "xml" not in content_type:
                raise ImportError_("That link isn't a web page")
            body = resp.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ImportError_("That page is too large to import")
            charset = resp.headers.get_content_charset() or "utf-8"
            return current, body.decode(charset, errors="replace")
    raise ImportError_("Too many redirects")


# ---------- parsing ----------


class _LdJsonCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[str] = []
        self._in_ld = False
        self._buf: list[str] = []
        self.site_name: str | None = None
        self.title: str | None = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script" and (a.get("type") or "").lower().strip() == "application/ld+json":
            self._in_ld, self._buf = True, []
        elif tag == "meta" and a.get("property") == "og:site_name":
            self.site_name = a.get("content")
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld:
            self.blocks.append("".join(self._buf))
            self._in_ld = False
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_ld:
            self._buf.append(data)
        elif self._in_title and not self.title:
            self.title = data.strip()


def _iter_nodes(node: Any):
    if isinstance(node, list):
        for item in node:
            yield from _iter_nodes(item)
    elif isinstance(node, dict):
        yield node
        if "@graph" in node:
            yield from _iter_nodes(node["@graph"])


def _is_recipe(node: dict) -> bool:
    t = node.get("@type")
    types = t if isinstance(t, list) else [t]
    return any(isinstance(x, str) and x.lower() == "recipe" for x in types)


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        value = value[0] if value else ""
    if isinstance(value, dict):
        value = value.get("text") or value.get("name") or ""
    text = re.sub(r"<[^>]+>", " ", unescape(str(value)))
    return re.sub(r"\s+", " ", text).strip()


def parse_duration(value: Any) -> int | None:
    """ISO 8601 duration (PT1H30M) -> minutes."""
    if not isinstance(value, str):
        return None
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?", value.strip().upper())
    if not m or not any(m.groups()):
        return None
    days, hours, minutes, _seconds = (int(g) if g else 0 for g in m.groups())
    return days * 1440 + hours * 60 + minutes


def _servings(value: Any) -> int | None:
    values = value if isinstance(value, list) else [value]
    for v in values:
        m = re.search(r"\d+", str(v or ""))
        if m:
            n = int(m.group())
            if 0 < n <= 100:
                return n
    return None


def _image(value: Any) -> str:
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        value = value.get("url") or value.get("contentUrl")
    return value if isinstance(value, str) and value.startswith("http") else ""


def _steps(value: Any) -> list[str]:
    out: list[str] = []
    if isinstance(value, str):
        return [s for s in (p.strip() for p in re.split(r"\n+", _text(value) if "<" in value else value)) if s]
    for item in value if isinstance(value, list) else [value]:
        if isinstance(item, str):
            if item.strip():
                out.append(_text(item))
        elif isinstance(item, dict):
            if (item.get("@type") == "HowToSection") or "itemListElement" in item:
                out.extend(_steps(item.get("itemListElement") or []))
            else:
                text = _text(item.get("text") or item.get("name"))
                if text:
                    out.append(text)
    return out


_MEAL_WORDS = {
    "breakfast": "breakfast", "brunch": "breakfast", "lunch": "lunch", "dinner": "dinner",
    "main": "dinner", "main course": "dinner", "entree": "dinner", "dessert": "dessert",
    "snack": "snack", "appetizer": "snack", "side": "side", "side dish": "side", "drink": "drink",
    "beverage": "drink", "cocktail": "drink",
}


def _meal_types(category: Any) -> list[str]:
    cats = category if isinstance(category, list) else [category]
    found = []
    for c in cats:
        word = _text(c).lower()
        for key, meal in _MEAL_WORDS.items():
            if key in word and meal not in found:
                found.append(meal)
    return found


def parse_recipe_html(html: str, url: str) -> dict:
    """A draft for the add-recipe form from the first schema.org Recipe on the page.
    Ingredients come back as raw lines (the form's parser structures them)."""
    collector = _LdJsonCollector()
    collector.feed(html)
    recipe = None
    for block in collector.blocks:
        try:
            data = json.loads(block.strip())
        except json.JSONDecodeError:
            continue
        recipe = next((n for n in _iter_nodes(data) if _is_recipe(n)), None)
        if recipe:
            break
    if recipe is None:
        raise ImportError_("No recipe data found on that page")

    nutrition = recipe.get("nutrition") if isinstance(recipe.get("nutrition"), dict) else {}
    calories = None
    m = re.search(r"\d+(\.\d+)?", str(nutrition.get("calories") or ""))
    if m:
        calories = float(m.group())
    keywords = recipe.get("keywords")
    if isinstance(keywords, str):
        tags = [k.strip().lower() for k in keywords.split(",") if k.strip()]
    elif isinstance(keywords, list):
        tags = [str(k).strip().lower() for k in keywords if str(k).strip()]
    else:
        tags = []
    cuisine = _text(recipe.get("recipeCuisine")) or None
    site = collector.site_name or urlparse(url).hostname or ""
    author = recipe.get("author")
    return {
        "name": _text(recipe.get("name")) or collector.title or "Imported recipe",
        "description": _text(recipe.get("description")),
        "image": _image(recipe.get("image")),
        "servings": _servings(recipe.get("recipeYield")) or 4,
        "prepTime": parse_duration(recipe.get("prepTime")),
        "cookTime": parse_duration(recipe.get("cookTime")),
        "totalTime": parse_duration(recipe.get("totalTime")),
        "cuisine": cuisine,
        "mealTypes": _meal_types(recipe.get("recipeCategory")),
        "tags": tags[:8],
        "ingredientLines": [_text(i) for i in (recipe.get("recipeIngredient") or recipe.get("ingredients") or []) if _text(i)],
        "steps": _steps(recipe.get("recipeInstructions") or []),
        "nutrition": {"calories": calories} if calories is not None else None,
        "source": {"title": site, "author": _text(author) or None, "url": url, "license": None, "year": None, "adaptation": None},
        "isPublic": False,
    }
