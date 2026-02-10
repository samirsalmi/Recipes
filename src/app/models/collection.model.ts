export interface Collection {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  color?: string;
  recipeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserRecipeData {
  recipeId: string;
  isFavorite: boolean;
  userRating?: number;
  notes?: string;
  lastViewed?: string;
  viewCount?: number;
  gatheredIngredients?: string[]; // ingredient IDs
}
