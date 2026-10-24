import datetime as dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

MealType = Literal["breakfast", "lunch", "dinner", "dessert", "snack", "side", "drink"]
Slot = Literal["breakfast", "lunch", "dinner", "snack"]
Difficulty = Literal["easy", "medium", "hard"]
Budget = Literal["low", "medium", "high"]
Region = Literal[
    "North Africa & Middle East",
    "South Asia",
    "East Asia",
    "Southeast Asia",
    "Sub-Saharan Africa",
    "Europe",
    "Americas",
]
ContentUnit = Literal[
    "g", "kg", "ml", "l", "tsp", "tbsp", "small cup", "cup", "pinch", "clove", "can", "bunch", "slice",
    "piece", "sprig", "stick", "leaf",
]
# Household diet preference slugs (Household page): filters "Fill empty dinners".
DIET_PREFS = ("vegetarian", "vegan", "no-pork", "no-alcohol", "nut-free", "gluten-free", "dairy-free")
Units = Literal["metric", "us"]
Aisle = Literal["produce", "meat-fish", "dairy-eggs", "bakery", "pantry", "spices", "frozen", "drinks", "household", "other"]


class StorageValue(BaseModel):
    """Wraps an arbitrary JSON value for the generic storage endpoints."""

    value: Any = None


# ---------- recipe v2 ----------


class DietFlags(BaseModel):
    vegetarian: bool = False
    vegan: bool = False
    glutenFree: bool = False
    dairyFree: bool = False
    containsPork: bool = False
    containsAlcohol: bool = False
    containsNuts: bool = False


Language = Literal["en", "fr", "ar"]


class RecipeTranslation(BaseModel):
    """Optional author/editor-provided text for one language (extension point: nothing in the
    app generates these). The client prefers it over the recipe's own text when present."""

    name: str | None = Field(default=None, max_length=255)
    description: str | None = None
    steps: list[str] | None = None
    tips: list[str] | None = None


class IngredientIn(BaseModel):
    group: str | None = None
    quantity: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=255)
    optional: bool = False  # garnish/add-in: left off the grocery list by default
    # The user's aisle pick for a name the dictionary doesn't know. Ignored for known names
    # (the dictionary's aisle wins).
    aisle: Aisle | None = None


class IngredientCheckIn(BaseModel):
    """Ingredient names typed in the recipe form; the answer says which ones are unknown."""

    names: list[str] = Field(min_length=1, max_length=100)

    @field_validator("names")
    @classmethod
    def _short_names(cls, names: list[str]) -> list[str]:
        return [n.strip()[:255] for n in names if n and n.strip()]


class IngredientAisleIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    aisle: Aisle


class StepIn(BaseModel):
    text: str = Field(min_length=1)
    timerMinutes: int | None = Field(default=None, ge=0)


class NutritionIn(BaseModel):
    calories: float | None = Field(default=None, ge=0)
    protein: float | None = Field(default=None, ge=0)
    carbs: float | None = Field(default=None, ge=0)
    fat: float | None = Field(default=None, ge=0)


class SourceIn(BaseModel):
    title: str | None = None
    author: str | None = None
    year: int | None = None
    url: str | None = None
    license: str | None = None
    adaptation: str | None = None


class ImageCreditOut(BaseModel):
    author: str | None = None
    license: str | None = None
    pageUrl: str | None = None


class RecipeIn(BaseModel):
    """Create payload: only name + ingredients are required. id, author, dateAdded, ownerId,
    isOfficial, parentRecipeId and each ingredient's aisle are assigned server-side
    (routers/recipes.py create_recipe)."""

    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    image: str = ""
    cuisine: str | None = None
    region: str | None = None
    mealTypes: list[MealType] = []
    servings: int = Field(default=4, ge=1, le=100)
    prepTime: int | None = Field(default=None, ge=0)
    cookTime: int | None = Field(default=None, ge=0)
    difficulty: Difficulty | None = None
    traditional: bool = False
    budget: Budget | None = None
    diet: DietFlags = DietFlags()
    tags: list[str] = []
    ingredients: list[IngredientIn] = Field(min_length=1)
    steps: list[StepIn] = []
    tips: list[str] = []
    nutrition: NutritionIn | None = None
    source: SourceIn | None = None
    translations: dict[Language, RecipeTranslation] | None = None
    isPublic: bool = True


class RecipeUpdateIn(BaseModel):
    """Owner PATCH: any field (only provided ones change), plus isPublic."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    image: str | None = None
    cuisine: str | None = None
    region: str | None = None
    mealTypes: list[MealType] | None = None
    servings: int | None = Field(default=None, ge=1, le=100)
    prepTime: int | None = Field(default=None, ge=0)
    cookTime: int | None = Field(default=None, ge=0)
    difficulty: Difficulty | None = None
    traditional: bool | None = None
    budget: Budget | None = None
    diet: DietFlags | None = None
    tags: list[str] | None = None
    ingredients: list[IngredientIn] | None = Field(default=None, min_length=1)
    steps: list[StepIn] | None = None
    tips: list[str] | None = None
    nutrition: NutritionIn | None = None
    source: SourceIn | None = None
    translations: dict[Language, RecipeTranslation] | None = None
    isPublic: bool | None = None


class OfficialUpdateIn(BaseModel):
    """Admin-only: curate a recipe's "official" badge (unused by the v2 UI)."""

    isOfficial: bool


