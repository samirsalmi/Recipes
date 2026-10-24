import { formatQuantity, parseIngredientLine, parseIngredientText, ParsedIngredient } from './ingredient-parser';

function ing(line: string): ParsedIngredient {
  const parsed = parseIngredientLine(line);
  if (!parsed || parsed.kind !== 'ingredient') throw new Error(`not an ingredient: ${line}`);
  return parsed.ingredient;
}

describe('parseIngredientLine', () => {
  it('reads plain quantity, unit and name', () => {
    const r = ing('400 g tomatoes');
    expect([r.quantity, r.unit, r.name, r.note]).toEqual([400, 'g', 'tomatoes', null]);
    expect(ing('400g tomatoes').unit).toBe('g');
  });

  it('handles mixed and simple fractions', () => {
    expect(ing('1 1/2 cups flour').quantity).toBe(1.5);
    expect(ing('3/4 tsp salt').quantity).toBe(0.75);
    expect(ing('1.5 kg potatoes').quantity).toBe(1.5);
    expect(ing('1,5 kg pommes de terre').quantity).toBe(1.5);
  });

  it('handles unicode fractions alone and after a whole number', () => {
    expect(ing('½ tsp cumin').quantity).toBe(0.5);
    expect(ing('1½ cups milk')).toMatchObject({ quantity: 1.5, unit: 'cup', name: 'milk' });
    expect(ing('1 ¼ cups sugar').quantity).toBe(1.25);
  });

  it('keeps ranges as min + upper bound', () => {
    const r = ing('1-2 onions');
    expect([r.quantityMin, r.quantity, r.name]).toEqual([1, 2, 'onions']);
    expect(ing('2 to 3 tbsp olive oil')).toMatchObject({ quantityMin: 2, quantity: 3, unit: 'tbsp' });
  });

  it('moves text after a comma into the note', () => {
    expect(ing('2 cups flour, sifted')).toMatchObject({ quantity: 2, unit: 'cup', name: 'flour', note: 'sifted' });
    expect(ing('1 onion, finely chopped')).toMatchObject({ quantity: 1, unit: null, name: 'onion', note: 'finely chopped' });
  });

  it('understands "to taste" and "a pinch of"', () => {
    expect(ing('salt to taste')).toMatchObject({ quantity: null, unit: null, name: 'salt', note: 'to taste' });
    expect(ing('black pepper, to taste')).toMatchObject({ name: 'black pepper', note: 'to taste' });
    expect(ing('a pinch of salt')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'salt' });
    expect(ing('pinch of saffron')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'saffron' });
  });

  it('treats lines ending in ":" as group headers', () => {
    expect(parseIngredientLine('For the sauce:')).toEqual({ kind: 'group', group: 'sauce', raw: 'For the sauce:' });
    const list = parseIngredientText('Dough:\n500 g flour\n\nTopping:\n2 tbsp sugar\n');
    expect(list.map(i => [i.group, i.name])).toEqual([['Dough', 'flour'], ['Topping', 'sugar']]);
  });

  it('reads French spoon and clove units', () => {
    expect(ing("2 c. à soupe d'huile d'olive")).toMatchObject({ quantity: 2, unit: 'tbsp', name: "huile d'olive" });
    expect(ing('1 c. à café de sel')).toMatchObject({ quantity: 1, unit: 'tsp', name: 'sel' });
    expect(ing("3 gousses d'ail")).toMatchObject({ quantity: 3, unit: 'clove', name: 'ail' });
    expect(ing('1 cuillère à soupe de miel')).toMatchObject({ unit: 'tbsp', name: 'miel' });
    expect(ing('1 pincée de cannelle')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'cannelle' });
    expect(ing('25 cl de lait')).toMatchObject({ quantity: 250, unit: 'ml', name: 'lait' });
  });

  it('marks optional ingredients from a suffix or prefix', () => {
    expect(ing('1 bunch cilantro (optional)')).toMatchObject({ name: 'cilantro', optional: true, quantity: 1, unit: 'bunch' });
    expect(ing('optional: 30 g peanuts')).toMatchObject({ name: 'peanuts', optional: true, quantity: 30 });
    expect(ing('2 eggs').optional).toBeUndefined();
  });

  it('keeps a parenthesised size as a note and strips bullets', () => {
    expect(ing('1 (400 g) can chickpeas')).toMatchObject({ quantity: 1, unit: 'can', name: 'chickpeas', note: '400 g' });
    expect(ing('- 2 eggs')).toMatchObject({ quantity: 2, name: 'eggs' });
  });

  it('does not mistake words starting with a unit for a unit', () => {
    expect(ing('2 large eggs')).toMatchObject({ quantity: 2, unit: null, name: 'large eggs' });
    expect(ing('1 lemon')).toMatchObject({ unit: null, name: 'lemon' });
    expect(ing('3 garlic cloves')).toMatchObject({ unit: null, name: 'garlic cloves' });
  });

  it('reads French lines with de and d-apostrophe particles', () => {
    expect(ing('250 g de farine')).toMatchObject({ quantity: 250, unit: 'g', name: 'farine' });
    expect(ing("2 c. à s. d'huile d'olive")).toMatchObject({ quantity: 2, unit: 'tbsp', name: "huile d'olive" });
    expect(ing('1 c. à c. de sel fin')).toMatchObject({ quantity: 1, unit: 'tsp', name: 'sel fin' });
    expect(ing('3 cuillères à soupe de sucre')).toMatchObject({ quantity: 3, unit: 'tbsp', name: 'sucre' });
    expect(ing("2 gousses d’ail, hachées")).toMatchObject({ quantity: 2, unit: 'clove', name: 'ail', note: 'hachées' });
    expect(ing('1 pot de yaourt')).toMatchObject({ quantity: 1, name: 'pot de yaourt' });
    expect(ing("50 cl de lait")).toMatchObject({ quantity: 500, unit: 'ml', name: 'lait' });
    expect(ing('1 boîte de tomates concassées')).toMatchObject({ unit: 'can', name: 'tomates concassées' });
    expect(ing('1 pincée de sel')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'sel' });
    expect(ing("sel au goût")).toMatchObject({ name: 'sel', note: 'au goût' });
    expect(ing('3 œufs')).toMatchObject({ quantity: 3, unit: null, name: 'œufs' });
    expect(ing('2 de la farine').name).toBe('farine');
    expect(ing('1 demi oignon')).toMatchObject({ quantity: 1, name: 'demi oignon' });
    expect(ing('demi litre de lait')).toMatchObject({ quantity: 0.5, unit: 'l', name: 'lait' });
    expect(ing('1 oignon (facultatif)')).toMatchObject({ name: 'oignon', optional: true });
    expect(parseIngredientLine('Pour la sauce :')).toMatchObject({ kind: 'group', group: 'sauce' });
  });

  it('does not eat the start of a word that begins like a particle', () => {
    expect(ing('2 dessert apples').name).toBe('dessert apples');
    expect(ing('1 deglet nour date').name).toBe('deglet nour date');
    expect(ing('100 g of flour').name).toBe('flour');
  });

  it('reads Arabic lines: Arabic-Indic digits, units, particles', () => {
    expect(ing('٢ ملعقة كبيرة زيت')).toMatchObject({ quantity: 2, unit: 'tbsp', name: 'زيت' });
    expect(ing('2 ملعقة صغيرة ملح')).toMatchObject({ quantity: 2, unit: 'tsp', name: 'ملح' });
    expect(ing('١٥٠ غرام من الدقيق')).toMatchObject({ quantity: 150, unit: 'g', name: 'الدقيق' });
    expect(ing('٢٥٠ جرام زبدة')).toMatchObject({ quantity: 250, unit: 'g', name: 'زبدة' });
    expect(ing('٢ كوب أرز')).toMatchObject({ quantity: 2, unit: 'cup', name: 'أرز' });
    expect(ing('١٫٥ كيلو لحم ضأن')).toMatchObject({ quantity: 1.5, unit: 'kg', name: 'لحم ضأن' });
    expect(ing('٣ فصوص ثوم')).toMatchObject({ quantity: 3, unit: 'clove', name: 'ثوم' });
    expect(ing('٣ بيضات')).toMatchObject({ quantity: 3, unit: null, name: 'بيضات' });
    expect(ing('٣ حبات بطاطس')).toMatchObject({ quantity: 3, unit: 'piece', name: 'بطاطس' });
    expect(ing('٠.٥ لتر حليب')).toMatchObject({ quantity: 0.5, unit: 'l', name: 'حليب' });
    expect(ing('٢٠٠ مل ماء')).toMatchObject({ quantity: 200, unit: 'ml', name: 'ماء' });
  });

  it('reads Arabic words for numbers, pinches, notes and to-taste', () => {
    expect(ing('نصف كوب دقيق')).toMatchObject({ quantity: 0.5, unit: 'cup', name: 'دقيق' });
    expect(ing('ربع ملعقة صغيرة قرفة')).toMatchObject({ quantity: 0.25, unit: 'tsp', name: 'قرفة' });
    expect(ing('رشة ملح')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'ملح' });
    expect(ing('قرصة من الزعفران')).toMatchObject({ quantity: 1, unit: 'pinch', name: 'الزعفران' });
    expect(ing('ملح حسب الذوق')).toMatchObject({ quantity: null, name: 'ملح', note: 'حسب الذوق' });
    expect(ing('٢ بصل، مقطع')).toMatchObject({ quantity: 2, name: 'بصل', note: 'مقطع' });
    expect(ing('١ بصلة (اختياري)')).toMatchObject({ name: 'بصلة', optional: true });
    expect(ing('زَيْت الزَّيتُون')).toMatchObject({ name: 'زيت الزيتون' }); // tashkeel dropped
    // a unit-looking prefix of an Arabic word is not a unit
    expect(ing('٢ لحم')).toMatchObject({ quantity: 2, unit: null, name: 'لحم' });
    expect(ing('٣ غصون')).toMatchObject({ unit: null, name: 'غصون' });
  });

  it('reads several Arabic or French lines as a list with groups', () => {
    const list = parseIngredientText(['للعجين:', '٢٥٠ غرام طحين', '١ ملعقة صغيرة خميرة', '', 'Pour la sauce :', '2 c. à s. de miel'].join('\n'));
    expect(list.map(i => [i.group, i.quantity, i.unit, i.name])).toEqual([
      ['للعجين', 250, 'g', 'طحين'],
      ['للعجين', 1, 'tsp', 'خميرة'],
      ['sauce', 2, 'tbsp', 'miel'],
    ]);
  });

  it('ignores blank lines', () => {
    expect(parseIngredientLine('   ')).toBeNull();
  });
});

