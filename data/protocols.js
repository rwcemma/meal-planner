// RWC Meal Plan Generator — diet protocol metadata
//
// Each protocol: { name, icon, description, rules, note? }
//   - name / icon / description: shown on the Screen 3 cards (exactly per spec)
//   - rules:            key adherence rules sent to Claude in the generation prompt
//   - note:             extra instruction for protocols that need special handling
//
// INCOMPATIBLE_PROTOCOLS lists pairs whose combined food intersection is effectively empty.
//
// CLINICAL REVIEW: the `rules` below are concise summaries of each protocol's widely
// published elimination guidance. Have Dr. Moore / the clinical team review and edit
// them to match RWC's own protocol handouts — they directly drive what Claude allows.

const PROTOCOLS = [
  {
    name: 'AIP',
    icon: '🛡️',
    description: 'Autoimmune Protocol — eliminates inflammatory triggers',
    rules: [
      'No grains or pseudo-grains (including rice, oats, corn, quinoa, buckwheat).',
      'No legumes (including soy, peanuts, green beans, peas).',
      'No dairy of any kind, including butter and ghee.',
      'No eggs (whole, yolks, or whites).',
      'No nuts or seeds, including seed-based spices (cumin, coriander, mustard seed, fennel seed, nutmeg), coffee, cocoa, and seed oils.',
      'No nightshades: tomatoes, white potatoes, bell and hot peppers, eggplant, paprika, cayenne, chili.',
      'No refined sugar, sugar alcohols, or non-nutritive sweeteners (stevia, monk fruit, xylitol, erythritol); small amounts of honey or maple syrup only.',
      'No alcohol, gums, emulsifiers, or processed additives.',
      'Allowed: meat, poultry, fish and seafood, organ meats, non-nightshade vegetables, sweet potato, cassava, plantain, fruit in moderation, coconut, olive and avocado oil, leaf-based herbs, bone broth.'
    ]
  },
  {
    name: 'Baseline',
    icon: '🥗',
    description: 'Whole food eating — clean, unprocessed foods',
    rules: [
      'Whole, single-ingredient foods only — no ultra-processed or packaged convenience foods.',
      'No refined sugar, refined flour, or artificial sweeteners, colors, or preservatives.',
      'No industrial seed oils (canola, soybean, sunflower, corn); use olive, avocado, coconut oil, butter, ghee, or tallow.',
      'Emphasize quality protein, abundant vegetables, whole-food fats, and fruit.'
    ]
  },
  {
    name: 'Candida',
    icon: '🍄',
    description: 'Eliminates sugar and yeast to reduce candida overgrowth',
    rules: [
      'No sugar or caloric sweeteners of any kind (including honey, maple syrup, coconut sugar, agave, molasses, dates); stevia or monk fruit only.',
      'No fruit except lemon, lime, and small portions of berries; no dried fruit or juice.',
      'No yeast or yeast-fermented foods: bread, nutritional or brewer\'s yeast, alcohol, vinegars other than apple cider vinegar.',
      'No mushrooms, peanuts, aged cheeses, or other mold-prone foods.',
      'No gluten grains; limit starchy vegetables and gluten-free grains to small portions.',
      'Emphasize non-starchy vegetables, quality protein, healthy fats, garlic, ginger, and coconut oil.'
    ]
  },
  {
    name: 'Carnivore',
    icon: '🥩',
    description: 'Animal products only — meat, fish, eggs, some dairy',
    rules: [
      'Animal foods only: meat, poultry, fish, seafood, organ meats, eggs, and animal fats (tallow, lard, butter, ghee).',
      'Dairy limited to butter, ghee, heavy cream, and hard cheese in moderation.',
      'No plant foods: no vegetables, fruit, grains, legumes, nuts, seeds, or plant oils.',
      'Seasoning with salt only (no herbs, spices, or sauces).',
      'Water and bone broth as beverages.'
    ]
  },
  {
    name: 'Elemental',
    icon: '💧',
    description: 'Pre-digested nutrients — easiest on the gut',
    rules: [
      'Nutrition comes from a pre-digested elemental formula (free amino acids, simple carbohydrates, and fats) instead of whole food.',
      'No solid whole-food recipes.',
      'Each "meal" is a formula serving: give mixing, temperature, and permitted flavoring instructions.',
      'Only clear, gentle additions if the provider has explicitly permitted them.'
    ],
    note: 'Elemental is a provider-supervised, formula-based phase. Build each meal as a formula serving (with preparation steps) rather than a cooked recipe, and remind the client to follow their provider\'s formula brand and dosing.'
  },
  {
    name: 'GAPS',
    icon: '🌿',
    description: 'Gut and Psychology Syndrome — gut-healing whole foods',
    rules: [
      'No grains or pseudo-grains of any kind, and no flours made from them.',
      'No starchy vegetables or starches: white potato, sweet potato, yam, parsnip, cassava/tapioca, plantain, arrowroot.',
      'No sugar or sweeteners except small amounts of raw honey; no maple syrup.',
      'No soy, and no legumes except properly soaked navy beans, lentils, and split peas.',
      'No commercial dairy except butter and ghee; homemade fermented yogurt or kefir only if tolerated.',
      'No processed foods, starch thickeners, or additives.',
      'Emphasize homemade meat stock or bone broth, animal fats, well-cooked non-starchy vegetables, and fermented vegetables.'
    ]
  },
  {
    name: 'Halal',
    icon: '☪️',
    description: 'Islamically permissible foods — no pork, no alcohol',
    rules: [
      'No pork or pork-derived ingredients (lard, pork gelatin, bacon, ham).',
      'No alcohol in any form, including cooking wine, wine-based sauces, and alcohol-based extracts (use alcohol-free vanilla).',
      'All meat and poultry must be halal-certified (zabiha) — label it as such in ingredient lists.',
      'No blood or blood products; no carnivorous animals or birds of prey.',
      'Gelatin only if halal-certified or from fish.'
    ]
  },
  {
    name: 'Keto',
    icon: '🥑',
    description: 'High fat, very low carb — under 20–50g net carbs/day',
    rules: [
      'Keep total net carbs between 20–50g per day (target the low end unless instructed otherwise).',
      'No grains, sugar, sweet fruit, legumes, or starchy vegetables (potatoes, sweet potatoes, corn, peas, plantain).',
      'Fruit limited to small portions of berries, lemon, lime, avocado, olives, and coconut.',
      'High fat (roughly 70% of calories), moderate protein, very low carbohydrate.',
      'Sweeteners only stevia, monk fruit, or erythritol.'
    ]
  },
  {
    name: 'Kosher',
    icon: '✡️',
    description: 'Jewish dietary laws — specific food and prep rules',
    rules: [
      'No pork or pork derivatives, and no rabbit.',
      'Fish only if it has fins and scales — no shellfish or crustaceans (shrimp, crab, lobster, scallops, oysters, mussels, clams).',
      'Never combine meat or poultry with dairy in the same meal or recipe (no butter or cream with meat).',
      'Fish is not combined with meat in the same dish.',
      'Meat and poultry must be kosher-certified (beef, lamb, bison, chicken, turkey, duck); no blood.',
      'Eggs, fish, fruit, vegetables, grains, and legumes are pareve and may be paired with either meat or dairy.'
    ]
  },
  {
    name: "Lion's Diet",
    icon: '🦁',
    description: 'Beef, salt, and water only — elimination baseline',
    rules: [
      'Beef only (any cut, including ground beef and beef organ meats), cooked in beef tallow or its own fat.',
      'Salt is the only seasoning.',
      'Water is the only beverage.',
      'No other foods: no other meats, poultry, fish, eggs, dairy, butter, plants, oils, herbs, or spices.'
    ],
    note: "Lion's Diet meals are intentionally repetitive. Vary the beef cut and cooking method across meals rather than adding ingredients."
  },
  {
    name: 'Low-FODMAP',
    icon: '🫙',
    description: 'Reduces fermentable carbs that trigger gut symptoms',
    rules: [
      'No garlic or onion (including powders, shallots, and the white parts of leeks); garlic-infused oil and the green tops of scallions or leeks are allowed.',
      'No wheat, rye, or barley.',
      'No legumes, except small portions of canned, rinsed lentils or chickpeas (¼ cup).',
      'No lactose: no milk, soft cheese, or regular yogurt; lactose-free dairy, butter, and hard cheese are allowed.',
      'No high-FODMAP fruit: apples, pears, mango, watermelon, cherries, peaches, plums, nectarines, apricots, dried fruit; one serving of low-FODMAP fruit per meal.',
      'No honey, agave, sugar alcohols, or inulin/chicory.',
      'No cauliflower, mushrooms, asparagus, artichoke, cashews, or pistachios.',
      'Respect Monash serving sizes for moderate foods (e.g., avocado, sweet potato, almonds).'
    ]
  },
  {
    name: 'Low-Glycemic',
    icon: '📊',
    description: 'Stabilizes blood sugar — avoids high-GI foods',
    rules: [
      'No refined sugar, juice, white bread, white rice, rice cakes, or refined flours.',
      'No white potatoes; limit sweet potato and winter squash to small portions.',
      'Limit high-GI fruits (watermelon, pineapple, ripe banana, dried fruit, dates); favor berries, cherries, apples, pears, and citrus.',
      'Choose intact whole grains and legumes in modest portions.',
      'Pair every carbohydrate with protein, fat, and fiber; prioritize non-starchy vegetables.'
    ]
  },
  {
    name: 'Low-Histamine',
    icon: '🌡️',
    description: 'Reduces histamine load for mast cell and HIT issues',
    rules: [
      'Everything cooked fresh and eaten right away, or frozen immediately after cooking. Never plan refrigerated leftovers.',
      'No aged, cured, smoked, fermented, or pickled foods: aged cheese, yogurt, kefir, sauerkraut, kombucha, vinegar, soy sauce, miso, fish sauce, cured meats, bacon.',
      'No canned, smoked, or leftover fish; no shellfish. Fresh or frozen-at-sea fish only.',
      'No long-simmered bone broth; use short-cooked meat broth instead.',
      'No high-histamine or histamine-releasing foods: tomatoes, spinach, eggplant, avocado, strawberries, citrus, pineapple, papaya, ripe bananas, cocoa/chocolate, walnuts, cashews, peanuts, raw egg whites.',
      'No alcohol, black tea, green tea, or energy drinks.',
      'Emphasize fresh meat and poultry, fresh vegetables, low-histamine fruits (apples, pears, blueberries, mango), rice, quinoa, and fresh herbs.'
    ]
  },
  {
    name: 'Low-Mold',
    icon: '🚫',
    description: 'Eliminates mold-containing and mold-promoting foods',
    rules: [
      'No foods prone to mold or mycotoxins: peanuts, corn, pistachios, cashews, dried fruit, aged cheese, mushrooms.',
      'No fermented foods, vinegars, alcohol, or yeast.',
      'No coffee unless the client uses a mold-tested brand.',
      'No sugar or sweeteners that feed fungal growth; minimal fruit (low-sugar options only).',
      'No grains stored long-term (wheat, barley, rye, corn); limit others.',
      'Use fresh produce washed well, cooked fresh, with no leftovers older than 24 hours.'
    ]
  },
  {
    name: 'Low-Oxalate',
    icon: '🌱',
    description: 'Reduces oxalates — for kidney stones and sensitive gut',
    rules: [
      'No high-oxalate foods: spinach, Swiss chard, beets and beet greens, rhubarb, okra, sweet potato, potato skins.',
      'No almonds, almond flour, almond milk, cashews, peanuts, sesame/tahini, or chia seeds.',
      'No buckwheat, quinoa, amaranth, soy, or navy beans.',
      'No cocoa/chocolate, black tea, turmeric, or large amounts of cinnamon or black pepper.',
      'No raspberries, blackberries, kiwi, figs, or dates.',
      'Emphasize meats, fish, eggs, dairy if tolerated, white rice, cauliflower, cabbage, bok choy, arugula, lettuce, cucumber, mushrooms, apples, bananas, blueberries, melons, and coconut.'
    ]
  },
  {
    name: 'Low-Salicylate',
    icon: '🍃',
    description: 'Reduces salicylate compounds for sensitive individuals',
    rules: [
      'Avoid most fruits: berries, citrus, grapes, cherries, apricots, pineapple, dates, dried fruit; peeled pears and ripe bananas are allowed.',
      'No herbs or spices except salt (no pepper, cinnamon, cumin, curry, paprika, mint, rosemary, thyme, oregano, turmeric, dill).',
      'No tomatoes, peppers, zucchini, cucumber, radishes, olives, or avocado.',
      'No tea, coffee, honey, mint, almonds, or most nuts (cashews are allowed).',
      'No olive oil or coconut oil; use butter or ghee.',
      'Emphasize fresh meat, fish, eggs, plain dairy, white rice, oats, peeled white potato, cabbage, celery, iceberg lettuce, dried beans and lentils, cashews, maple syrup, and salt.'
    ]
  },
  {
    name: 'Low-Sulfur',
    icon: '⚗️',
    description: 'Reduces sulfur-containing foods for CBS/SIBO support',
    rules: [
      'No alliums: garlic, onion, leeks, shallots, chives (including powders).',
      'No cruciferous vegetables: broccoli, cauliflower, Brussels sprouts, cabbage, kale, bok choy, collards, arugula, watercress, mustard greens, radishes, turnips, kohlrabi.',
      'No eggs and no legumes.',
      'No sulfite-containing foods: dried fruit, wine, vinegar, molasses, and processed foods with sulfite preservatives.',
      'Keep animal protein to moderate portions (about 4 oz per meal); limit dairy.',
      'Emphasize low-sulfur vegetables (carrots, zucchini, squash, cucumber, lettuce, celery, sweet potato, beets), rice, and fruit.'
    ]
  },
  {
    name: 'MCAS',
    icon: '🧬',
    description: 'Mast Cell Activation Syndrome — low-trigger foods only',
    rules: [
      'Follow all Low-Histamine rules: cook fresh, no leftovers, no aged/fermented/cured/canned foods.',
      'No histamine-releasing foods: tomatoes, spinach, citrus, strawberries, pineapple, papaya, chocolate/cocoa, shellfish.',
      'No hot peppers or spicy seasonings (cayenne, chili, hot sauce).',
      'No alcohol, sulfites, MSG, artificial colors, flavors, or preservatives.',
      'Keep ingredient lists short and simple; one new food at a time.',
      'Emphasize fresh meat, poultry, freshly caught fish, low-histamine vegetables, rice, and gentle herbs.'
    ]
  },
  {
    name: 'SIBO',
    icon: '🦠',
    description: 'Small intestinal bacterial overgrowth — low-fermentation',
    rules: [
      'Low-fermentation foods only: follow Low-FODMAP rules (no garlic, onion, wheat, legumes, lactose, high-FODMAP fruit, sugar alcohols).',
      'No prebiotic fibers or added fibers (inulin, chicory root).',
      'No fermented or probiotic foods (yogurt, kefir, sauerkraut, kombucha).',
      'No sugar or sweeteners beyond small amounts of maple syrup.',
      'Keep starches modest and well-cooked; vegetables cooked rather than raw.',
      'Space meals 4–5 hours apart to support the migrating motor complex. If a snack is included, keep it small and simple.'
    ]
  },
  {
    name: 'WFPB',
    icon: '🌾',
    description: 'Whole Food Plant-Based — plants only, no processed food',
    rules: [
      'Plants only: no meat, poultry, fish, seafood, eggs, dairy, butter, ghee, gelatin, bone broth, or honey.',
      'No processed foods, refined flours, or refined sugars.',
      'No or minimal added oils: sauté with water or vegetable broth; get fats from whole foods (avocado, nuts, seeds, olives).',
      'Protein from legumes, tofu, tempeh, whole grains, nuts, and seeds; include a protein source at every meal.',
      'Emphasize vegetables, fruits, whole grains, legumes, nuts, and seeds.'
    ]
  }
];

// Pairs whose combined allowed-food list is effectively empty (e.g. animal-only vs plants-only).
const INCOMPATIBLE_PROTOCOLS = [
  ['Carnivore', 'WFPB'],
  ["Lion's Diet", 'WFPB']
];

function getProtocol(name) {
  return PROTOCOLS.find(protocol => protocol.name === name) || null;
}

// Returns the incompatible pairs present in a selection, e.g. [['Carnivore', 'WFPB']].
function getIncompatiblePairs(selectedNames) {
  return INCOMPATIBLE_PROTOCOLS.filter(([a, b]) => selectedNames.includes(a) && selectedNames.includes(b));
}
