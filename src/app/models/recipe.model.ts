export interface Ingredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: IngredientCategory;
  checked?: boolean;
}

export type IngredientCategory = 
  | 'Produce'
  | 'Dairy'
  | 'Meat'
  | 'Seafood'
  | 'Pantry'
  | 'Bakery'
  | 'Frozen'
  | 'Beverages'
  | 'Spices'
  | 'Other';

export interface RecipeStep {
  stepNumber: number;
  instruction: string;
  timer?: number; // in minutes
  temperature?: string;
}

export interface NutritionInfo {
  calories: number;
  protein: number; // in grams
  carbs: number; // in grams
  fats: number; // in grams
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export type Category = 'Breakfast' | 'Lunch' | 'Dinner' | 'Dessert' | 'Snacks';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
// Users can add their own dietary restriction values beyond this list, so it's not a
// closed union anymore - this is only the quick-pick suggestion set for the form/filter chips.
export type DietaryRestriction = string;
export const SUGGESTED_DIETARY_RESTRICTIONS: string[] = [
  'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free', 'Low-Carb'
];
export type CuisineType = 'Algerian' | 'Italian' | 'Mexican' | 'Asian' | 'American' | 'Mediterranean' | 'Indian' | 'French' | 'Middle Eastern' | 'Other';

export interface Recipe {
  id: string;
  name: string;
  description: string;
  image: string;
  category: Category;
  difficulty: Difficulty;
  prepTime: number; // in minutes
  cookTime: number; // in minutes
  totalTime: number; // in minutes
  servings: number;
  rating: number;
  reviewCount: number;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  nutrition: NutritionInfo;
  dietaryRestrictions: DietaryRestriction[];
  cuisineType: CuisineType;
  tags: string[];
  author?: string;
  dateAdded: string;
  tips?: string[];
  notes?: string;
  ownerId: number | null;
  isPublic: boolean;
  isOfficial: boolean;
  parentRecipeId: string | null;
  twistCount: number;
}

// What the client sends to create a recipe - id, rating, review count, author, date-added,
// owner, visibility, official flag, parent (twist) link, and twist count are all
// assigned/derived server-side.
export type RecipeCreateInput = Omit<
  Recipe,
  'id' | 'rating' | 'reviewCount' | 'author' | 'dateAdded' | 'ownerId' | 'isPublic' | 'isOfficial' | 'parentRecipeId' | 'twistCount'
>;

// What the owner can PATCH: any editable field, plus isPublic to toggle visibility.
export type RecipeUpdateInput = Partial<
  Omit<Recipe, 'id' | 'ownerId' | 'rating' | 'reviewCount' | 'author' | 'dateAdded' | 'isOfficial' | 'parentRecipeId' | 'twistCount'>
>;

export interface RecipeFilter {
  searchQuery: string;
  categories: Category[];
  difficulties: Difficulty[];
  dietaryRestrictions: DietaryRestriction[];
  maxCookTime?: number;
  minRating?: number;
  cuisineTypes?: CuisineType[];
  originFilter?: ('official' | 'community')[];
}

export type SortOption = 'alphabetical' | 'cookingTime' | 'rating' | 'newest' | 'oldest';
