// Meal Plan Generator — server-side plan generation
//
// Builds the prompts from validated quiz answers, makes the 3 sequential Claude
// calls (Mon–Thu, Fri–Sun, grocery list + notes), repairs/parses the JSON, and
// assembles planData. Runs only inside Netlify Functions — the API key never
// reaches the browser.

import Anthropic from '@anthropic-ai/sdk';
import foods from '../../data/foods.js';
import protocols from '../../data/protocols.js';
import { buildMatchers, findViolations } from './compliance.mjs';
import { currentBrand } from './brand.mjs';

const { getAllFoodNames, FOOD_CATEGORIES } = foods;
const { getProtocol, getIncompatiblePairs, getProtocolAvoids } = protocols;

// Protocols where low carbohydrate intake is the point (or that are formula-based)
const LOW_CARB_PROTOCOLS = ['Keto', 'Carnivore', "Lion's Diet"];
const NO_SMOOTHIE_PROTOCOLS = ['Carnivore', "Lion's Diet", 'Elemental'];

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
  Leisurely: '60+ minutes is fine — the cook enjoys spending time in the kitchen.',
  Mixed: 'Quick (under 30 minutes) on weeknights, in-depth recipes on the weekend.'
};

const WEEKEND = ['Saturday', 'Sunday'];

// Per-day time rule; "Mixed" = quick Monday–Friday, in-depth Saturday & Sunday
function cookingTimeLines(input, days) {
  if (input.cookingTime !== 'Mixed') {
    return [`- Time per meal: ${input.cookingTime} — ${COOKING_TIMES[input.cookingTime]}`];
  }
  const scope = days || [...DAYS_PART_1, ...DAYS_PART_2];
  const weekdays = scope.filter(day => !WEEKEND.includes(day));
  const weekend = scope.filter(day => WEEKEND.includes(day));
  const lines = ['- Time per meal varies by day:'];
  if (weekdays.length) lines.push(`  - ${weekdays.join(', ')}: QUICK — every meal under 30 minutes total (prep + cook), simple weeknight cooking.`);
  if (weekend.length) lines.push(`  - ${weekend.join(', ')}: IN-DEPTH — 60+ minutes is welcome; make these the week's more involved, special recipes (slow braises, roasts, homemade sauces, batch-friendly projects).`);
  return lines;
}

function validateMacroTargets(raw) {
  if (raw == null) return null;
  const int = (value, min, max, label) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`Macro target for ${label} is out of range.`);
    return n;
  };
  const text = value => String(value ?? '').replace(/[^\w\s-]/g, '').trim().slice(0, 30);
  return {
    calories: int(raw.calories, 800, 6000, 'calories'),
    protein_g: int(raw.protein_g, 0, 500, 'protein'),
    fat_g: int(raw.fat_g, 0, 400, 'fat'),
    carbs_g: int(raw.carbs_g, 0, 900, 'carbs'),
    goal: text(raw.goal),
    style: text(raw.style)
  };
}

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
    includeSnack: raw.includeSnack === true,
    includeSmoothies: raw.includeSmoothies !== false,
    macroTargets: validateMacroTargets(raw.macroTargets)
  };
}

/* ==========================================================================
   Prompts
   ========================================================================== */
const systemPrompt = () => `You are the clinical meal-planning assistant for ${currentBrand().server.practice}. You write meal plans for chronically ill, highly sensitive clients on strict elimination protocols.

Protocol adherence is non-negotiable:
- Never include an ingredient that ANY selected protocol excludes, or that the client has personally restricted — including in seasonings, cooking fats, sauces, broths, garnishes, toppings, and "optional" add-ins.
- Ingredients must be allowed on every selected protocol at the same time. If you are unsure whether an ingredient is allowed, leave it out and choose something clearly compliant.
- Never suggest substitutions that would break a rule.

Respond ONLY with raw JSON. No markdown. No backticks. No explanation.`;

