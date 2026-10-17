// RWC Meal Plan Generator — server-side plan generation
//
// Builds the prompts from validated quiz answers, makes the 3 sequential Claude
// calls (Mon–Thu, Fri–Sun, grocery list + notes), repairs/parses the JSON, and
// assembles planData. Runs only inside Netlify Functions — the API key never
// reaches the browser.

import Anthropic from '@anthropic-ai/sdk';
import foods from '../../data/foods.js';
import protocols from '../../data/protocols.js';

const { getAllFoodNames } = foods;
const { getProtocol, getIncompatiblePairs } = protocols;

export const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 10000;
const PARSE_ATTEMPTS = 2; // one automatic retry if a response can't be parsed

const DAYS_PART_1 = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const DAYS_PART_2 = ['Friday', 'Saturday', 'Sunday'];

const SKILL_LEVELS = {
  Beginner: 'Simple recipes, 5 ingredients or fewer (salt, pepper and cooking fat not counted), no special techniques.',
  Intermediate: 'Comfortable with basic techniques, moderate variety.',
  Advanced: 'Confident cook, open to complex flavors and multi-step recipes.'
};

const COOKING_TIMES = {
  Quick: 'Under 30 minutes total (prep + cook) per meal.',
  Standard: '30–60 minutes total (prep + cook) per meal.',
  Leisurely: '60+ minutes is fine — the cook enjoys spending time in the kitchen.'
};

export const GROCERY_CATEGORIES = [
  'Proteins', 'Vegetables', 'Fruits', 'Fats & Oils', 'Grains & Starches',
  'Legumes & Beans', 'Nuts & Seeds', 'Pantry & Condiments', 'Baking', 'Beverages & Extras'
];

/* ==========================================================================
   Input validation — the function only ever builds meal-plan prompts from
   known values, so the endpoint can't be used as a general Claude proxy.
   ========================================================================== */
export class InputError extends Error {}

