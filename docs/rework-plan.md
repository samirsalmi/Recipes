# Rework plan: "Mise", a shared kitchen planner

Status: approved for execution 2026-10-19. Supervisor: Claude (Opus, no coding). Implementers: subagents.
Backup of the pre-rework uncommitted work: see the supervisor's scratchpad `wip-backup/` (patch + untracked files).

## 1. What the app is for (the one sentence every screen must serve)

> A household picks recipes, drops them on days, and always has an accurate, shared grocery list, even when the plan changes on Wednesday.

Everything else (browsing, cooking mode, cookbook) supports that loop. Features that don't help it are cut or demoted.

## 2. What's wrong today (and the fix)

| Problem | Fix |
|---|---|
| Planning is per account; two people can't plan together | **Households**: every account belongs to one household; plan + groceries are shared; invite by link/code; live updates |
| Meal plan and shopping list are whole-object JSON blobs in `app_storage` (last write wins - two editors clobber each other) | Real tables: one row per planned meal, per shopping mark, per extra item |
| Shopping list is a one-shot snapshot; changing the plan mid-week makes it wrong; merges ignore units (G8) | List is **derived live** from the plan for a date range ("a shop"); stores *purchased quantity* per item, so a plan change shows "+4 more eggs needed" or "no longer needed (already bought)"; unit-aware merging |
| Colors/visual design disliked; not mobile-first | New identity (section 6), bottom tab bar on mobile, bottom sheets, PWA |
| Recipes are few, generic, unsourced, images don't match | ~80 sourced recipes, 20+ cuisines, each from a free-to-use book/collection with attribution; every photo verified by eye (section 5) |
| Adding a recipe is a chore (nutrition, categories, per-ingredient dropdowns...) | Only **name + ingredients** required. Paste ingredients as text (parsed live), steps as text, everything else under "More details". Import from a URL (schema.org JSON-LD) |
| Fake ratings / review counts on seed data | Removed. Replaced by real signals: "Cooked 3x" (from plan history) and favorites |

## 3. Information architecture

Mobile: bottom tab bar (5). Desktop (>= lg): left rail or top bar with the same 5 destinations.

1. **Discover** (`/`): search (matches names + ingredients), "Tonight" card if something's planned today, cuisine explorer row (photo circles), meal-type row, curated shelves (Quick weeknights <= 30 min, Vegetarian, Breakfast, Sweet things, From the old books), full browse with a filter bottom sheet (meal type, time, diet, cuisine). `/cuisines/:slug` cuisine page.
2. **Plan** (`/plan`): the shared week. Mobile = vertical agenda (one card per day, slots Breakfast/Lunch/Dinner, optional Snack). Desktop = 7-column grid with drag-and-drop. Today highlighted. Week nav. Each meal shows recipe photo, servings, and the avatar of who added it.
   - Add meal -> bottom sheet picker: search + tabs "Favorites (yours + household)", "Recently cooked", "Quick", "Suggested".
   - Non-recipe entries: "Leftovers", "Eating out", or free text (real life changes mid-week).
   - Meal actions: move to another day/slot, change servings, swap recipe, remove. Desktop drag-and-drop; mobile action sheet.
   - Helpers: "Copy last week", "Fill empty dinners" (varied cuisines, respects household diet, quick on weekdays).
   - Default servings = household size setting.
3. **Groceries** (`/groceries`): see section 4.
4. **Cookbook** (`/cookbook`): tabs Favorites / My recipes / Collections (collections kept but simplified). "Add recipe" FAB.
5. **Household** (`/household`): members (avatars), invite link + code (Web Share API on mobile), household size, diet preferences (vegetarian, no pork, no alcohol, allergies: nuts, gluten, dairy), units (metric/US), theme, account, credits link, log out.

Also: recipe detail `/recipes/:id`, cooking mode `/cook/:id`, add/edit recipe, `/join/:code`, login/register, onboarding, `/credits` (all sources + licenses).

