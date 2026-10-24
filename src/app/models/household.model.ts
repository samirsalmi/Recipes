// Mirrors backend/app/routers/household.py household_out() and activity().

export type DietPref = 'vegetarian' | 'vegan' | 'no-pork' | 'no-alcohol' | 'nut-free' | 'gluten-free' | 'dairy-free';
export type UnitSystem = 'metric' | 'us';

export interface HouseholdMember {
  userId: number;
  name: string;
  username: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface Household {
  id: number;
  name: string;
  inviteCode: string;
  size: number;
  diet: DietPref[];
  units: UnitSystem;
  pantryStaples: string[];
  defaultPantryStaples: string[];
  /** canonical staple -> en/fr/ar names (null when not in the dictionary). */
  stapleNames: Record<string, { en: string; fr: string; ar: string } | null>;
  /** "Prefer budget recipes": Fill empty dinners favours low-budget recipes. */
  preferBudget: boolean;
  members: HouseholdMember[];
  myRole: 'owner' | 'member';
  myUserId: number;
}

export interface HouseholdSettingsUpdate {
  name?: string;
  size?: number;
  diet?: DietPref[];
  units?: UnitSystem;
  /** null resets to the default staples. */
  pantryStaples?: string[] | null;
  preferBudget?: boolean;
}

export interface InvitePreview {
  name: string;
  memberNames: string[];
}

export interface ActivityEvent {
  id: number;
  /** plan.add | plan.update | plan.remove | plan.copy | groceries.* | household.* */
  type: string;
  payload: { summary?: string; [key: string]: unknown };
  userId: number | null;
  userName: string | null;
  createdAt: string;
}

export interface ActivityPage {
  events: ActivityEvent[];
  cursor: number;
}
