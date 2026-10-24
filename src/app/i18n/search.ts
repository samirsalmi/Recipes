import type { Recipe } from '../models';
import { DICTIONARIES } from './dictionaries';

/** Lower-case, accent- and Arabic-diacritic-insensitive text for matching ("creme" finds "crème"). */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** The cuisine's name in every loaded language (all three once the idle preload is done), so "algérienne" and "جزائري" find the same recipes. */
function cuisineNames(cuisine: string | null): string[] {
  if (!cuisine) return [];
  const key = `cuisine.${cuisine}`;
  return [cuisine, DICTIONARIES.en[key], DICTIONARIES.fr[key], DICTIONARIES.ar[key]].filter((v): v is string => !!v);
}

/**
 * Everything a recipe can be found by, in all three languages: the name as written (and any
 * author translations), the cuisine in en/fr/ar, tags, and every ingredient as typed plus its
 * English/French/Arabic dictionary names. A recipe with "beurre" is found by "butter" and "زبدة".
 */
export function recipeSearchText(recipe: Pick<Recipe, 'name' | 'cuisine' | 'ingredients'> & Partial<Pick<Recipe, 'tags' | 'translations'>>): string {
  const parts: string[] = [recipe.name, ...cuisineNames(recipe.cuisine), ...(recipe.tags ?? [])];
  for (const tr of Object.values(recipe.translations ?? {})) if (tr?.name) parts.push(tr.name);
  for (const ing of recipe.ingredients) {
    parts.push(ing.name);
    if (ing.names) parts.push(ing.names.en, ing.names.fr, ing.names.ar);
  }
  return normalizeSearch(parts.join(' \n '));
}
