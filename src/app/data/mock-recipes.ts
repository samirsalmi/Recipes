import { Recipe } from '../models';

// Two classic Italian dishes adapted from Maria Gentile's "The Italian Cook Book: The Art of
// Eating Well" (1919), a public-domain cookbook available via Project Gutenberg
// (gutenberg.org/ebooks/24407). Quantities and step breakdowns are adapted for a modern
// kitchen; the technique and ingredient list follow the original recipes.
export const MOCK_RECIPES: Recipe[] = [
  {
    id: '1',
    name: 'Macaroni Napolitaine',
    description: 'A rich Neapolitan-style meat and tomato sauce over spaghetti, built from ground salt pork, round steak, and softened dried mushrooms. Adapted from Maria Gentile\'s 1919 "The Italian Cook Book."',
    image: 'https://res.cloudinary.com/arbbdmpu/image/upload/v1790519314/recipe-manager/ldfnivrutuc9lno5izfc.avif',
    category: 'Dinner',
    difficulty: 'Medium',
    prepTime: 15,
    cookTime: 55,
    totalTime: 70,
    servings: 4,
    rating: 4.7,
    reviewCount: 128,
    ingredients: [
      { id: '1-1', name: 'Salt pork or bacon, ground', quantity: 0.25, unit: 'lb', category: 'Meat' },
      { id: '1-2', name: 'Onion, small', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '1-3', name: 'Fresh parsley, chopped', quantity: 2, unit: 'tbsp', category: 'Produce' },
      { id: '1-4', name: 'Garlic clove, shredded fine', quantity: 1, unit: 'clove', category: 'Produce' },
      { id: '1-5', name: 'Dried mushrooms, softened in warm water', quantity: 4, unit: 'pieces', category: 'Pantry' },
      { id: '1-6', name: 'Round steak, ground coarsely or cubed small', quantity: 0.5, unit: 'lb', category: 'Meat' },
      { id: '1-7', name: 'Fresh or canned tomatoes (or 1/2 tbsp tomato paste)', quantity: 2, unit: 'cups', category: 'Produce' },
      { id: '1-8', name: 'Spaghetti or macaroni', quantity: 1, unit: 'lb', category: 'Pantry' },
      { id: '1-9', name: 'Salt, for the pasta water', quantity: 1, unit: 'tbsp', category: 'Spices' }
    ],
    steps: [
      { stepNumber: 1, instruction: 'Grind the salt pork or bacon and fry it in a saucepan until it begins to brown.' },
      { stepNumber: 2, instruction: 'Put the onion through a grinder (or mince finely) and add it to the pan with the chopped parsley and the shredded garlic.' },
      { stepNumber: 3, instruction: 'Stir in the softened dried mushrooms. Cook until the vegetables are well browned, taking care not to scorch the onion - it burns easily.' },
      { stepNumber: 4, instruction: 'Add the round steak, ground coarsely or cut into small cubes, and cook until it turns a good brown color.' },
      { stepNumber: 5, instruction: 'Add the fresh or canned tomatoes (or the tomato paste) and simmer slowly until everything cooks down to a thick, creamy sauce - about 45 minutes.', timer: 45 },
      { stepNumber: 6, instruction: 'Meanwhile, bring a large pot of salted water to a boil. Keep the spaghetti unbroken: if it\'s too long for the pot, dip one end in the boiling water and push the rest down as it softens.' },
      { stepNumber: 7, instruction: 'Boil the pasta until tender, then drain and toss with the sauce. Serve hot.' }
    ],
    nutrition: { calories: 520, protein: 24, carbs: 58, fats: 20, fiber: 4, sugar: 6, sodium: 480 },
    dietaryRestrictions: [],
    cuisineType: 'Italian',
    tags: ['pasta', 'tomato sauce', 'classic', 'historic recipe'],
    author: 'Maria Gentile (1919)',
    dateAdded: '2026-03-01',
    ownerId: null,
    isPublic: true,
    isOfficial: true,
    parentRecipeId: null,
    twistCount: 0,
    tips: [
      'The original recipe offers a choice: fresh or canned tomatoes, or half a tablespoon of tomato paste if that\'s what you have on hand.',
      'Adapted from "The Italian Cook Book: The Art of Eating Well" by Maria Gentile (1919), public domain via Project Gutenberg.'
    ]
  },
  {
    id: '2',
    name: 'Risotto Milanaise',
    description: 'The classic saffron-tinted risotto of Milan: rice slow-cooked in broth with browned onion, finished with brown stock, Parmesan, and butter. Adapted from Maria Gentile\'s 1919 "The Italian Cook Book."',
    image: 'https://res.cloudinary.com/arbbdmpu/image/upload/v1790519310/recipe-manager/hlft5ye88lkaumxgxvb0.avif',
    category: 'Lunch',
    difficulty: 'Medium',
    prepTime: 10,
    cookTime: 30,
    totalTime: 40,
    servings: 4,
    rating: 4.8,
    reviewCount: 94,
    ingredients: [
      { id: '2-1', name: 'Butter', quantity: 3, unit: 'tbsp', category: 'Dairy' },
      { id: '2-2', name: 'Onion, medium, thinly sliced', quantity: 1, unit: 'whole', category: 'Produce' },
      { id: '2-3', name: 'Arborio rice (or other risotto rice)', quantity: 1.5, unit: 'cups', category: 'Pantry' },
      { id: '2-4', name: 'Hot broth or hot water', quantity: 4, unit: 'cups', category: 'Pantry' },
      { id: '2-5', name: 'Salt', quantity: 0.5, unit: 'tsp', category: 'Spices' },
      { id: '2-6', name: 'Black pepper', quantity: 0.25, unit: 'tsp', category: 'Spices' },
      { id: '2-7', name: 'Saffron threads', quantity: 1, unit: 'pinch', category: 'Spices' },
      { id: '2-8', name: 'Brown stock', quantity: 0.5, unit: 'cup', category: 'Pantry' },
      { id: '2-9', name: 'Parmesan cheese, grated', quantity: 0.5, unit: 'cup', category: 'Dairy' },
      { id: '2-10', name: 'Butter, to finish', quantity: 1, unit: 'tbsp', category: 'Dairy' }
    ],
    steps: [
      { stepNumber: 1, instruction: 'Melt a small piece of butter in a saucepan.' },
      { stepNumber: 2, instruction: 'Brown the thinly sliced onion in the butter.' },
      { stepNumber: 3, instruction: 'Once the onion is browned, push it aside and add the rice little by little, stirring constantly with a wooden spoon.' },
      { stepNumber: 4, instruction: 'Whenever the rice becomes dry, ladle in some hot broth (or hot water). Keep adding broth and stirring until the rice is completely cooked, about 20 minutes.', timer: 20 },
      { stepNumber: 5, instruction: 'Season with salt, pepper, and a pinch of saffron.' },
      { stepNumber: 6, instruction: 'When the rice is almost done, stir in the brown stock.' },
      { stepNumber: 7, instruction: 'Finish by mixing in the Parmesan cheese and the remaining butter. Mix well and serve hot immediately.' }
    ],
    nutrition: { calories: 380, protein: 9, carbs: 58, fats: 12, fiber: 1, sugar: 2, sodium: 520 },
    dietaryRestrictions: ['Gluten-Free'],
    cuisineType: 'Italian',
    tags: ['risotto', 'rice', 'saffron', 'classic', 'historic recipe'],
    author: 'Maria Gentile (1919)',
    dateAdded: '2026-03-02',
    ownerId: null,
    isPublic: true,
    isOfficial: true,
    parentRecipeId: null,
    twistCount: 0,
    tips: [
      'Use a vegetable stock instead of brown stock to make this fully vegetarian.',
      'Adapted from "The Italian Cook Book: The Art of Eating Well" by Maria Gentile (1919), public domain via Project Gutenberg.'
    ]
  }
];
