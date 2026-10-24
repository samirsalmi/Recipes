// Recipe model v2 - mirrors the backend's flat recipe response (backend/app/recipe_data.py
// to_response) and the content schema in docs/rework-plan.md section 5.

/** Localized dictionary names of an ingredient (null = not in the dictionary: show as typed). */
export interface IngredientNames {
  en: string;
  fr: string;
  ar: string;
}

/** Optional per-language text written by the author (nothing generates these yet). */
export interface RecipeTranslation {
  name?: string | null;
  description?: string | null;
  steps?: string[] | null;
  tips?: string[] | null;
}
export type RecipeTranslations = Partial<Record<'en' | 'fr' | 'ar', RecipeTranslation>>;

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'snack' | 'side' | 'drink';
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'dessert', 'snack', 'side', 'drink'];

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Budget = 'low' | 'medium' | 'high';

export type Aisle =
  | 'produce'
  | 'meat-fish'
  | 'dairy-eggs'
  | 'bakery'
  | 'pantry'
  | 'spices'
  | 'frozen'
  | 'drinks'
  | 'household'
  | 'other';

/** Fixed display order + labels for grocery aisles (matches backend AISLES). */
export const AISLES: { id: Aisle; label: string }[] = [
  { id: 'produce', label: 'Produce' },
  { id: 'meat-fish', label: 'Meat & fish' },
  { id: 'dairy-eggs', label: 'Dairy & eggs' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'pantry', label: 'Pantry' },
  { id: 'spices', label: 'Spices' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'household', label: 'Household' },
  { id: 'other', label: 'Other' },
];

export interface DietFlags {
  vegetarian: boolean;
  vegan: boolean;
  glutenFree: boolean;
  dairyFree: boolean;
  containsPork: boolean;
  containsAlcohol: boolean;
  containsNuts: boolean;
}

export interface Ingredient {
  group: string | null;
  quantity: number | null;
  unit: string | null;
  name: string;
  note: string | null;
  /** Garnish / add-in the dish works without: left off the grocery list by default. */
  optional?: boolean;
  /** Assigned server-side from the canonical ingredient dictionary. */
  aisle?: Aisle;
  /** English canonical name, resolved by the server at save time (response only). */
  canonical?: string;
  /** The dictionary knows this ingredient (response only). */
  known?: boolean;
  /** en/fr/ar names for known ingredients (response only); `name` stays what was typed. */
  names?: IngredientNames | null;
}

export interface RecipeStep {
  text: string;
  timerMinutes: number | null;
}

export interface Nutrition {
  calories: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
}

export interface RecipeSource {
  title: string | null;
  author?: string | null;
  year?: number | null;
  url?: string | null;
  license?: string | null;
  adaptation?: string | null;
}

export interface ImageCredit {
  author: string | null;
  license: string | null;
  pageUrl: string | null;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  image: string;
  imageCredit: ImageCredit | null;
  cuisine: string | null;
  region: string | null;
  mealTypes: MealType[];
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  totalTime: number | null;
  difficulty: Difficulty | null;
  /** Long-established home/heritage cooking of that cuisine. */
  traditional: boolean;
  /** Cost of the main ingredients for the serving count; null when unknown (user recipes). */
  budget: Budget | null;
  diet: DietFlags;
  tags: string[];
  ingredients: Ingredient[];
  steps: RecipeStep[];
  tips: string[];
  nutrition: Nutrition | null;
  source: RecipeSource | null;
  /** Optional author-provided text per language; preferred over the fields above when present. */
  translations?: RecipeTranslations | null;
  author: string | null;
  dateAdded: string;
  // Server-assigned columns.
  ownerId: number | null;
  isPublic: boolean;
  isOfficial: boolean;
  parentRecipeId: string | null;
  twistCount: number;
  /** Catalog summaries carry a flattened, pre-normalized search blob instead of ingredients. */
  search?: string;
  /** True for list/card responses; detail, cook and edit fetch the full recipe by id. */
  summary?: boolean;
}

type ServerAssigned =
  | 'id'
  | 'author'
  | 'dateAdded'
  | 'ownerId'
  | 'isOfficial'
  | 'parentRecipeId'
  | 'twistCount'
  | 'totalTime'
  | 'imageCredit';

/** What the client sends to create a recipe: only name + ingredients are required. */
export type RecipeCreateInput = Partial<Omit<Recipe, ServerAssigned | 'ingredients' | 'name'>> & {
  name: string;
  /** `aisle` is only honored for names the ingredient dictionary does not know (the form's
   *  "Which aisle?" pick); for known names the server assigns it. */
  ingredients: Ingredient[];
};

/** One answer of POST /api/recipes/ingredient-check: does the dictionary (English, French or
 *  Arabic) know this typed ingredient name? Unknown names carry the household's remembered
 *  aisle or a keyword guess. */
export interface IngredientCheck {
  name: string;
  /** English canonical name when known, else the normalized typed name. */
  canonical: string;
  known: boolean;
  aisle: Aisle;
  /** The aisle comes from this household's earlier pick. */
  remembered: boolean;
  /** en/fr/ar names when known. */
  names?: IngredientNames | null;
  /** The typed text is itself a dictionary spelling (not a typo/plural/descriptor guess). */
  exact?: boolean;
  /** Languages that spelling belongs to, when `exact`. */
  languages?: ('en' | 'fr' | 'ar')[];
}

/** One GET /api/recipes/ingredient-suggest result. */
export interface IngredientSuggestion {
  /** English canonical name (a household's custom name for `custom` rows). */
  canonical: string;
  /** Shown name in the requested language. */
  name: string;
  /** The alias the user typed against, when it differs from `name`. */
  matched: string | null;
  names: IngredientNames | null;
  aisle: Aisle;
  known: boolean;
  /** A name this household filed under an aisle itself. */
  custom: boolean;
  match: 'exact' | 'prefix' | 'contains' | 'fuzzy';
}

/** PUT /api/recipes/ingredient-aisles answer. */
export interface IngredientAisleSaved {
  id: number | null;
  name: string;
  aisle: Aisle;
  known: boolean;
  stored: boolean;
}

/** What the owner can PATCH: any editable field, plus isPublic. */
export type RecipeUpdateInput = Partial<Omit<Recipe, ServerAssigned>>;

/** Draft returned by POST /api/recipes/import-url (prefills the add-recipe form). */
export interface RecipeDraft {
  name: string;
  description: string;
  image: string;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  totalTime: number | null;
  cuisine: string | null;
  mealTypes: MealType[];
  tags: string[];
  ingredientLines: string[];
  steps: string[];
  nutrition: Nutrition | null;
  source: RecipeSource;
  isPublic: boolean;
}

export type DietFilter = 'vegetarian' | 'vegan' | 'glutenFree' | 'dairyFree' | 'noPork' | 'noAlcohol' | 'nutFree';

export interface RecipeFilter {
  searchQuery: string;
  mealTypes: MealType[];
  cuisines: string[];
  diet: DietFilter[];
  maxTotalTime: number | null;
  traditionalOnly: boolean;
  budgetFriendly: boolean;
}
