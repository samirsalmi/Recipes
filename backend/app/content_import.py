"""Import the curated recipe content (content/recipes/*.json) into the recipes table.

    python -m app.content_import                 # validate, upload images, sync the DB
    python -m app.content_import --dry-run       # validate only (no uploads, no DB)
    python -m app.content_import --dir backend/tests/fixtures/content/recipes

1. Validates every file against the content schema (app.schemas.ContentRecipe); fails
   loudly with file + recipe id + field, and on duplicate ids or reused photos.
2. Uploads each photo to Cloudinary as AVIF (public_id "recipes/<id>"), caching results in
   images.lock.json next to the recipes folder (content/images.lock.json) so re-runs don't
   re-upload. A Cloudinary failure aborts before any DB write - never hotlinks.
3. Canonicalizes ingredients and assigns aisles (app.recipe_data.build_data).
4. Syncs ONLY system rows (owner_id IS NULL): inserts, updates, and deletes system rows that
   are no longer in the content. User-created recipes are never touched.
Run `alembic upgrade head` first.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select

from .schemas import ContentRecipe

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "content" / "recipes"
# Wikimedia rejects requests without a descriptive User-Agent.
USER_AGENT = "MiseRecipeImporter/1.0 (personal project; recipe photo re-hosting)"
MAX_WIDTH = 2000  # some originals are 4000+ px / several MB
CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024 - 64 * 1024  # free-plan upload limit is 10 MB


class ContentError(Exception):
    pass


def load_content(content_dir: Path) -> list[ContentRecipe]:
    files = sorted(content_dir.glob("*.json"))
    if not files:
        raise ContentError(f"No *.json files in {content_dir}")
    errors: list[str] = []
    recipes: list[ContentRecipe] = []
    seen_ids: dict[str, str] = {}
    seen_images: dict[str, str] = {}
    for path in files:
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            errors.append(f"{path.name}: invalid JSON: {err}")
            continue
        if not isinstance(items, list):
            errors.append(f"{path.name}: top level must be a JSON array")
            continue
        for index, raw in enumerate(items):
            rid = raw.get("id", f"#{index}") if isinstance(raw, dict) else f"#{index}"
            try:
                recipe = ContentRecipe.model_validate(raw)
            except ValidationError as err:
                for e in err.errors():
                    field = ".".join(str(p) for p in e["loc"])
                    errors.append(f"{path.name}: {rid}: {field}: {e['msg']}")
                continue
            if recipe.id in seen_ids:
                errors.append(f"{path.name}: {recipe.id}: id: duplicate (also in {seen_ids[recipe.id]})")
                continue
            seen_ids[recipe.id] = path.name
            if recipe.image is not None:
                src = str(recipe.image.sourceUrl)
                if src in seen_images:
                    errors.append(f"{path.name}: {recipe.id}: image.sourceUrl: photo already used by {seen_images[src]}")
                seen_images[src] = recipe.id
            recipes.append(recipe)
    if errors:
        raise ContentError("Content validation failed:\n  " + "\n  ".join(errors))
    return recipes


def _download(url: str, attempts: int = 5) -> bytes:
    """The ORIGINAL file at image.sourceUrl (never a hand-built thumbnail URL - Wikimedia
    answers those with an HTML error page); refuses anything that isn't image/*. Retries a
    429 after Retry-After (capped), then gives up with the HTTPError."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                content_type = resp.headers.get("Content-Type", "")
                if not content_type.startswith("image/"):
                    raise ContentError(f"{url} returned {content_type or 'no content type'}, not an image")
                return resp.read()
        except urllib.error.HTTPError as err:
            if err.code != 429 or attempt == attempts - 1:
                raise
            retry_after = err.headers.get("Retry-After", "")
            wait = int(retry_after) if retry_after.isdigit() else 15 * 2**attempt
            print(f"  rate-limited by {url.split('/')[2]}, waiting {min(wait, 120)} s")
            time.sleep(min(wait, 120))
    raise AssertionError("unreachable")


COMMONS_THUMB_WIDTHS = (1920, 1280, 960, 640)


