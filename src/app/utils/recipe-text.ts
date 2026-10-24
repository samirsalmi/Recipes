import { Ingredient, RecipeStep } from '../models';
import { formatQuantity } from './ingredient-parser';

// Text <-> structure helpers for the recipe editor's two textareas (ingredients, steps).

/** Ingredients back to editable lines ("Sauce:" headers for groups). */
export function ingredientsToText(ingredients: Ingredient[]): string {
  const lines: string[] = [];
  let group: string | null = null;
  for (const ing of ingredients) {
    if (ing.group !== group) {
      group = ing.group;
      if (group) lines.push(`${lines.length ? '\n' : ''}${group}:`);
    }
    const qty = ing.quantity !== null ? formatQuantity(ing.quantity) : '';
    const unit = ing.unit && ing.unit !== 'piece' ? ing.unit : '';
    const head = [qty, unit, ing.name].filter(Boolean).join(' ');
    lines.push(`${head}${ing.note ? `, ${ing.note}` : ''}${ing.optional ? ' (optional)' : ''}`);
  }
  return lines.join('\n');
}

/** Steps text -> step list. Blank lines separate steps; without blank lines, each line (or
 *  each "1." / "2)" numbered line) is a step. Leading numbering is stripped. Timers are not
 *  asked for: cooking mode detects them from the text. */
export function textToSteps(text: string): RecipeStep[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const chunks = /\n\s*\n/.test(trimmed) ? trimmed.split(/\n\s*\n/) : trimmed.split(/\n/);
  return chunks
    .map(chunk => chunk.replace(/\s*\n\s*/g, ' ').replace(/^\s*(step\s*)?\d+\s*[.):-]\s*/i, '').trim())
    .filter(Boolean)
    .map(text => ({ text, timerMinutes: null }));
}

export function stepsToText(steps: RecipeStep[]): string {
  return steps.map(s => s.text).join('\n\n');
}
