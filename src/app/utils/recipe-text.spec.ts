import { parseIngredientText } from './ingredient-parser';
import { ingredientsToText, stepsToText, textToSteps } from './recipe-text';

describe('recipe-text', () => {
  it('round-trips ingredients through text', () => {
    const text = ingredientsToText([
      { group: null, quantity: 1.5, unit: 'cup', name: 'flour', note: 'sifted' },
      { group: 'Sauce', quantity: 2, unit: 'tbsp', name: 'olive oil', note: null },
      { group: 'Sauce', quantity: null, unit: null, name: 'salt', note: 'to taste', optional: true },
    ]);
    expect(text).toBe('1½ cup flour, sifted\n\nSauce:\n2 tbsp olive oil\nsalt, to taste (optional)');
    const back = parseIngredientText(text);
    expect(back.map(i => [i.group, i.quantity, i.unit, i.name, i.note, !!i.optional])).toEqual([
      [null, 1.5, 'cup', 'flour', 'sifted', false],
      ['Sauce', 2, 'tbsp', 'olive oil', null, false],
      ['Sauce', null, null, 'salt', 'to taste', true],
    ]);
  });

  it('splits steps on blank lines or numbered lines', () => {
    expect(textToSteps('Chop.\nSlowly.\n\nCook.').map(s => s.text)).toEqual(['Chop. Slowly.', 'Cook.']);
    expect(textToSteps('1. Chop\n2) Cook\nStep 3: Eat').map(s => s.text)).toEqual(['Chop', 'Cook', 'Eat']);
    expect(stepsToText([{ text: 'A', timerMinutes: null }, { text: 'B', timerMinutes: 5 }])).toBe('A\n\nB');
    expect(textToSteps('   ')).toEqual([]);
  });
});
