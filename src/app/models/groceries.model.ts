// Mirrors backend/app/routers/groceries.py payload and backend/app/groceries.py build_list().
import { Aisle, IngredientNames } from './recipe.model';

/** `{number, unit, many}` amount; `unit` is a canonical unit code the client localizes. */
export interface AmountParts {
  number: string;
  unit: string | null;
  many: boolean;
}

/** `covered`: what is at home already covers the need (nothing bought, nothing left to buy). */
export type GroceryState = 'to_buy' | 'in_cart' | 'covered' | 'no_longer_needed';

/** A staple the household usually has (`have`) or flagged "I need it" for this shop (`need`). */
export type PantryState = 'have' | 'need';

export interface GroceryPart {
  /** "<canonical name>|<unit family>" - what a mark is stored under. */
  key: string;
  family: string;
  needed: number | null;
  purchased: number | null;
  remaining: number | null;
  checked: boolean;
  /** Base-unit amount at home (kept apart from `purchased`); remaining = needed - have - purchased. */
  have?: number;
  haveAmount?: AmountParts | null;
  neededAmount?: AmountParts | null;
  remainingAmount?: AmountParts | null;
  neededLabel: string;
  remainingLabel: string;
}

export interface GrocerySource {
  entryId: number;
  date: string;
  slot: string;
  recipeId: string;
  recipeName: string;
  servings: number;
  amount: string;
  amountParts?: AmountParts | null;
  addedBy: number | null;
}

export interface GroceryItem {
  /** Canonical ingredient name; the key for mark/unmark. */
  key: string;
  name: string;
  /** en/fr/ar names of the canonical ingredient (null: show `name`). */
  names?: IngredientNames | null;
  aisle: Aisle;
  state: GroceryState;
  /** Something was bought but the plan grew since: show "+{remainingLabel} more". */
  moreNeeded: boolean;
  /** Pantry staple not promoted: goes in the collapsed "You probably have these" section. */
  staple: boolean;
  promoted: boolean;
  /** `have` / `need` for pantry staples, null for ordinary items. */
  pantryState?: PantryState | null;
  /** Some of it is at home (a part has a have-amount). */
  hasHave?: boolean;
  /** Added by another member since this user last opened the list. */
  isNew: boolean;
  neededLabel: string;
  remainingLabel: string;
  purchasedLabel?: string;
  purchasedAmounts?: AmountParts[];
  parts: GroceryPart[];
  sources: GrocerySource[];
}

export interface GroceryExtra {
  id: number;
  name: string;
  names?: IngredientNames | null;
  quantity: string | null;
  aisle: Aisle;
  checked: boolean;
  checkedBy: number | null;
  addedBy: number | null;
}

/** An optional ingredient of a planned recipe; one tap adds it as an extra. */
export interface OptionalExtra {
  name: string;
  canonical: string;
  names?: IngredientNames | null;
  amountParts?: AmountParts | null;
  amount: string;
  note: string | null;
  entryId: number;
  date: string;
  slot: string;
  recipeId: string;
  recipeName: string;
}

/** An at-home amount that matches nothing the plan needs right now (shown in a small memory). */
export interface AtHomeEntry {
  /** Part key "<canonical>|<family>"; what PUT /groceries/have clears. */
  key: string;
  itemKey: string;
  name: string;
  names?: IngredientNames | null;
  family: string;
  have: number;
  haveAmount: AmountParts | null;
}

export interface GroceryTrip {
  id: number;
  start: string;
  end: string;
  createdAt: string;
  mealCount: number;
}

export interface GroceryList {
  trip: GroceryTrip;
  items: GroceryItem[];
  extras: GroceryExtra[];
  optionalExtras: OptionalExtra[];
  atHome?: AtHomeEntry[];
  progress: { done: number; total: number };
  units: 'metric' | 'us';
}

export interface FavoriteEntry {
  recipeId: string;
  userId: number;
  userName: string;
  createdAt: string;
}
