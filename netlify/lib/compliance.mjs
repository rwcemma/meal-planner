// RWC Meal Plan Generator — post-generation compliance check
//
// Scans every ingredient line for foods the client must avoid (protocol exclusions +
// personal restrictions). Each food in data/foods.js becomes one or more word-bounded
// patterns; matches followed by "-free" / " free" (e.g. "dairy-free") are ignored.
// It's a safety net, not a parser: anything it flags is sent back to Claude to fix, and
// anything still flagged afterwards is shown to the coach to double-check.

// Patterns (regex source, case-insensitive) for foods whose names don't match on their own
const OVERRIDES = {
  'Eggs (whole)': ['eggs?'],
  'Egg yolks': ['egg yolks?', 'yolks?'],
  'Egg whites': ['egg whites?'],
  "Cow's milk": ["cow'?s milk", 'whole milk', '(?<!(?:coconut|almond|oat|cashew|rice|hemp|soy|nut|camel\'?s|goat\'?s|sheep\'?s|plant-based|dairy-free) )milk(?! (?:kefir|thistle))'],
  "Goat's milk": ["goat'?s milk"],
  "Sheep's milk": ["sheep'?s milk"],
  "Camel's milk": ["camel'?s milk"],
  Butter: ['(?<!(?:nut|almond|cashew|peanut|sunflower|seed|coconut|apple|cocoa|cacao|shea|pumpkin|sesame|walnut|pecan|hazelnut|macadamia)[ -]?)butter(?! (?:lettuce|beans?))'],
  'Heavy cream': ['heavy cream', 'whipping cream', 'double cream', 'half[- ]and[- ]half'],
  'Hard cheese': ['parmesan', 'parmigiano', 'cheddar', 'gouda', 'pecorino', 'gruyere', 'manchego', 'aged cheese', 'hard cheese'],
  'Soft cheese': ['mozzarella', 'ricotta', 'feta', 'goat cheese', 'brie', 'cottage cheese', 'burrata', 'soft cheese'],
  'Yogurt (dairy)': ['(?<!(?:coconut|almond|cashew|oat|dairy-free|plant-based|coconut milk) )yogh?urt'],
  Kefir: ['(?<!(?:water|coconut) )kefir'],
  'Kefir (water)': ['water kefir'],
  'Lettuce (all)': ['lettuce', 'romaine'],
  'Swiss chard': ['chard'],
  'Bok choy': ['bok choy', 'pak choi'],
  'Collard greens': ['collards?'],
  Broccoli: ['broccoli(?!ni)'],
  Cabbage: ['(?<!napa )cabbage'],
  Beets: ['beets?', 'beetroot'],
  Radishes: ['(?<!daikon )radish(?:es)?'],
  'White potato': ['(?<!sweet )potato(?:es)?(?! starch)', 'russet', 'yukon gold'],
  'Bell peppers': ['bell peppers?', '(?:red|green|yellow|orange) peppers?(?! flakes)', 'roasted peppers?', 'pimento'],
  'Hot peppers': ['jalape[nñ]os?', 'chil[ei]s?(?! (?:oil|powder|flakes))', 'chilli', 'serrano', 'habanero', 'chipotle', 'poblano', 'thai chil'],
  Onion: ['(?<!(?:green|spring) )onions?(?! powder)'],
  Garlic: ['garlic(?![- ](?:infused|powder))'],
  'Pumpkin/squash': ['pumpkin(?! seeds?)', '(?<!spaghetti )squash', 'butternut', 'kabocha', 'delicata', 'spaghetti squash'],
  Celery: ['celery(?! (?:root|salt|seeds?))'],
  Fennel: ['fennel(?! seeds?)'],
  Mushrooms: ['mushrooms?', 'shiitake', 'portobello', 'cremini', 'chanterelle', 'maitake'],
  Avocado: ['avocados?(?! oil)'],
  Olives: ['olives?(?! oil)'],
  Peas: ['(?<!(?:black-eyed|split|chick|pigeon) )peas?(?! protein)', 'snap peas', 'snow peas'],
  'Green beans': ['green beans?', 'haricots? verts?', 'string beans?'],
  Corn: ['corn(?:starch|meal)?', 'polenta', 'grits', 'maize'],
  Apples: ['apples?(?! cider)'],
  Grapes: ['grapes?(?!fruit| ?seed)'],
  Oranges: ['oranges?'],
  Lemons: ['lemons?'],
  Limes: ['limes?'],
  Coconut: ['coconut'],
  Dates: ['dates?', 'medjool'],
  'Dried fruits (all)': ['dried (?:fruits?|apricots?|mango|cranberr(?:y|ies)|figs?|dates|cherries|blueberries)', 'raisins?', 'prunes?', 'currants?'],
  'Tangerines/Mandarins': ['tangerines?', 'mandarins?', 'clementines?'],
  'White rice': ['white rice', '(?<!(?:cauliflower|broccoli|wild|brown|jasmine|basmati) )rice(?! (?:vinegar|noodles?|flour|paper|crackers?|cakes?|bran|milk))'],
  'Jasmine/Basmati rice': ['jasmine rice', 'basmati rice'],
  'Rice noodles': ['rice noodles?', 'rice vermicelli'],
  Oats: ['oats?', 'oatmeal'],
  'Cornmeal/Polenta': ['cornmeal', 'polenta', 'grits'],
  'Wheat/Gluten': ['wheat(?!grass)', 'gluten', 'seitan', 'semolina', 'couscous', 'bulgur'],
  'Bread (all)': ['bread(?:crumbs)?', 'pita', 'baguette', 'sourdough', 'toast'],
  'Pasta (wheat)': ['(?<!(?:zucchini|rice|chickpea|lentil|cassava|gluten-free|bean|veggie|vegetable) )pasta', 'spaghetti(?! squash)', 'penne', 'linguine', 'fettuccine', 'macaroni'],
  'Tortillas (wheat)': ['flour tortillas?', 'wheat tortillas?'],
  'Cassava/Tapioca': ['cassava', 'yuca', 'tapioca'],
  'Plantain chips/flour': ['plantain (?:chips|flour)'],
  'Chickpeas/Garbanzo': ['chickpeas?', 'garbanzos?'],
  'Lentils (all)': ['lentils?', 'dal'],
  'Cannellini/White beans': ['cannellini', 'white beans?'],
  'Lima/Butter beans': ['lima beans?', 'butter beans?'],
  'Soy (all forms)': ['soy(?:a|bean)?', 'tamari', 'edamame', 'tofu', 'tempeh', 'miso', 'shoyu'],
  'Soy sauce/Tamari': ['soy sauce', 'tamari', 'shoyu'],
  Peanuts: ['peanuts?'],
  'Nut butters (all)': ['(?:almond|cashew|peanut|sunflower|seed|nut|walnut|pecan|hazelnut|macadamia) butter', 'sunbutter'],
  'Sesame seeds/Tahini': ['sesame(?! oil)', 'tahini'],
  'Flax seeds': ['flax(?:seed)?s?'],
  'Chia seeds': ['chia'],
  'Hemp seeds': ['hemp'],
  'Pumpkin seeds': ['pumpkin seeds?', 'pepitas?'],
  'Sunflower seeds': ['sunflower seeds?', 'sunbutter'],
  Hazelnuts: ['hazelnuts?', 'filberts?'],
  'Seed oils (canola/soy/sunflower)': ['canola', 'soybean oil', 'sunflower oil', 'vegetable oil', 'safflower oil', 'corn oil', 'grapeseed oil'],
  'Beef tallow/Lard': ['tallow', 'lard'],
  'Palm oil': ['palm oil', 'palm shortening'],
  'Apple cider vinegar': ['apple cider vinegar', 'acv'],
  'Balsamic vinegar': ['balsamic'],
  'Lemon/Lime juice': ['lemon juice', 'lime juice'],
  'Mustard (all)': ['mustard(?! greens)', 'dijon'],
  'Mayonnaise/Aioli': ['mayo(?:nnaise)?', 'aioli'],
  'BBQ sauce': ['bbq sauce', 'barbecue sauce'],
  'Salsa/Pico de gallo': ['salsa', 'pico de gallo'],
  'Marinara/Tomato sauce': ['marinara', 'tomato sauce', 'pasta sauce'],
  'Hot sauce': ['hot sauce', 'sriracha', 'tabasco'],
  'Chili oil': ['chili oil', 'chili crisp'],
  'Worcestershire sauce': ['worcestershire'],
  'Black pepper': ['black pepper', 'peppercorns?', '(?<!(?:bell|red|green|yellow|orange|hot|chili|cayenne|sweet|roasted|banana|white) )pepper(?!s| flakes|corn)'],
  'Nightshade spices (paprika/cayenne)': ['paprika', 'cayenne', 'chili powder', 'chipotle powder', 'red pepper flakes', 'crushed red pepper'],
  'Seed-based spices (cumin/coriander/mustard seed)': ['cumin', 'coriander', 'mustard seeds?', 'fennel seeds?', 'caraway', 'nutmeg', 'fenugreek', 'anise'],
  'Fresh herbs (parsley/basil/cilantro/rosemary/thyme)': ['parsley', 'basil', 'cilantro', 'rosemary', 'thyme'],
  Cloves: ['(?<!garlic )cloves?(?! (?:of )?garlic)'],
  'Bay leaf': ['bay lea(?:f|ves)'],
  Mint: ['mint(?! tea)'],
  Coffee: ['coffee', 'espresso'],
  'Black tea': ['black tea', 'earl grey', 'english breakfast tea'],
  'Green tea': ['green tea', 'matcha'],
  'Herbal teas': ['herbal tea', 'chamomile', 'peppermint tea', 'rooibos'],
  'Maple syrup': ['maple'],
  'Dates/Date sugar': ['date sugar', 'date syrup'],
  'Monk fruit': ['monk ?fruit'],
  'Tapioca flour/starch': ['tapioca (?:flour|starch)'],
  'Arrowroot flour/starch': ['arrowroot'],
  'Chickpea flour': ['chickpea flour', 'garbanzo (?:bean )?flour', 'besan'],
  'Gluten-free flour blends': ['gluten-free flour', 'gf flour'],
  'Wheat flour': ['(?<!(?:almond|coconut|cassava|tapioca|oat|rice|buckwheat|chickpea|sorghum|whole wheat|spelt|rye|barley|gluten-free|arrowroot|plantain|tigernut|banana|garbanzo|bean|potato|sweet potato) )flour', 'all-purpose flour'],
  'Ground flax': ['ground flax', 'flax ?meal', 'flaxseed meal'],
  'Psyllium husk': ['psyllium'],
  'Cocoa/Cacao powder': ['cocoa', 'cacao', 'chocolate'],
  'Vanilla extract': ['vanilla'],
  'Agar agar': ['agar'],
  Beef: ['beef(?! tallow)', 'steak', 'sirloin', 'brisket', 'ribeye', 'chuck'],
  Lamb: ['lamb', 'mutton'],
  Bison: ['bison', 'buffalo(?! sauce)'],
  Pork: ['pork', 'bacon', 'ham', 'prosciutto', 'pancetta', 'chorizo'],
  'Organ meats (liver/heart/kidney)': ['liver', 'hearts?(?! of )', 'kidney(?! beans?)', 'organ meats?', 'offal'],
  Shrimp: ['shrimp', 'prawns?'],
  Oysters: ['oysters?(?! (?:sauce|mushrooms?))'],
  Anchovies: ['anchov(?:y|ies)'],
  'Bone broth': ['bone broth']
};

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Brussels sprouts" → "brussels sprouts?"; "Cherries" → "cherr(?:y|ies)"; "Tomatoes" → "tomato(?:es)?"
function wordPattern(word) {
  const w = escapeRegex(word.toLowerCase().trim());
  if (/ies$/.test(w)) return `${w.slice(0, -3)}(?:y|ies)`;
  if (/oes$/.test(w)) return `${w.slice(0, -2)}(?:es)?`;
  if (/[^s]s$/.test(w) && !/(?:us|is)$/.test(w)) return `${w.slice(0, -1)}s?`;
  if (/[a-z]$/.test(w)) return `${w}(?:es|s)?`; // "sweet potato" also matches "sweet potatoes"
  return w;
}

function defaultPatterns(food) {
  const base = food.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  return base.split('/').map(part => wordPattern(part)).filter(Boolean);
}

export function buildMatchers(foods) {
  return [...new Set(foods)].map(food => {
    const patterns = OVERRIDES[food] || defaultPatterns(food);
    // Word-bounded; skip "dairy-free", "gluten free" etc.
    return { food, regex: new RegExp(`\\b(?:${patterns.join('|')})\\b(?![- ]free)`, 'i') };
  });
}

// → [{ day, slot, meal, ingredient, food }]
export function findViolations(days, matchers) {
  const violations = [];
  for (const day of days) {
    for (const [slot, meal] of Object.entries(day.meals)) {
      for (const ingredient of meal.ingredients) {
        const hit = matchers.find(m => m.regex.test(ingredient));
        if (hit) violations.push({ day: day.day, slot, meal: meal.name, ingredient, food: hit.food });
      }
    }
  }
  return violations;
}