Public without an account: Discover, recipe detail, cooking mode, credits. Everything else requires login (keep the existing `authGuard` pattern and the G13 rules).

### Onboarding (after register, 3 skippable screens)
1. "Who are you cooking for?" household size + diet preferences.
2. "Cook together?" invite link to share, or "I have a code" -> join.
3. "Plan your first week" -> Plan page with a "Fill empty dinners" nudge.

## 4. Collaboration + groceries design (the heart of the rework)

### Households
- On register an account gets a personal household ("Samir's kitchen"). Joining another via code moves the user: if their old household had only them, its future meal entries are merged into the new household and the old one is deleted.
- One household per user. Roles: owner / member. Owner can regenerate the invite code and remove members; anyone can leave.
- Invite code: 8 chars, unambiguous alphabet, unique; join link `/join/CODE`.
- Every household endpoint checks membership server-side. No endpoint takes a household id from the client; it resolves "my household" from the token.

### Live updates
- `household_activity` table (autoinc id, household_id, user_id, type, payload JSON, created_at). Every plan/grocery mutation writes a row.
- Client polls `GET /api/household/activity?since=<lastId>` every ~8s while the tab is visible, and immediately on focus. New events from *other* members -> refresh the affected data + a subtle toast ("Amina moved Couscous to Thursday"). Also an activity feed on the Household page.
- No websockets/SSE (keeps deploy simple; polling is cheap with the cursor).

### Meal plan storage
- `meal_plan_entries`: id (server-assigned), household_id, date (DATE), slot (breakfast|lunch|dinner|snack), position, recipe_id (nullable FK), custom_title (nullable, for Leftovers/Eating out/free text), servings, added_by, created_at, updated_at.
- Endpoints: list by date range, create, patch (move/servings/swap), delete, copy-week, fill-suggestions (returns proposals; client confirms).
- Dates are plain `YYYY-MM-DD` local dates end to end (fixes G5: no `toISOString()` for dates).