def _commons_thumbnail(source_url: str) -> str | None:
    """An official thumbnail URL the Commons API reports for an upload.wikimedia.org original
    (thumb.wikimedia.org, standard widths COMMONS_THUMB_WIDTHS, largest that is a real
    thumbnail). None for other hosts or on any error."""
    import json as _json
    from urllib.parse import quote, unquote, urlparse

    parsed = urlparse(source_url)
    if parsed.hostname != "upload.wikimedia.org" or "/commons/" not in parsed.path:
        return None
    filename = unquote(parsed.path.rsplit("/", 1)[-1])
    for width in COMMONS_THUMB_WIDTHS:
        api = (
            "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url"
            f"&iiurlwidth={width}&titles={quote('File:' + filename)}"
        )
        for attempt in range(3):  # the API itself answers 429 now and then
            try:
                req = urllib.request.Request(api, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    pages = _json.load(resp)["query"]["pages"]
                thumb = next(iter(pages.values()))["imageinfo"][0].get("thumburl")
                break
            except Exception:
                thumb = None
                time.sleep(5 * (attempt + 1))
        # An original narrower than `width` comes back as itself: try the next size down.
        if thumb and "/thumb/" in thumb:
            return thumb
    return None


def _shrink(data: bytes) -> bytes:
    """Re-encode an oversized original (some Commons photos are 15+ MB) as a high-quality
    JPEG at most MAX_WIDTH wide, so it fits Cloudinary's upload limit."""
    import io

    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        img = img.convert("RGB")
        img.thumbnail((MAX_WIDTH, MAX_WIDTH * 2))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=90, optimize=True)
        return out.getvalue()


def upload_image(recipe_id: str, source_url: str) -> str:
    """Upload one photo to Cloudinary as AVIF; returns the secure URL."""
    import cloudinary.uploader

    from . import cloudinary_client  # noqa: F401 - configures the SDK
    from .config import settings

    if not (settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret):
        raise ContentError("Cloudinary credentials are missing (CLOUDINARY_* in backend/.env)")
    options = dict(
        public_id=f"recipes/{recipe_id}",
        overwrite=True,
        resource_type="image",
        format="avif",  # stored as AVIF regardless of the source format (CLAUDE.md convention)
        transformation=[{"width": MAX_WIDTH, "crop": "limit"}],  # incoming: cap the stored size
    )
    # 1. Let Cloudinary fetch the original itself (its servers, not this machine, talk to
    #    Wikimedia, so local rate limits don't apply).
    try:
        result = cloudinary.uploader.upload(source_url, **options)
        return result["secure_url"]
    except Exception as err:  # too large (> 10 MB), remote 429, ...
        print(f"  {recipe_id}: Cloudinary fetch failed ({err}); downloading locally")
    # 2. Wikimedia Commons rate-limits originals hard; its API hands out an official
    #    standard-size thumbnail on thumb.wikimedia.org, which is served freely. (Never a
    #    hand-built thumbnail URL: arbitrary widths return an HTML error page.)
    thumb = _commons_thumbnail(source_url)
    if thumb:
        try:
            data = _download(thumb, attempts=2)
            result = cloudinary.uploader.upload(data, **options)
            return result["secure_url"]
        except Exception as err:
            print(f"  {recipe_id}: Commons thumbnail failed ({err}); downloading the original")
    # 3. Download the original here (descriptive User-Agent, 429 retries), shrink, upload bytes.
    data = _download(source_url)
    if len(data) > CLOUDINARY_MAX_BYTES:
        data = _shrink(data)
    result = cloudinary.uploader.upload(data, **options)
    return result["secure_url"]