export function validateInput(raw) {
  if (!raw || typeof raw !== 'object') throw new InputError('Missing plan details.');

  const clientName = String(raw.clientName ?? '')
    .replace(/[^\p{L}\p{M}\s'.-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  if (!clientName) throw new InputError('Client first name is required.');

  const age = Number(raw.age);
  if (!Number.isInteger(age) || age < 1 || age > 110) throw new InputError('Age must be between 1 and 110.');

  const weight = Number(raw.weight);
  if (!(weight > 0 && weight <= 1500)) throw new InputError('Weight is not valid.');

  const weightUnit = raw.weightUnit === 'kg' ? 'kg' : 'lbs';

  const selected = Array.isArray(raw.protocols) ? [...new Set(raw.protocols)] : [];
  if (!selected.length) throw new InputError('Select at least one protocol.');
  const unknown = selected.filter(name => !getProtocol(name));
  if (unknown.length) throw new InputError(`Unknown protocol: ${unknown.join(', ')}`);
  if (getIncompatiblePairs(selected).length) throw new InputError('The selected protocols have no foods in common.');

  const allFoods = new Set(getAllFoodNames());
  const restrictions = Array.isArray(raw.restrictions)
    ? [...new Set(raw.restrictions)].filter(food => allFoods.has(food))
    : [];

  if (!SKILL_LEVELS[raw.cookingSkill]) throw new InputError('Cooking skill level is not valid.');
  if (!COOKING_TIMES[raw.cookingTime]) throw new InputError('Cooking time is not valid.');

  const servings = Number(raw.servings);
  if (![1, 2, 4].includes(servings)) throw new InputError('Serving size is not valid.');

  return {
    clientName,
    age,
    weight,
    weightUnit,
    protocols: selected,
    restrictions,
    cookingSkill: raw.cookingSkill,
    cookingTime: raw.cookingTime,
    servings,
    includeSnack: raw.includeSnack === true
  };
}

/* ==========================================================================
   Prompts
   ========================================================================== */
const SYSTEM_PROMPT = `You are the clinical meal-planning assistant for Redefining Wellness Center (Dr. Jaban Moore, DC). You write meal plans for chronically ill, highly sensitive clients on strict elimination protocols.

Protocol adherence is non-negotiable:
- Never include an ingredient that ANY selected protocol excludes, or that the client has personally restricted — including in seasonings, cooking fats, sauces, broths, garnishes, toppings, and "optional" add-ins.
- Ingredients must be allowed on every selected protocol at the same time. If you are unsure whether an ingredient is allowed, leave it out and choose something clearly compliant.
- Never suggest substitutions that would break a rule.

Respond ONLY with raw JSON. No markdown. No backticks. No explanation.`;

function profileBlock(input) {
  const lines = [];
  lines.push('CLIENT');
  lines.push(`- Name: ${input.clientName}`);
  lines.push(`- Age: ${input.age}`);
  lines.push(`- Weight: ${input.weight} ${input.weightUnit}`);
  lines.push('');
  lines.push(`DIET PROTOCOLS: ${input.protocols.join(', ')}`);
  if (input.protocols.length > 1) {
    lines.push('Find the intersection — only use foods allowed on ALL of these protocols simultaneously.');
  }
  lines.push('');
  lines.push('PROTOCOL RULES (follow every rule for every selected protocol):');
  for (const name of input.protocols) {
    const protocol = getProtocol(name);
    lines.push(`${protocol.name}:`);
    protocol.rules.forEach(rule => lines.push(`  - ${rule}`));
    if (protocol.note) lines.push(`  - NOTE: ${protocol.note}`);
  }
  lines.push('');
  lines.push(input.restrictions.length
    ? `PERSONAL RESTRICTIONS — never use these in any form, even if a protocol normally allows them: ${input.restrictions.join(', ')}`
    : 'PERSONAL RESTRICTIONS: none beyond the protocol rules.');
  lines.push('');
  lines.push('COOKING');
  lines.push(`- Skill level: ${input.cookingSkill} — ${SKILL_LEVELS[input.cookingSkill]}`);
  lines.push(`- Time per meal: ${input.cookingTime} — ${COOKING_TIMES[input.cookingTime]}`);
  lines.push(`- Servings: every recipe makes ${input.servings} serving${input.servings === 1 ? '' : 's'}.`);
  lines.push(`- Meals per day: ${input.includeSnack ? 'breakfast, lunch, dinner, and one snack' : 'breakfast, lunch, and dinner (no snack)'}`);
  return lines.join('\n');
}

function daySchemaExample(input) {
  const meal = `{
      "name": "",
      "prep_time": "10 min",
      "cook_time": "15 min",
      "servings": ${input.servings},
      "ingredients": ["4 oz wild-caught salmon fillet", "1 tbsp coconut oil"],
      "instructions": [
        "Heat coconut oil in a skillet over medium-high heat.",
        "Season salmon with salt and place skin-side up.",
        "Cook 4–5 minutes per side until flaky."
      ],
      "protein_g": 28,
      "fat_g": 12,
      "carbs_g": 0,
      "calories": 220
    }`;
  return `{
  "day": "Monday",
  "meals": {
    "breakfast": ${meal},
    "lunch": { ...same structure... },
    "dinner": { ...same structure... }${input.includeSnack ? ',\n    "snack": { ...same structure... }' : ''}
  },
  "daily_protein_g": 0,
  "daily_fat_g": 0,
  "daily_carbs_g": 0,
  "daily_calories": 0
}`;
}

const RECIPE_RULES = `RECIPE RULES
- Every ingredient string starts with a numeric quantity and unit, then the ingredient (e.g. "2 tbsp olive oil", "1/2 cup diced carrots", "1 1/2 lbs ground beef", "3 large eggs"). Quantities are for the full recipe at the stated servings.
- Instructions are clear, numbered-friendly steps in order (no step numbers in the text).
- prep_time and cook_time are strings like "10 min".
- protein_g, fat_g, carbs_g and calories are integers PER SERVING (what one person eats).
- daily_* totals are the sum of that day's meals per serving.
- Vary proteins, vegetables and cooking methods across the week. Do not repeat a recipe.`;

function daysPrompt(input, days, previousRecipeNames = []) {
  const parts = [
    profileBlock(input),
    '',
    RECIPE_RULES,
    ''
  ];
  if (previousRecipeNames.length) {
    parts.push('Continue from Monday–Thursday — do not repeat any recipe used earlier this week. Recipes already used:');
    parts.push(previousRecipeNames.map(n => `- ${n}`).join('\n'));
    parts.push('');
  }
  parts.push(`Write the meal plan for ${days.join(', ')} (${days.length} days).`);
  parts.push('');
  parts.push('Respond ONLY with a raw JSON array. No markdown. No backticks. No explanation. Just the JSON array.');
  parts.push(`The array has exactly ${days.length} objects, one per day in order, each with this structure:`);
  parts.push(daySchemaExample(input));
  return parts.join('\n');
}

function groceryPrompt(input, days) {
  // Send just what the grocery list needs: every recipe's ingredients, by day.
  const ingredientsByDay = days.map(day => ({
    day: day.day,
    meals: Object.fromEntries(Object.entries(day.meals).map(([slot, meal]) => [slot, {
      name: meal.name,
      ingredients: meal.ingredients
    }]))
  }));

  return [
    profileBlock(input),
    '',
    'Here is the complete 7-day meal plan (recipes and ingredients):',
    JSON.stringify(ingredientsByDay),
    '',
    'Build the weekly grocery list for this plan and write short protocol notes.',
    '- Combine duplicate ingredients across the week into one line with the total quantity to buy (e.g. "Wild-caught salmon — 2 lbs for the week").',
    `- Use exactly these categories as keys (empty array if nothing belongs): ${GROCERY_CATEGORIES.join(', ')}.`,
    '- protocol_notes: 2–3 sentence reminder of the key rules for these specific protocols and restrictions, written warmly for the client.',
    '',
    'Respond ONLY with a raw JSON object. No markdown. No backticks. No explanation. Use this structure:',
    `{
  "grocery_list": {
${GROCERY_CATEGORIES.map(c => `    "${c}": []`).join(',\n')}
  },
  "protocol_notes": ""
}`
  ].join('\n');
}

/* ==========================================================================
   JSON repair (strips fences, closes truncated arrays/objects)
   ========================================================================== */
export function repairJson(raw) {
  raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (raw && raw[raw.length - 1] !== '}' && raw[raw.length - 1] !== ']') {
    let opens = 0, closes = 0, oArr = 0, cArr = 0;
    for (let c of raw) {
      if (c === '{') opens++;
      if (c === '}') closes++;
      if (c === '[') oArr++;
      if (c === ']') cArr++;
    }
    raw = raw.replace(/,\s*$/, '');
    raw = raw.replace(/,\s*"[^"]*"\s*:\s*[^,}\]]*$/, '');
    for (let i = 0; i < oArr - cArr; i++) raw += ']';
    for (let i = 0; i < opens - closes; i++) raw += '}';
  }
  return raw;
}

/* ==========================================================================
   Claude calls
   ========================================================================== */
let client;
function getClient() {
  const apiKey = globalThis.Netlify?.env.get('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('The server is missing its ANTHROPIC_API_KEY. Add it in Netlify → Site configuration → Environment variables, then redeploy.');
  client ??= new Anthropic({ apiKey });
  return client;
}

// Streams one request (avoids HTTP timeouts on long outputs) and returns its text.
async function callClaude(prompt, label) {
  let message;
  try {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Netlify.');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error('The AI service is busy right now (rate limited). Please wait a minute and try again.');
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`The AI service returned an error while ${label} (${err.status ?? 'network'}). Please try again.`);
    }
    throw err;
  }

  if (message.stop_reason === 'refusal') {
    throw new Error(`The AI declined the request while ${label}. Please try again or adjust the selections.`);
  }
  if (message.stop_reason === 'max_tokens') {
    console.warn(`[meal-plan] ${label}: response hit max_tokens; attempting JSON repair`);
  }
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('');
}

// Calls Claude, repairs + parses the JSON, validates it; retries once on bad output.
async function callForJson(prompt, label, validate) {
  let lastError;
  for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
    const text = await callClaude(prompt, label);
    try {
      return validate(JSON.parse(repairJson(text)));
    } catch (err) {
      lastError = err;
      console.warn(`[meal-plan] ${label}: unusable response on attempt ${attempt}: ${err.message}`);
    }
  }
  throw new Error(`Couldn't read the AI's response while ${label} (${lastError.message}). Please try again.`);
}