class ImportUrlIn(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


# ---------- content files (content/recipes/*.json), validated by app.content_import ----------


class ContentIngredient(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group: str | None
    quantity: float | None = Field(ge=0)
    unit: ContentUnit | None
    name: str = Field(min_length=1)
    note: str | None
    optional: bool = False


class ContentStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1)
    timerMinutes: int | None = Field(default=None, ge=0)


ORIGINAL_LICENSE = "Original"  # written for the app from the traditional method (no free source)


class ContentSource(BaseModel):
    """Where a curated recipe comes from. license "Original" marks a recipe written for the app
    (author "Mise kitchen"); it may cite a reference link instead of a free source."""

    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1)
    author: str | None = None
    year: int | None = None
    url: HttpUrl | None = None
    license: str = Field(min_length=1)
    adaptation: str | None = None

    @model_validator(mode="after")
    def _url_unless_original(self) -> "ContentSource":
        if self.url is None and self.license != ORIGINAL_LICENSE:
            raise ValueError("url is required unless license is \"Original\"")
        return self


class ContentImage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceUrl: HttpUrl
    pageUrl: HttpUrl | None = None
    author: str = Field(min_length=1)
    license: str = Field(min_length=1)
    verified: str | None = None


class ContentRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    cuisine: str = Field(min_length=1)
    region: Region
    mealTypes: list[MealType] = Field(min_length=1)
    servings: int = Field(ge=1, le=100)
    prepTime: int | None = Field(ge=0)
    cookTime: int | None = Field(ge=0)
    difficulty: Difficulty
    traditional: bool
    budget: Budget
    diet: DietFlags
    tags: list[str] = []
    ingredients: list[ContentIngredient] = Field(min_length=1)
    steps: list[ContentStep] = Field(min_length=1)
    tips: list[str] = []
    nutrition: NutritionIn | None = None
    source: ContentSource
    image: ContentImage | None
    translations: dict[Language, RecipeTranslation] | None = None

    @field_validator("tags")
    @classmethod
    def _lower_tags(cls, tags: list[str]) -> list[str]:
        return [t.strip().lower() for t in tags if t.strip()]


# ---------- auth ----------


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=255, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=255)
    language: Language = "en"


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    isAdmin: bool
    language: Language = "en"


class ProfileUpdateIn(BaseModel):
    """PATCH /api/auth/me: the account's own preferences (only provided fields change)."""

    language: Language | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---------- household ----------


class HouseholdUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    size: int | None = Field(default=None, ge=1, le=20)
    diet: list[str] | None = None
    units: Units | None = None
    pantryStaples: list[str] | None = None
    preferBudget: bool | None = None

    @field_validator("diet")
    @classmethod
    def _known_diet(cls, diet: list[str] | None) -> list[str] | None:
        if diet is None:
            return None
        unknown = [d for d in diet if d not in DIET_PREFS]
        if unknown:
            raise ValueError(f"unknown diet preference(s): {', '.join(unknown)}")
        return sorted(set(diet))


class JoinIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    today: dt.date | None = None  # client's local date, for "future entries" in the merge rule


# ---------- meal plan ----------


class PlanEntryIn(BaseModel):
    date: dt.date
    slot: Slot
    recipeId: str | None = None
    customTitle: str | None = Field(default=None, max_length=255)
    servings: int | None = Field(default=None, ge=1, le=100)


class PlanEntryPatch(BaseModel):
    date: dt.date | None = None
    slot: Slot | None = None
    position: int | None = Field(default=None, ge=0)
    recipeId: str | None = None
    customTitle: str | None = Field(default=None, max_length=255)
    servings: int | None = Field(default=None, ge=1, le=100)


class CopyWeekIn(BaseModel):
    fromStart: dt.date
    toStart: dt.date


class FillIn(BaseModel):
    start: dt.date
    end: dt.date
    slot: Slot = "dinner"
    # "Budget week": favour budget "low" recipes. None = use the household's preferBudget.
    budget: bool | None = None
    # Only propose dinners from these cuisines (spread across them). None/empty = any cuisine.
    cuisines: list[str] | None = Field(default=None, max_length=100)


# ---------- groceries ----------


class TripRangeIn(BaseModel):
    start: dt.date
    end: dt.date


class MarkIn(BaseModel):
    key: str = Field(min_length=1, max_length=180)  # item key (canonical name)
    # part key -> purchased quantity in the part's base unit (None = checked, no quantity).
    # Omitted: every part is marked bought at its current needed amount.
    quantities: dict[str, float | None] | None = None


class UnmarkIn(BaseModel):
    key: str = Field(min_length=1, max_length=180)


class HaveIn(BaseModel):
    """"I have N at home" for one part of a grocery item. `key` is the part key
    ("<canonical name>|<family>"). `quantity` is in `unit` (a base unit when omitted); null or 0
    clears it."""

    key: str = Field(min_length=1, max_length=190)
    quantity: float | None = Field(default=None, ge=0, le=1_000_000)
    unit: str | None = Field(default=None, max_length=32)


class StapleIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    promoted: bool = True


class HouseholdStapleIn(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    staple: bool = True
    # Adding: keep it on this shop's list as "needed" (default) or tuck it into the pantry.
    # Used by Undo of a removal to restore what the item was. Ignored when removing.
    promoted: bool | None = None


class ExtraIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    quantity: str | None = Field(default=None, max_length=64)


class ExtraPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    quantity: str | None = Field(default=None, max_length=64)
    checked: bool | None = None


class NewShopIn(BaseModel):
    start: dt.date
    end: dt.date