describe('formatQuantity', () => {
  it('prints nice fractions', () => {
    expect(formatQuantity(1.5)).toBe('1½');
    expect(formatQuantity(0.333)).toBe('⅓');
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(0.75)).toBe('¾');
    expect(formatQuantity(1.17)).toBe('1.2');
    expect(formatQuantity(250)).toBe('250');
    expect(formatQuantity(null)).toBe('');
  });
});

describe('cheese and serving words', () => {
  const read = (line: string) => {
    const r = ing(line);
    return [r.quantity, r.unit, r.name, r.note];
  };

  it('turns a serving word into a plain count and keeps it as the note', () => {
    expect(read('4 portions de fromage')).toEqual([4, null, 'fromage', 'portions']);
    expect(read('4 portions cheese')).toEqual([4, null, 'cheese', 'portions']);
    expect(read('4 pieces of cheese')).toEqual([4, null, 'cheese', 'pieces']);
    expect(read('4 slices of cheese')).toEqual([4, null, 'cheese', 'slices']);
    expect(read('4 tranches de fromage')).toEqual([4, null, 'fromage', 'tranches']);
    expect(read('4 قطع جبن')).toEqual([4, null, 'جبن', 'قطع']);
    expect(read('4 حصص جبن')).toEqual([4, null, 'جبن', 'حصص']);
  });

  it('moves a trailing serving word out of the name', () => {
    expect(read('4 fromage portions')).toEqual([4, null, 'fromage', 'portions']);
    expect(read('4 cheese slices')).toEqual([4, null, 'cheese', 'slices']);
    expect(read('4 جبن شرائح')).toEqual([4, null, 'جبن', 'شرائح']);
  });

  it('leaves plain counts and other names alone', () => {
    expect(read('4 جبن')).toEqual([4, null, 'جبن', null]);
    expect(read('4 fromage râpé')).toEqual([4, null, 'fromage râpé', null]);
  });
});
