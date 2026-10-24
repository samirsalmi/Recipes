import type { ActivityEvent, AmountParts } from '../models';
import type { I18nService, LocalizedNames } from './i18n.service';

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function ingredient(i18n: I18nService, name: unknown, names: unknown, key?: unknown): string {
  const fallback = str(name) || str(key);
  return i18n.ingredientName({ name: fallback, names: (names as LocalizedNames | null) ?? null });
}

function when(i18n: I18nService, p: ActivityEvent['payload']): string {
  const date = str(p['date']);
  const slot = str(p['slot']);
  return i18n.t('act.when', { day: date ? i18n.day(date) : '', slot: slot ? i18n.slotLower(slot) : '' }).trim();
}

/**
 * The sentence for an activity event ("added Shakshuka to Tue 21 dinner") in the active
 * language, rebuilt from the event's structured payload. Events written before the structured
 * fields existed fall back to the server's English `summary`.
 */
export function activityText(event: ActivityEvent, i18n: I18nService): string {
  const p = event.payload;
  const summary = str(p.summary) || i18n.t('act.fallback');
  const title = str(p['title']);
  switch (event.type) {
    case 'plan.add':
      return title ? i18n.t('act.plan.add', { title, when: when(i18n, p) }) : summary;
    case 'plan.remove':
      return title ? i18n.t('act.plan.remove', { title, when: when(i18n, p) }) : summary;
    case 'plan.update': {
      if (!title) return summary;
      switch (str(p['act'])) {
        case 'swap':
          return i18n.t('act.plan.swap', { title, when: when(i18n, p) });
        case 'move':
          return i18n.t('act.plan.move', { title, when: when(i18n, p) });
        case 'servings':
          return i18n.t('act.plan.servings', { title, servings: i18n.t('common.servings', { count: Number(p['servings']) || 1 }) });
        default:
          return i18n.t('act.plan.update', { title });
      }
    }
    case 'plan.copy':
      return p['count'] !== undefined && p['toStart'] ? i18n.t('act.plan.copy', { count: Number(p['count']), date: i18n.day(str(p['toStart'])) }) : summary;
    case 'groceries.range':
      return p['start'] && p['end'] ? i18n.t('act.groc.range', { from: i18n.day(str(p['start'])), to: i18n.day(str(p['end'])) }) : summary;
    case 'groceries.mark': {
      const keys = Array.isArray(p['items']) ? (p['items'] as string[]) : [str(p['key'])].filter(Boolean);
      if (!keys.length) return summary;
      const namesList = Array.isArray(p['itemNames']) ? (p['itemNames'] as (LocalizedNames | null)[]) : [p['names'] as LocalizedNames | null];
      const labels = keys.map((key, index) => ingredient(i18n, key, namesList[index] ?? null));
      const shown = labels.slice(0, 2).join(i18n.t('common.listSeparator') + ' ');
      const rest = labels.length - 2;
      return rest > 0 ? i18n.t('act.groc.gotMore', { items: shown, count: rest }) : i18n.t('act.groc.got', { items: shown });
    }
    case 'groceries.unmark':
      return p['key'] ? i18n.t('act.groc.unmark', { name: ingredient(i18n, p['key'], p['names']) }) : summary;
    case 'groceries.staple':
      return p['key'] ? i18n.t(p['promoted'] ? 'act.groc.need' : 'act.groc.have', { name: ingredient(i18n, p['key'], p['names']) }) : summary;
    case 'groceries.have': {
      if (!p['key']) return summary;
      const name = ingredient(i18n, p['name'], p['names'], p['key']);
      if (p['cleared']) return i18n.t('act.groc.atHomeClear', { name });
      const amount = i18n.amountParts(p['amount'] as AmountParts | null | undefined);
      return amount ? i18n.t('act.groc.atHomeAmount', { amount, name }) : i18n.t('act.groc.atHome', { name });
    }
    case 'groceries.extra': {
      if (!p['name']) return summary;
      const name = ingredient(i18n, p['name'], p['names']);
      switch (str(p['act'])) {
        case 'add':
          return i18n.t('act.groc.extraAdd', { name });
        case 'got':
          return i18n.t('act.groc.extraGot', { name });
        case 'remove':
          return i18n.t('act.groc.extraRemove', { name });
        default:
          return i18n.t('act.groc.extraUpdate', { name });
      }
    }
    case 'groceries.new_shop':
      return i18n.t('act.groc.newShop');
    case 'groceries.aisle': {
      const name = str(p['key']);
      if (!name) return summary;
      return str(p['act']) === 'clear'
        ? i18n.t('act.groc.aisleClear', { name })
        : i18n.t('act.groc.aisleSet', { name, aisle: i18n.aisle(str(p['aisle'])) });
    }
    case 'household.staples':
      return p['key'] ? i18n.t(p['added'] ? 'act.hh.staplesAdd' : 'act.hh.staplesRemove', { name: ingredient(i18n, p['key'], p['names']) }) : summary;
    case 'household.settings':
      return i18n.t('act.hh.settings');
    case 'household.join':
      return i18n.t('act.hh.join');
    case 'household.leave':
      return i18n.t('act.hh.leave');
    case 'household.remove_member':
      return p['name'] ? i18n.t('act.hh.remove', { name: str(p['name']) }) : summary;
    default:
      return summary;
  }
}