/* ==========================================================================
   Normalization — coerce the model's output into the exact planData shape
   ========================================================================== */
const toInt = value => {
  const n = Math.round(Number(String(value ?? '').replace(/[^\d.-]/g, '')));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const toStringList = value => (Array.isArray(value) ? value : [])
  .map(item => String(item ?? '').trim())
  .filter(Boolean);

function normalizeMeal(meal, slot, day, servings) {
  if (!meal || typeof meal !== 'object' || !String(meal.name ?? '').trim()) {
    throw new Error(`${day} ${slot} is missing`);
  }
  const ingredients = toStringList(meal.ingredients);
  const instructions = toStringList(meal.instructions).map(step => step.replace(/^\s*\d+[.)]\s*/, ''));
  if (!ingredients.length || !instructions.length) throw new Error(`${day} ${slot} has no ingredients or instructions`);
  return {
    name: String(meal.name).trim(),
    prep_time: String(meal.prep_time ?? '').trim() || '—',
    cook_time: String(meal.cook_time ?? '').trim() || '—',
    servings,
    ingredients,
    instructions,
    protein_g: toInt(meal.protein_g),
    fat_g: toInt(meal.fat_g),
    carbs_g: toInt(meal.carbs_g),
    calories: toInt(meal.calories)
  };
}