### Groceries = "a shop"
- `shopping_trips`: id, household_id, start_date, end_date, created_by, created_at, closed_at. One open trip per household. Default range when first opened: today through the end of the current plan week.
- **Needed** = ingredients of every recipe entry in [start, end], scaled by entry servings / recipe servings, canonicalized and merged (computed server-side in `backend/app/groceries.py`).
- `shopping_marks`: (trip_id, item_key) PK, purchased_qty (decimal, in the item's base unit; null = "checked, no quantity"), checked_by, updated_at.
- `shopping_extras`: manual items ("paper towels") per trip, auto-categorized, checkable.
- Pantry staples (salt, pepper, oil, water, ...; editable per household in settings) go to a collapsed "You probably have these" section with "I need it" to promote.
- Item states the UI must show:
  - to buy (remaining = needed - purchased > 0); if purchased > 0 show "+N more needed" (plan grew after you bought it);
  - in the cart (remaining <= 0), sinks to the bottom;
  - "No longer needed, already bought" when a meal was removed after purchase;
  - "new" dot for items added since this user last viewed the list.
- Tap item -> expands sources: "Tue dinner - Shakshuka (3), Thu lunch - Menemen (4)".
- Grouped by aisle (Produce, Meat & fish, Dairy & eggs, Bakery, Pantry, Spices, Frozen, Drinks, Household, Other), aisle icons, fixed order.
- Header: range chip "Mon 20 - Sun 26 - 9 meals" (tap to change range), progress, "Start a new shop" (closes trip), "Share as text" (Web Share -> WhatsApp).
- Partner checks things off in the store -> it updates on your phone within seconds (activity polling).
- Offline (stretch, phase 4): service worker caches the app shell + last groceries payload; check-offs queue and sync when back online.

### Unit-aware merging (`backend/app/groceries.py`)
- Canonical ingredient dictionary: aliases (EN, plus FR / Arabic-latin spellings ported from `src/app/utils/ingredient-merge.ts`, which is then deleted), aisle, pantry-staple flag, optional density/piece weight is NOT used (don't guess conversions across mass/volume).
- Unit families: mass (g, kg, oz, lb), volume (ml, l, tsp, tbsp, cup, fl oz), count (piece/none, clove, can, bunch, slice, ...). Convert within a family to a base unit, sum, then pretty-print (1500 g -> 1.5 kg, 0.5 tsp -> ½ tsp). Different families of the same ingredient stay as one item with a combined label ("Butter: 200 g + 2 tbsp").
- Item key = canonical name + unit family.
- Unit tests required (pytest).

## 5. Recipe content

### Rules
- Target **~80 recipes, 20+ cuisines**, mix of meal types: >= 10 breakfast, >= 10 desserts/sweets/baking, >= 20 vegetarian, >= 15 that take <= 30 min total.
- Sources must be free to use for a non-commercial app, and every recipe carries attribution:
  - Public domain books (e.g. Project Gutenberg cookbooks; pre-1930 US / author dead 70+ years).
  - Wikibooks Cookbook (CC BY-SA 4.0: attribute, adapted text stays CC BY-SA).
  - US-government works such as USDA MyPlate Kitchen (public domain unless the page says otherwise; check each page).
  - FAO / UN cookbooks under CC BY-NC-SA 3.0 IGO (non-commercial only, fine here).
  - Never copy text from copyrighted blogs/sites. You may *consult* them only to sanity-check a fact (oven temp, cook time), never copy wording.
- **Accuracy**: faithful to the source; old measures ("a teacupful", "butter the size of an egg", "a quick oven") converted to modern metric with the conversion noted in `source.adaptation`. Quantities sanity-checked for the serving count. No invented nutrition (leave `nutrition: null` unless the source states it).
- **Photos**: real photo of *that dish*, from Wikimedia Commons (or the source itself if openly licensed). The researcher must download the candidate and **look at it** (Read tool) before accepting: finished, appetizing, clearly the dish, no watermark/text overlay, no prominent faces, ideally >= 1200 px wide, landscape. No photo reused for two recipes. If no good photo exists, choose a different dish.
- Images get re-hosted to Cloudinary as AVIF by the importer (keeps the CLAUDE.md convention); researchers only record the source.

### Recipe content schema (one JSON array per file in `content/recipes/<batch>.json`)

```jsonc
{
  "id": "tunisian-shakshuka",            // kebab-case, globally unique, stable
  "name": "Shakshuka",
  "description": "Eggs poached in a spiced tomato and pepper sauce. One pan, 30 minutes.", // 1-2 sentences, factual + appetizing
  "cuisine": "Tunisian",                 // display name; see allowed list per batch
  "region": "North Africa & Middle East",// one of: "North Africa & Middle East", "South Asia", "East Asia", "Southeast Asia", "Sub-Saharan Africa", "Europe", "Americas"
  "mealTypes": ["breakfast", "lunch"],  // any of breakfast | lunch | dinner | dessert | snack | side | drink
  "servings": 4,
  "prepTime": 10,                        // minutes, integer, null if unknown
  "cookTime": 20,                        // minutes, integer, null if unknown
  "difficulty": "easy",                  // easy | medium | hard
  "diet": { "vegetarian": true, "vegan": false, "glutenFree": true, "dairyFree": true,
            "containsPork": false, "containsAlcohol": false, "containsNuts": false },
  "tags": ["one-pan", "eggs"],           // lowercase, few
  "traditional": true,                   // long-established home/heritage cooking of that cuisine (not a modern or fusion invention)
  "budget": "low",                       // low | medium | high: cost of the main ingredients for the serving count.
                                         // low = built on cheap staples (dried legumes, grains, flour, eggs, potatoes, seasonal veg,
                                         // small amounts of cheap cuts); high = lots of meat/seafood/nuts/cheese, saffron, specialty items
  "ingredients": [
    { "group": null, "quantity": 2, "unit": "tbsp", "name": "olive oil", "note": null },
    { "group": null, "quantity": 1, "unit": null, "name": "onion", "note": "finely chopped" },
    { "group": null, "quantity": 400, "unit": "g", "name": "tomatoes", "note": "chopped, or 1 can" },
    { "group": null, "quantity": null, "unit": null, "name": "salt", "note": "to taste" },
    { "group": null, "quantity": 100, "unit": "g", "name": "chicken fillet", "note": "cut small", "optional": true }
  ],
  // "optional": true (omit otherwise) marks add-ins/garnishes the dish works without. Groceries exclude optional
  // ingredients by default (shown as "optional extras" the user can add); diet flags describe the dish WITHOUT them.
  // units allowed: g, kg, ml, l, tsp, tbsp, cup, pinch, clove, can, bunch, slice, piece, sprig, stick, leaf, null.
  // Prefer metric g/ml for anything larger than a few tablespoons. "name" is the plain ingredient (no prep words) so groceries merge cleanly.
  "steps": [
    { "text": "Warm the oil in a wide pan over medium heat and soften the onion, about 8 minutes.", "timerMinutes": 8 }
  ],
  "tips": ["..."],                       // optional, [] if none
  "nutrition": null,
  "source": {
    "title": "The Italian Cook Book", "author": "Maria Gentile", "year": 1919,
    "url": "https://www.gutenberg.org/ebooks/24407",
    "license": "Public domain",          // or "CC BY-SA 4.0", "CC BY-NC-SA 3.0 IGO", "US Government work (public domain)"
    "adaptation": "Converted 'a pound' and 'a teacupful' to grams/ml; added pan size."
  },
  "image": {
    "sourceUrl": "https://upload.wikimedia.org/wikipedia/commons/...jpg",  // direct original file URL
    "pageUrl": "https://commons.wikimedia.org/wiki/File:...",
    "author": "Plain-text author name",
    "license": "CC BY-SA 4.0",
    "verified": "Seen: cast-iron pan of red sauce with four set eggs, parsley on top."
  }
}
```

### Traditional + budget (added 2026-10-20 at the owner's request)
- Every recipe carries `traditional` and `budget` (schema above). Discover gets a "Traditional" filter + "Heritage dishes" shelf and a "Budget-friendly" filter + "Feed everyone for less" shelf; recipe cards show a small budget indicator; the planner's "Fill empty dinners" gets a "Budget week" option that prefers `budget: "low"`; the household settings get "Prefer budget recipes".
- Second content wave: `maghreb-traditional.json` (12, Algerian-first), `budget-world.json` (16 low-budget traditional dishes), `heritage-world.json` (16 traditional dishes from cuisines not yet covered). Target total ~130.
- Third content wave (halal dinners, requested by the owner): `algerian-dinners.json` (30 Algerian mains, couscous variants, soups, sides) and `halal-dinners.json` (12 mains from Moroccan, Tunisian, Saudi, Palestinian, Pakistani, Afghan, Turkish, Egyptian and Lebanese kitchens), all written for Mise (license "Original") with a Wikipedia reference link; total 171.
- Fourth content wave (more halal dinners, mostly Algerian by region): `algerian-regions.json` (23 Kabyle, Saharan/Tuareg, Constantinois, Mozabite, Algiers and everyday dishes) and `halal-dinners-2.json` (Libyan, Palestinian, Yemeni, Uzbek, Jordanian); total 200. Four recipes are adapted from French Wikibooks (CC BY-SA 4.0) with the page's quantities noted; the others are "Original" with a Wikipedia article (opened and cited in `source.adaptation`) for dish identity. Several wave-3 sources were upgraded to the specific Wikipedia/Wikibooks page; no official ministry or public-domain Algerian cookbook source was found.

### Batches (parallel researchers)
| Batch file | Region / cuisines | Count |
|---|---|---|
| `north-africa-middle-east.json` | Algerian (>= 4), Moroccan, Tunisian, Egyptian, Lebanese/Levantine, Turkish, Persian | 18 |
| `south-and-east-asia.json` | Indian, Sri Lankan, Chinese, Japanese, Korean | 16 |
| `southeast-asia-africa.json` | Thai, Vietnamese, Filipino, Indonesian/Malaysian, Ethiopian, West African, East African | 16 |
| `europe.json` | Italian, French, Spanish, Greek, British/Irish, Central & Eastern European, Nordic | 16 |
| `americas.json` | Mexican, Peruvian, Brazilian, Caribbean, US (incl. Southern), Argentine | 16 |

## 6. Visual identity

Direction: **warm editorial**, like a good food magazine, photo-led, calm. Not orange, not "SaaS dashboard".

- Background "paper" `#FAF7F2`, surface `#FFFFFF`, ink `#1E1B16`, muted ink `#6B645A`, hairline `#E9E3D8`.
- Primary **deep herb green** `#1F4D3A` (hover `#173B2C`, tint `#E3EDE7`).
- Accent **paprika** `#D9532B` used sparingly (badges, "new" dots, the active tab dot). Highlight **saffron** `#E8B04B` for tags/"tonight".
- Dark mode: warm charcoal `#151412` bg, surface `#1F1D1A`, ink `#F3EEE6`, primary lifts to `#7FB89A`.
- Type: **Fraunces** (variable serif) for display/headings, **Inter** for UI/body. Generous sizes on mobile.
- Shape: radius 16-24 px for cards/sheets, pill chips, soft single-layer shadows; no glassmorphism.
- Photography first: big images, 4:3 cards, full-bleed hero on detail, gradient scrim for overlaid titles.
- Motion: Angular router view transitions (card image morphs into the detail hero), sheet slide-ups, check-off animation; all disabled under `prefers-reduced-motion`.
- Tokens as CSS variables (light/dark) mapped into `tailwind.config.js`; keep class-based dark mode (`dark` on `<html>`, per CLAUDE.md).
- Mobile: 16 px gutters, 44 px min tap targets, safe-area insets, bottom sheets instead of modals, no horizontal page scroll at 360 px.
- Accessibility: WCAG AA contrast, visible focus rings, labelled icon buttons.

## 7. Adding a recipe (no chores)

- Required: **name**, **ingredients** (>= 1). Servings pre-filled (4).
- Ingredients: one textarea, one per line. Live parser shows chips of how each line was understood (qty / unit / name / note). Handles `1 1/2`, `½`, `1-2`, `2 cups flour, sifted`, `a pinch of salt`, `salt to taste`, section headers ending in `:` -> group. Unit synonyms incl. common French (c. à soupe, c. à café, gousse).
- Steps: one textarea, split on blank lines/numbering; timers detected from text ("for 10 minutes") at cooking time, never asked for.
- Photo: optional, camera or file, uploaded to `POST /api/images` (AVIF, keep as is).
- "More details" (collapsed, all optional): description, times, cuisine, meal types, diet flags, tags, tips, calories, source link.
- Ingredient aisle category assigned server-side from the canonical dictionary. No per-ingredient dropdowns.
- **Import from a link**: `POST /api/recipes/import-url` fetches the page server-side (timeout, size cap, http/https only, block private IP ranges), reads schema.org `Recipe` JSON-LD, returns a draft that prefills the form. Imported recipes default to private with the source URL attached.
- Draft autosaves to localStorage (per-device convenience, wrapped in try/catch).

## 8. Recipe detail + cooking mode

- Full-bleed hero, title, cuisine + time + servings chips, source line ("Adapted from *The Italian Cook Book*, 1919").
- Sticky mobile action bar: **Add to plan** (sheet: pick day + slot + servings), **Cook**, heart.
- Servings stepper with nice fractions; metric/US toggle (household setting, overridable here).
- Ingredient checklist; grouped ingredients.
- Steps with tappable inline timers (detected).
- Personal notes, "Cooked N times" (from household plan history).
- Footer: recipe license + photo credit (author, license, link).
- Overflow menu: "Copy to my recipes & edit" (the old "twist"), share, print, (owner) edit/visibility/delete.
- Cooking mode: one step per screen, swipe/arrow keys, big type, Screen Wake Lock, step's ingredients shown, timers (multiple concurrent, sound/vibration when done).

## 9. Cut / demoted

- Aggregate star ratings + review counts (fake on seed data): removed from model and UI.
- "Official" badge: replaced by the source badge on seeded recipes; admin curation endpoint can stay unused.
- Twists: kept server-side, surfaced only as "Copy to my recipes & edit".
- Nutrition: optional calories only in the form (macros under an extra disclosure), never shown when absent.
- Old `app_storage` keys `mealPlan` and `shoppingList`: replaced by tables (best-effort migration of meal plans; old shopping lists dropped). `favorites` moves to a `favorites` table so household members can see each other's favorites in the planner. Notes/recentViews/darkMode may stay in `app_storage`.
- `src/app/data/mock-recipes.ts`, `backend/app/seed_data.json`, `backend/app/seed.py`: replaced by `content/recipes/*.json` + `backend/app/content_import.py`.

## 10. Content importer (`python -m app.content_import`)

- Validates every file against the schema above (fails loudly with file + id + field).
- Uploads each image to Cloudinary (`public_id` = `recipes/<id>`, `format="avif"`), caching results in `content/images.lock.json` so re-runs don't re-upload. If Cloudinary fails, abort with a clear message (do not silently hotlink).
- Canonicalizes ingredients, assigns aisle categories.
- Syncs only system rows (`owner_id IS NULL`): insert/update, delete system rows missing from content. **Never touches user-created recipes** (the old seed.py deleted every row not in the file; fix that).
- `python -m app.demo` (separate): creates two demo accounts in one household with a planned current week and a partly checked shop, so the collaboration can be shown immediately.

## 11. Phases + acceptance

| Phase | Who | Done when |
|---|---|---|
| 0 Plan | supervisor | this doc |
| 1 Content research | 5 researcher agents (parallel) | 5 batch files, schema-valid, all photos eyeballed, sources/licenses recorded |
| 2 Foundations | coder | branch `rework`; DB running; Alembic migration for households, meal_plan_entries, favorites, shopping_trips/marks/extras, household_activity; recipe model v2 (front + back); household/plan/groceries/favorites/activity APIs with pytest coverage (membership checks, join/merge, grocery merge + deltas + purchased qty); `content_import` + `demo`; design tokens + fonts + app shell (bottom tabs / desktop nav); `npm run build` + tests green |
| 3 Screens | coder | Discover, cuisine page, recipe detail, cooking mode, Plan, Groceries, Cookbook, Household, onboarding, join, add/edit (parser + import-url), auth pages, credits |
| 4 Polish | coder | view transitions, skeletons, empty states, toasts for partner activity, PWA (installable, offline groceries), a11y pass, dark mode pass, 360/390/768/1440 px checks |
| 5 Review | supervisor | browser walkthrough (two accounts side by side), build, tests, codebase map check; fix list back to coder until clean |

Database (changed 2026-10-20 by the owner): **PostgreSQL 18** replaces MySQL. Local dev cluster runs on localhost:5434 (the 5433 service belongs to another app). Driver `psycopg` v3, JSONB columns, single fresh Alembic baseline for the v2 schema.

Engineering rules for all phases: follow CLAUDE.md conventions (standalone components, lazy routes, signals + `computed()`, `StorageService`-style Observables for HTTP), update the codebase map + CLAUDE.md in the same change as code, `node .claude/skills/codebase-map/scripts/check-map.mjs` must pass, `npm run build` + `npm test` + backend pytest must pass at the end of each phase. No commits/pushes unless the user asks.