def resolve_images(
    recipes: list[ContentRecipe], lock_path: Path, *, skip_upload: bool = False, uploader=upload_image, pace: float = 0.0
) -> dict[str, str]:
    """recipe id -> hosted image URL ("" when the recipe has no photo). Uses and updates the
    lockfile; re-uploads when a recipe's sourceUrl changed."""
    lock: dict[str, Any] = json.loads(lock_path.read_text(encoding="utf-8")) if lock_path.exists() else {}
    urls: dict[str, str] = {}
    uploaded = 0
    for recipe in recipes:
        if recipe.image is None:
            urls[recipe.id] = ""
            continue
        src = str(recipe.image.sourceUrl)
        cached = lock.get(recipe.id)
        if cached and cached.get("sourceUrl") == src and cached.get("url"):
            urls[recipe.id] = cached["url"]
            continue
        if skip_upload:
            urls[recipe.id] = cached.get("url", "") if cached else ""
            continue
        if pace and uploaded:
            time.sleep(pace)  # be polite to Wikimedia between downloads
        uploaded += 1
        try:
            url = uploader(recipe.id, src)
        except ContentError as err:
            raise ContentError(f"Image for {recipe.id}: {err}") from err
        except Exception as err:  # network, Cloudinary auth ("Invalid Signature"), ...
            raise ContentError(f"Image upload failed for {recipe.id} ({src}): {err}") from err
        lock[recipe.id] = {"sourceUrl": src, "url": url}
        urls[recipe.id] = url
        lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"  uploaded {recipe.id}")
    return urls


def to_fields(recipe: ContentRecipe, image_url: str) -> dict[str, Any]:
    d = recipe.model_dump(mode="json")
    image = d.pop("image")
    d["image"] = image_url
    d["imageCredit"] = (
        {"author": image["author"], "license": image["license"], "pageUrl": image.get("pageUrl") or image["sourceUrl"]}
        if image else None
    )
    return d


def sync(db, recipes: list[ContentRecipe], image_urls: dict[str, str]) -> tuple[int, int, int]:
    """Insert/update/delete system rows (owner_id IS NULL) only. Returns (added, updated, removed)."""
    from .models import RecipeRow
    from .recipe_data import build_data
    from .routers.recipes import detach_recipe

    content_ids = {r.id for r in recipes}
    existing = {row.id: row for row in db.execute(select(RecipeRow)).scalars()}
    added = updated = removed = 0
    for recipe in recipes:
        row = existing.get(recipe.id)
        if row is not None and row.owner_id is not None:
            raise ContentError(f"{recipe.id}: id is already used by a user-created recipe")
        fields = to_fields(recipe, image_urls.get(recipe.id, ""))
        author = recipe.source.author
        date_added = row.data.get("dateAdded") if row is not None else None
        data = build_data(fields, recipe_id=recipe.id, author=author, date_added=date_added)
        if row is None:
            db.add(RecipeRow(id=recipe.id, data=data, owner_id=None, is_public=True, is_official=True, parent_recipe_id=None))
            added += 1
        elif row.data != data:
            row.data = data
            row.is_public = True
            updated += 1
    for row_id, row in existing.items():
        if row.owner_id is None and row_id not in content_ids:
            detach_recipe(db, row_id, row.data.get("name", "Removed recipe"))
            db.delete(row)
            removed += 1
    db.commit()
    return added, updated, removed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="folder of content *.json files")
    parser.add_argument("--lock", type=Path, default=None, help="image lockfile (default: <dir>/../images.lock.json)")
    parser.add_argument("--dry-run", action="store_true", help="validate only")
    parser.add_argument("--skip-images", action="store_true", help="don't upload; use lockfile URLs or no photo")
    parser.add_argument("--pace", type=float, default=3.0, help="seconds to wait between photo downloads (Wikimedia rate limits)")
    args = parser.parse_args(argv)

    content_dir = args.dir.resolve()
    lock_path = (args.lock or content_dir.parent / "images.lock.json").resolve()
    try:
        recipes = load_content(content_dir)
        print(f"Validated {len(recipes)} recipes from {content_dir}")
        if args.dry_run:
            return 0
        image_urls = resolve_images(recipes, lock_path, skip_upload=args.skip_images, pace=args.pace)

        from .cache import invalidate_recipes
        from .database import SessionLocal

        db = SessionLocal()
        try:
            added, updated, removed = sync(db, recipes, image_urls)
        finally:
            db.close()
        invalidate_recipes()
        print(f"Content sync: {added} added, {updated} updated, {removed} removed (system recipes only).")
        return 0
    except ContentError as err:
        print(f"ERROR: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
