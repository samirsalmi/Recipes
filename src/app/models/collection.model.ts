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
