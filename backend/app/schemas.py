from typing import Any

from pydantic import BaseModel, Field


class StorageValue(BaseModel):
    """Wraps an arbitrary JSON value for the generic storage endpoints."""

    value: Any = None


class IngredientIn(BaseModel):
    id: str
    name: str
    quantity: float
    unit: str
    category: str


class RecipeStepIn(BaseModel):
    stepNumber: int
    instruction: str
    timer: int | None = None
    temperature: str | None = None


class NutritionInfoIn(BaseModel):
    calories: float
    protein: float
    carbs: float
    fats: float
    fiber: float | None = None
    sugar: float | None = None
    sodium: float | None = None


class RecipeIn(BaseModel):
    """What the client sends to create a recipe. `id`, `rating`, `reviewCount`, `author`,
    `dateAdded`, `ownerId`, `isPublic`, `isOfficial`, and `parentRecipeId` are always assigned
    by the server (see routers/recipes.py `create_recipe`). Steps are optional - a recipe with
    none just has no cooking-mode guide."""

    name: str = Field(min_length=1, max_length=255)
    description: str
    image: str
    category: str
    difficulty: str
    prepTime: int = Field(ge=0)
    cookTime: int = Field(ge=0)
    totalTime: int = Field(ge=0)
    servings: int = Field(ge=1)
    ingredients: list[IngredientIn] = Field(min_length=1)
    steps: list[RecipeStepIn] = []
    nutrition: NutritionInfoIn
    dietaryRestrictions: list[str] = []
    cuisineType: str
    tags: list[str] = []
    tips: list[str] | None = None
    notes: str | None = None


class RecipeUpdateIn(BaseModel):
    """What the owner can PATCH: any recipe field (all optional, only provided ones change),
    plus `isPublic` to toggle visibility. Everything else server-assigned stays untouchable."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    image: str | None = None
    category: str | None = None
    difficulty: str | None = None
    prepTime: int | None = Field(default=None, ge=0)
    cookTime: int | None = Field(default=None, ge=0)
    totalTime: int | None = Field(default=None, ge=0)
    servings: int | None = Field(default=None, ge=1)
    ingredients: list[IngredientIn] | None = Field(default=None, min_length=1)
    steps: list[RecipeStepIn] | None = None
    nutrition: NutritionInfoIn | None = None
    dietaryRestrictions: list[str] | None = None
    cuisineType: str | None = None
    tags: list[str] | None = None
    tips: list[str] | None = None
    notes: str | None = None
    isPublic: bool | None = None


class OfficialUpdateIn(BaseModel):
    """Admin-only: curate a recipe's "official" badge."""

    isOfficial: bool


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=255, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8)
    name: str = Field(min_length=1, max_length=255)


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    name: str
    isAdmin: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