// Foods the selected protocols rule out (food name → protocol names)
function protocolAvoidMap(input) {
  return getProtocolAvoids(input.protocols, FOOD_CATEGORIES);
}

const isElemental = input => input.protocols.includes('Elemental');
const isLowCarb = input => input.protocols.some(p => LOW_CARB_PROTOCOLS.includes(p));

// Daily energy each plan day should provide, per person
export function energyTarget(input) {
  if (input.macroTargets) return input.macroTargets.calories;
  const lbs = input.weightUnit === 'kg' ? input.weight * 2.20462 : input.weight;
  return Math.min(2800, Math.max(1600, Math.round((lbs * 13) / 50) * 50)); // ~maintenance, never below 1,600
}

function nutritionLines(input) {
  if (isElemental(input)) return [];
  const energy = energyTarget(input);
  const lines = [
    '',
    'NUTRITION ADEQUACY (critical — these clients are often depleted, and under-eating harms hormones, thyroid function and recovery):'
  ];
  if (input.macroTargets) {
    lines.push('- Hit the daily macro targets above; they set the calories and carbohydrates for each day.');
  } else {
    lines.push(`- Each day must provide about ${energy.toLocaleString('en-US')} calories per person (never below ${Math.round(energy * 0.85).toLocaleString('en-US')}). This is not a weight-loss plan.`);
    if (!isLowCarb(input)) {
      const carbs = Math.round((energy * 0.4) / 4 / 5) * 5;
      lines.push(`- This is NOT a low-carb plan: aim for about ${carbs} g of carbohydrates per day (roughly 40% of calories) from compliant whole foods.`);
    }
  }
  if (!isLowCarb(input)) {
    lines.push('- Include a compliant starch or fresh fruit at every meal — e.g. sweet potato, cassava/yuca, plantain, taro, winter squash, root vegetables, white rice or quinoa where allowed, and fresh (not dried) fruit where allowed. Non-starchy vegetables alone are not enough carbohydrate.');
  }
  lines.push('- Every main meal has a generous protein portion (about 25–40 g protein per serving) and enough healthy fat to be satisfying.');
  return lines;
}

function smoothieLines(input) {
  if (input.protocols.some(p => NO_SMOOTHIE_PROTOCOLS.includes(p))) return [];
  if (!input.includeSmoothies) return ['- Do not include smoothies.'];
  return [
    `- Make 2–3 of the week's ${input.includeSnack ? 'breakfasts or snacks' : 'breakfasts'} quick blended smoothies (prep_time about "5 min", cook_time "0 min") built only from compliant ingredients.`,
    '- Each smoothie must be a real meal: a compliant liquid base, fresh or frozen fruit where allowed, greens, a healthy fat, and a compliant protein source (aim for 20 g+ protein — e.g. collagen or a compliant protein powder only if every selected protocol allows it).'
  ];
}

