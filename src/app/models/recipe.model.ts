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
export type DietaryRestriction = 'Vegetarian' | 'Vegan' | 'Gluten-Free' | 'Dairy-Free' | 'Nut-Free' | 'Low-Carb';
export type CuisineType = 'Italian' | 'Mexican' | 'Asian' | 'American' | 'Mediterranean' | 'Indian' | 'French' | 'Middle Eastern' | 'Other';

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
}

export interface RecipeFilter {
  searchQuery: string;
  categories: Category[];
  difficulties: Difficulty[];
  dietaryRestrictions: DietaryRestriction[];
  maxCookTime?: number;
  minRating?: number;
  cuisineTypes?: CuisineType[];
}

export type SortOption = 'alphabetical' | 'cookingTime' | 'rating' | 'newest' | 'oldest';
