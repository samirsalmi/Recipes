import type { Language } from '../i18n/config';
import { normalizeSearch } from '../i18n/search';
import { suggestUnits } from '../i18n/units';
import type { IngredientCheck } from '../models';
import { ParsedIngredient, leadingQuantity, parseIngredientLine } from './ingredient-parser';

// Pure helpers behind the recipe form's ingredient helper: which line the caret is on, whether the
// user is typing a unit or a name there, and the exact text edits for accepting a suggestion or
// rewriting a recognized unit / name into the reader's language. No DOM, no services.

export interface LineInfo {
  index: number;
  /** Offsets in the whole text: [start, end) without the newline. */
  start: number;
  end: number;
  text: string;
}

export function splitLines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  text.split('\n').forEach((line, index) => {
    out.push({ index, start, end: start + line.length, text: line });
    start += line.length + 1;
  });
  return out;
}

/** The line containing offset `pos` (a caret at a line end belongs to that line). */
export function lineAt(text: string, pos: number): LineInfo {
  const lines = splitLines(text);
  const at = Math.max(0, Math.min(pos, text.length));
  return lines.find(l => at >= l.start && at <= l.end) ?? lines[lines.length - 1];
}

export interface UnitDraft {
  /** What was typed after the quantity ("tab"). */
  partial: string;
  /** Offset in the line prefix where the partial starts. */
  start: number;
  quantity: number;
}

export interface NameDraft {
  query: string;
  start: number;
  /** The line already has a recognized unit ("250 g flour"): French wants "de" before the name. */
  hasUnit: boolean;
}

export interface DraftContext {
  unit?: UnitDraft;
  name?: NameDraft;
}

const MIN_QUERY = 2;

/** What the user is typing at the end of `prefix` (the line text up to the caret). Nothing for
 *  group headers, notes (after a comma / inside parentheses) and empty names. */
export function draftContext(prefix: string): DraftContext {
  if (/[,;،]/.test(prefix) || (prefix.match(/\(/g)?.length ?? 0) > (prefix.match(/\)/g)?.length ?? 0)) return {};
  const parsed = parseIngredientLine(prefix);
  if (!parsed || parsed.kind !== 'ingredient') return {};
  const ing = parsed.ingredient;
  const out: DraftContext = {};

  const lead = leadingQuantity(prefix);
  if (lead && ing.quantity !== null && !ing.unitTyped) {
    const rest = lead.rest.replace(/^\s+/, '');
    if (rest && rest.length <= 22 && !/[\d(]/.test(rest) && suggestUnits(rest.trimEnd(), 1).length) {
      out.unit = { partial: rest, start: prefix.length - rest.length, quantity: lead.quantity };
    }
  }

  const name = ing.name.trim();
  // "2 cups" with nothing after it falls back to the raw line as the name: not a name.
  if (name.length >= MIN_QUERY && !(ing.quantity !== null && name === ing.raw)) {
    const at = prefix.toLowerCase().lastIndexOf(name.toLowerCase());
    if (at >= 0 && prefix.slice(at + name.length).trim() === '') {
      out.name = { query: name, start: at, hasUnit: !!ing.unit };
    }
  }
  return out;
}

const VOWEL_START = /^[aeiouyhàâäéèêëîïôöùûüœ]/i;
// A particle right before the name: "250 g de farine", "3 gousses d'ail", "1 boîte de la sauce".
const PARTICLE_BEFORE = /(?:de la|de l['’]|des|du|de|d['’]|of|من)\s*$/i;

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Replace the name that starts at `nameStart` (and ends at `nameEnd`) with `label`, adjusting
 *  the particle: English/Arabic drop "de"/"d'" ("250 g de farine" -> "250 g flour"), French adds
 *  it after a unit ("250 g flour" -> "250 g de farine"). */
export function nameReplacement(text: string, nameStart: number, nameEnd: number, label: string, lang: Language, hasUnit: boolean): TextEdit {
  const before = text.slice(0, nameStart);
  const particle = before.match(PARTICLE_BEFORE);
  let particleAt = -1;
  if (particle && particle.index !== undefined) {
    const prev = before[particle.index - 1];
    if (prev === undefined || /\s/.test(prev) || /^d['’]/i.test(particle[0])) particleAt = particle.index;
  }
  if (lang !== 'fr') {
    return { from: particleAt >= 0 ? particleAt : nameStart, to: nameEnd, insert: label };
  }
  const want = VOWEL_START.test(label) ? "d'" : 'de ';
  if (particleAt >= 0) {
    const typed = (particle as RegExpMatchArray)[0].trim().toLowerCase();
    if (typed === 'de' || typed === "d'" || typed === 'd’') return { from: particleAt, to: nameEnd, insert: want + label };
    return { from: nameStart, to: nameEnd, insert: label }; // du / des / de la / de l' stay
  }
  return { from: nameStart, to: nameEnd, insert: (hasUnit ? want : '') + label };
}

/** The edit that rewrites a recognized unit to `label` (the reader-language form), or null when
 *  it already reads that way, is converted rather than renamed (cl, dl, dessert spoon) or cannot
 *  be found in the line. */
export function unitReplacement(line: string, ing: Pick<ParsedIngredient, 'unitTyped' | 'unitFactor'>, label: string): TextEdit | null {
  const typed = ing.unitTyped;
  if (!typed || (ing.unitFactor ?? 1) !== 1 || typed === label) return null;
  if (normalizeSearch(typed.replace(/\.$/, '')) === normalizeSearch(label.replace(/\.$/, ''))) return null;
  const at = line.toLowerCase().indexOf(typed.toLowerCase());
  if (at < 0) return null;
  return { from: at, to: at + typed.length, insert: label };
}

/** The reader-language name to rewrite `typed` to, only when the server confirmed it exactly (a
 *  dictionary spelling, no typo / plural / descriptor guessing) and it is not already the
 *  reader's language. Null otherwise. */
export function autoTranslation(check: IngredientCheck | undefined, typed: string, lang: Language): string | null {
  if (!check?.known || !check.exact || !check.names) return null;
  const target = check.names[lang];
  if (!target || normalizeSearch(target) === normalizeSearch(typed.trim())) return null;
  const languages = check.languages ?? [];
  // French leaks into the English alias list ("fromage"): an English reader still gets "cheese".
  const alreadyTheirs = lang === 'en' ? languages.includes('en') && !languages.includes('fr') && !languages.includes('ar') : languages.includes(lang);
  return alreadyTheirs ? null : target;
}

/** Apply non-overlapping edits to `text` (any order). */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}