function profileBlock(input, days) {
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
  const avoids = protocolAvoidMap(input);
  if (avoids.size) {
    lines.push('');
    lines.push('FOODS THE SELECTED PROTOCOLS RULE OUT — never use any of these, in any form (including oils, flours, sauces, powders, broths and garnishes):');
    lines.push([...avoids.keys()].join(', '));
  }
  const personal = input.restrictions.filter(food => !avoids.has(food));
  lines.push('');
  lines.push(personal.length
    ? `PERSONAL RESTRICTIONS — never use these in any form, even if a protocol normally allows them: ${personal.join(', ')}`
    : 'PERSONAL RESTRICTIONS: none beyond the protocol rules.');
  lines.push('');
  lines.push('COOKING');
  lines.push(`- Skill level: ${input.cookingSkill} — ${SKILL_LEVELS[input.cookingSkill]}`);
  lines.push(...cookingTimeLines(input, days));
  lines.push(`- Servings: every recipe makes ${input.servings} serving${input.servings === 1 ? '' : 's'}.`);
  lines.push(`- Meals per day: ${input.includeSnack ? 'breakfast, lunch, dinner, and one snack' : 'breakfast, lunch, and dinner (no snack)'}`);

  const t = input.macroTargets;
  if (t) {
    lines.push('');
    lines.push('DAILY MACRO TARGETS (per person, per day — the client tracks macros):');
    lines.push(`- Calories: about ${t.calories} kcal`);
    lines.push(`- Protein: ${t.protein_g} g · Fat: ${t.fat_g} g · Carbs: ${t.carbs_g} g`);
    if (t.goal || t.style) lines.push(`- Goal: ${[t.goal, t.style].filter(Boolean).join(' · ')}`);
    lines.push('- Build each day so its per-serving totals across all meals land within ±10% of every target. Protein is the top priority.');
    lines.push('- Size portions and choose ingredients to hit the targets; keep any snack smaller than the main meals.');
    lines.push('- Protocol rules always win: if a target conflicts with a protocol (for example carbs on Keto or Carnivore), follow the protocol and get as close as you can.');
    lines.push('- Report macros accurately for the recipe as written — never adjust the numbers to look on-target.');
  }
  lines.push(...nutritionLines(input));
  const smoothies = smoothieLines(input);
  if (smoothies.length) lines.push('', 'SMOOTHIES', ...smoothies);
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
    profileBlock(input, days),
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
      system: systemPrompt(),
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
/* ==========================================================================
   Review — catch excluded foods and under-fuelled days, then ask for one revision
   ========================================================================== */
const MEAL_NAMES = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack' };

function reviewDays(days, input, matchers) {
  const issues = [];
  for (const v of findViolations(days, matchers)) {
    issues.push(`${v.day} ${MEAL_NAMES[v.slot] || v.slot} ("${v.meal}") uses "${v.ingredient}", but ${v.food} is excluded.`);
  }
  if (!isElemental(input)) {
    const energy = energyTarget(input);
    const t = input.macroTargets;
    for (const day of days) {
      if (day.daily_calories < energy * 0.85) {
        issues.push(`${day.day} totals only ${day.daily_calories} calories per person; it needs about ${energy}. Increase portions and add compliant starches, fruit and fats.`);
      }
      if (t) {
        if (day.daily_protein_g < t.protein_g * 0.85) issues.push(`${day.day} has ${day.daily_protein_g} g protein; the target is ${t.protein_g} g.`);
        if (Math.abs(day.daily_carbs_g - t.carbs_g) > t.carbs_g * 0.2 && Math.abs(day.daily_carbs_g - t.carbs_g) > 15) issues.push(`${day.day} has ${day.daily_carbs_g} g carbs; the target is ${t.carbs_g} g.`);
        if (Math.abs(day.daily_fat_g - t.fat_g) > t.fat_g * 0.2 && Math.abs(day.daily_fat_g - t.fat_g) > 10) issues.push(`${day.day} has ${day.daily_fat_g} g fat; the target is ${t.fat_g} g.`);
      } else if (!isLowCarb(input) && day.daily_carbs_g < 100) {
        issues.push(`${day.day} has only ${day.daily_carbs_g} g carbohydrates; add a compliant starch or fresh fruit to every meal (aim for about ${Math.round((energy * 0.4) / 4)} g).`);
      }
    }
  }
  return issues;
}

// Writes a set of days, then reviews them; if anything is off, asks Claude once to fix
// exactly those problems. Whatever still fails is returned as warnings for the coach.
async function writeDays(input, days, prompt, label, matchers) {
  const validate = daysValidator(days, input);
  let result = await callForJson(prompt, label, validate);
  let issues = reviewDays(result, input, matchers);

  if (issues.length) {
    console.warn(`[meal-plan] ${label}: ${issues.length} issue(s), requesting a revision`);
    const revisionPrompt = `${prompt}

YOUR PREVIOUS DRAFT OF THESE DAYS HAD THESE PROBLEMS — rewrite the days so every one is fixed, keeping everything else that was right:
${issues.map(issue => `- ${issue}`).join('\n')}

Previous draft (for reference):
${JSON.stringify(result)}`;
    try {
      const revised = await callForJson(revisionPrompt, `revising ${label.replace(/^writing /, '')}`, validate);
      const revisedIssues = reviewDays(revised, input, matchers);
      if (revisedIssues.length <= issues.length) {
        result = revised;
        issues = revisedIssues;
      }
    } catch (err) {
      console.warn(`[meal-plan] ${label}: revision failed, keeping first draft`, err.message);
    }
  }
  return { days: result, unresolved: issues.length };
}

// Short, grouped list of whatever the review still flags in the final plan
function summarizeWarnings(days, input, matchers) {
  const warnings = [];
  const byFood = new Map();
  for (const v of findViolations(days, matchers)) {
    byFood.set(v.food, [...(byFood.get(v.food) || []), `${v.day} ${MEAL_NAMES[v.slot] || v.slot} ("${v.ingredient}")`]);
  }
  for (const [food, places] of byFood) {
    const shown = places.slice(0, 6).join('; ') + (places.length > 6 ? `; and ${places.length - 6} more` : '');
    warnings.push(`${food} should be avoided but appears in ${places.length} meal${places.length === 1 ? '' : 's'}: ${shown}.`);
  }
  if (!isElemental(input)) {
    const energy = energyTarget(input);
    const lowCalories = days.filter(d => d.daily_calories < energy * 0.85);
    if (lowCalories.length) {
      warnings.push(`Below the ~${energy.toLocaleString('en-US')} calorie target on ${lowCalories.map(d => `${d.day} (${d.daily_calories.toLocaleString('en-US')})`).join(', ')} — consider larger portions or an extra snack.`);
    }
    if (!input.macroTargets && !isLowCarb(input)) {
      const lowCarbs = days.filter(d => d.daily_carbs_g < 100);
      if (lowCarbs.length) {
        warnings.push(`Low in carbohydrates on ${lowCarbs.map(d => `${d.day} (${d.daily_carbs_g} g)`).join(', ')} — add a compliant starch or fresh fruit.`);
      }
    }
    const t = input.macroTargets;
    if (t) {
      const lowProtein = days.filter(d => d.daily_protein_g < t.protein_g * 0.85);
      if (lowProtein.length) warnings.push(`Below the ${t.protein_g} g protein target on ${lowProtein.map(d => `${d.day} (${d.daily_protein_g} g)`).join(', ')}.`);
    }
  }
  return warnings;
}

export async function generatePlan(input, onProgress = async () => {}) {
  const avoided = [...protocolAvoidMap(input).keys(), ...input.restrictions];
  const matchers = buildMatchers(avoided);

  await onProgress(2);
  const one = await writeDays(input, DAYS_PART_1, daysPrompt(input, DAYS_PART_1), 'writing Monday–Thursday recipes', matchers);
  const partOne = one.days;

  await onProgress(3);
  const usedNames = partOne.flatMap(day => Object.values(day.meals).map(meal => meal.name));
  const two = await writeDays(input, DAYS_PART_2, daysPrompt(input, DAYS_PART_2, usedNames), 'writing Friday–Sunday recipes', matchers);
  const partTwo = two.days;

  const days = [...partOne, ...partTwo];

  await onProgress(4);
  const extras = await callForJson(groceryPrompt(input, days), 'building the grocery list', groceryValidator);

  return {
    days,
    grocery_list: extras.grocery_list,
    protocol_notes: extras.protocol_notes,
    warnings: one.unresolved || two.unresolved ? summarizeWarnings(days, input, matchers) : [],
    generated_at: new Date().toISOString(),
    model: MODEL
  };
}