function daysValidator(expectedDays, input) {
  const slots = input.includeSnack ? ['breakfast', 'lunch', 'dinner', 'snack'] : ['breakfast', 'lunch', 'dinner'];
  return parsed => {
    const array = Array.isArray(parsed) ? parsed : parsed?.days;
    if (!Array.isArray(array)) throw new Error('expected a JSON array of days');
    if (array.length < expectedDays.length) throw new Error(`expected ${expectedDays.length} days, got ${array.length}`);

    return expectedDays.map((dayName, i) => {
      const day = array[i] ?? {};
      const meals = {};
      for (const slot of slots) meals[slot] = normalizeMeal(day.meals?.[slot], slot, dayName, input.servings);
      // Daily totals are recomputed from the meals rather than trusting the model's arithmetic
      const sum = key => Object.values(meals).reduce((total, meal) => total + meal[key], 0);
      return {
        day: dayName,
        meals,
        daily_protein_g: sum('protein_g'),
        daily_fat_g: sum('fat_g'),
        daily_carbs_g: sum('carbs_g'),
        daily_calories: sum('calories')
      };
    });
  };
}

function groceryValidator(parsed) {
  if (!parsed || typeof parsed !== 'object' || typeof parsed.grocery_list !== 'object') {
    throw new Error('expected an object with grocery_list');
  }
  const groceryList = {};
  for (const category of GROCERY_CATEGORIES) groceryList[category] = toStringList(parsed.grocery_list[category]);
  // Keep anything filed under an unexpected category rather than dropping it
  for (const [category, items] of Object.entries(parsed.grocery_list)) {
    if (!GROCERY_CATEGORIES.includes(category)) groceryList['Pantry & Condiments'].push(...toStringList(items));
  }
  if (!Object.values(groceryList).some(items => items.length)) throw new Error('grocery list is empty');
  return {
    grocery_list: groceryList,
    protocol_notes: String(parsed.protocol_notes ?? '').trim()
  };
}

/* ==========================================================================
   Orchestration
   onProgress(stepIndex) is called as each step starts:
     0 applying protocol rules · 1 filtering restrictions · 2 Mon–Thu · 3 Fri–Sun · 4 grocery list
   ========================================================================== */
export async function generatePlan(input, onProgress = async () => {}) {
  await onProgress(2);
  const partOne = await callForJson(daysPrompt(input, DAYS_PART_1), 'writing Monday–Thursday recipes', daysValidator(DAYS_PART_1, input));

  await onProgress(3);
  const usedNames = partOne.flatMap(day => Object.values(day.meals).map(meal => meal.name));
  const partTwo = await callForJson(daysPrompt(input, DAYS_PART_2, usedNames), 'writing Friday–Sunday recipes', daysValidator(DAYS_PART_2, input));

  const days = [...partOne, ...partTwo];

  await onProgress(4);
  const extras = await callForJson(groceryPrompt(input, days), 'building the grocery list', groceryValidator);

  return {
    days,
    grocery_list: extras.grocery_list,
    protocol_notes: extras.protocol_notes,
    generated_at: new Date().toISOString(),
    model: MODEL
  };
}
