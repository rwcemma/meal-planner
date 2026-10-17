// RWC Meal Plan Generator — food restriction library
//
// Each category: { icon, name, subgroups, items }
//   - subgroups: null, or an array of { name, items } for subcategorized categories
//   - items:     flat list when there are no subgroups (null otherwise)
//
// Restrictions are stored by food name (state.restrictions[name] = true), so a food
// listed in more than one category (e.g. Corn, Butter, Salt) is restricted everywhere
// it appears once it's checked anywhere.

const FOOD_CATEGORIES = [
  {
    icon: '🥩',
    name: 'Meats',
    subgroups: null,
    items: [
      'Chicken', 'Turkey', 'Duck', 'Beef', 'Lamb', 'Bison', 'Pork', 'Venison', 'Rabbit',
      'Organ meats (liver/heart/kidney)'
    ]
  },
  {
    icon: '🐟',
    name: 'Fish & Seafood',
    subgroups: null,
    items: [
      'Salmon', 'Sardines', 'Cod', 'Tuna', 'Mackerel', 'Halibut', 'Tilapia', 'Shrimp',
      'Scallops', 'Crab', 'Lobster', 'Oysters', 'Mussels', 'Clams', 'Anchovies', 'Herring'
    ]
  },
  {
    icon: '🥚',
    name: 'Eggs & Dairy',
    subgroups: null,
    items: [
      'Eggs (whole)', 'Egg yolks', 'Egg whites', "Cow's milk", "Goat's milk",
      "Sheep's milk", "Camel's milk", 'Butter', 'Ghee', 'Heavy cream', 'Cream cheese',
      'Hard cheese', 'Soft cheese', 'Yogurt (dairy)', 'Kefir'
    ]
  },
  {
    icon: '🥦',
    name: 'Vegetables',
    subgroups: [
      {
        name: 'Leafy Greens',
        items: [
          'Kale', 'Spinach', 'Arugula', 'Lettuce (all)', 'Swiss chard', 'Bok choy',
          'Collard greens', 'Mustard greens', 'Watercress', 'Napa cabbage'
        ]
      },
      {
        name: 'Cruciferous',
        items: ['Broccoli', 'Cauliflower', 'Brussels sprouts', 'Cabbage', 'Broccolini', 'Kohlrabi']
      },
      {
        name: 'Root Vegetables',
        items: [
          'Carrots', 'Beets', 'Parsnips', 'Sweet potato', 'White potato', 'Yam', 'Turnips',
          'Radishes', 'Daikon radish', 'Rutabaga', 'Jicama'
        ]
      },
      {
        name: 'Nightshades',
        items: ['Tomatoes', 'Bell peppers', 'Hot peppers', 'Eggplant']
      },
      {
        name: 'Alliums',
        items: ['Onion', 'Garlic', 'Leeks', 'Shallots', 'Chives']
      },
      {
        name: 'Cucurbits',
        items: ['Zucchini', 'Cucumber', 'Pumpkin/squash', 'Okra']
      },
      {
        name: 'Other Vegetables',
        items: [
          'Asparagus', 'Artichoke', 'Celery', 'Fennel', 'Mushrooms', 'Avocado', 'Olives',
          'Peas', 'Green beans', 'Corn'
        ]
      },
      {
        name: 'Sea Vegetables',
        items: ['Nori', 'Kelp', 'Dulse', 'Wakame']
      }
    ],
    items: null
  },
  {
    icon: '🍓',
    name: 'Fruits',
    subgroups: null,
    items: [
      'Apples', 'Bananas', 'Blueberries', 'Strawberries', 'Raspberries', 'Blackberries',
      'Cherries', 'Grapes', 'Oranges', 'Lemons', 'Limes', 'Grapefruit', 'Peaches', 'Plums',
      'Nectarines', 'Apricots', 'Pears', 'Mango', 'Pineapple', 'Papaya', 'Kiwi',
      'Pomegranate', 'Coconut', 'Watermelon', 'Cantaloupe', 'Honeydew', 'Dates', 'Figs',
      'Cranberries', 'Tangerines/Mandarins', 'Persimmons', 'Guava', 'Passion fruit',
      'Dragon fruit', 'Lychee', 'Dried fruits (all)'
    ]
  },
  {
    icon: '🌾',
    name: 'Grains & Starches',
    subgroups: [
      {
        name: 'Gluten-Free Grains',
        items: [
          'White rice', 'Brown rice', 'Wild rice', 'Jasmine/Basmati rice', 'Quinoa', 'Oats',
          'Corn', 'Buckwheat', 'Millet', 'Amaranth', 'Sorghum', 'Rice noodles',
          'Buckwheat noodles', 'Cornmeal/Polenta'
        ]
      },
      {
        name: 'Gluten-Containing Grains',
        items: [
          'Wheat/Gluten', 'Farro', 'Barley', 'Rye', 'Spelt', 'Bread (all)', 'Pasta (wheat)',
          'Tortillas (wheat)'
        ]
      },
      {
        name: 'Starches',
        items: ['Cassava/Tapioca', 'Plantain', 'White potato', 'Sweet potato', 'Plantain chips/flour']
      }
    ],
    items: null
  },
  {
    icon: '🫘',
    name: 'Legumes',
    subgroups: null,
    items: [
      'Black beans', 'Kidney beans', 'Pinto beans', 'Navy beans', 'Cannellini/White beans',
      'Great northern beans', 'Lima/Butter beans', 'Chickpeas/Garbanzo', 'Lentils (all)',
      'Black-eyed peas', 'Split peas', 'Edamame', 'Soy (all forms)', 'Tofu', 'Tempeh',
      'Miso', 'Peanuts', 'Hummus', 'Pea protein'
    ]
  },
  {
    icon: '🥜',
    name: 'Nuts & Seeds',
    subgroups: null,
    items: [
      'Almonds', 'Cashews', 'Walnuts', 'Pecans', 'Macadamia nuts', 'Pistachios',
      'Brazil nuts', 'Hazelnuts', 'Pine nuts', 'Sunflower seeds', 'Pumpkin seeds',
      'Flax seeds', 'Chia seeds', 'Hemp seeds', 'Sesame seeds/Tahini', 'Nut butters (all)'
    ]
  },
  {
    icon: '🫒',
    name: 'Oils & Fats',
    subgroups: null,
    items: [
      'Olive oil', 'Coconut oil', 'Avocado oil', 'Butter', 'Ghee', 'Beef tallow/Lard',
      'MCT oil', 'Seed oils (canola/soy/sunflower)', 'Sesame oil', 'Palm oil'
    ]
  },
  {
    icon: '🥫',
    name: 'Condiments & Sauces',
    subgroups: null,
    items: [
      'Salt', 'Apple cider vinegar', 'Balsamic vinegar', 'Red wine vinegar',
      'White wine vinegar', 'Rice vinegar', 'Coconut aminos', 'Soy sauce/Tamari',
      'Fish sauce', 'Lemon/Lime juice', 'Mustard (all)', 'Ketchup', 'Mayonnaise/Aioli',
      'BBQ sauce', 'Salsa/Pico de gallo', 'Marinara/Tomato sauce', 'Pesto',
      'Horseradish', 'Worcestershire sauce', 'Hot sauce', 'Buffalo sauce',
      'Teriyaki sauce', 'Oyster sauce', 'Chili oil'
    ]
  },
  {
    icon: '🌿',
    name: 'Herbs & Spices',
    subgroups: null,
    items: [
      'Salt', 'Black pepper', 'Nightshade spices (paprika/cayenne)',
      'Seed-based spices (cumin/coriander/mustard seed)',
      'Fresh herbs (parsley/basil/cilantro/rosemary/thyme)',
      'Garlic powder', 'Onion powder', 'Turmeric', 'Ginger', 'Cinnamon',
      'Cloves', 'Cardamom', 'Bay leaf', 'Dill', 'Mint', 'Oregano', 'Sage', 'Tarragon'
    ]
  },
  {
    icon: '🧁',
    name: 'Baking',
    subgroups: null,
    items: [
      'Almond flour', 'Coconut flour', 'Cassava flour', 'Tapioca flour/starch',
      'Arrowroot flour/starch', 'Oat flour', 'Rice flour', 'Buckwheat flour',
      'Chickpea flour', 'Sorghum flour', 'Gluten-free flour blends',
      'Wheat flour', 'Whole wheat flour', 'Spelt flour', 'Rye flour', 'Barley flour',
      'Almond meal', 'Ground flax', 'Chia seeds', 'Psyllium husk',
      'Baking soda', 'Baking powder', 'Cream of tartar',
      'Cocoa/Cacao powder', 'Vanilla extract', 'Almond extract', 'Gelatin', 'Agar agar'
    ]
  },
  {
    icon: '🍯',
    name: 'Sweeteners',
    subgroups: null,
    items: [
      'Honey', 'Maple syrup', 'Coconut sugar', 'Brown sugar', 'Molasses',
      'Dates/Date sugar', 'Agave', 'Stevia', 'Monk fruit', 'Erythritol', 'Xylitol'
    ]
  },
  {
    icon: '☕',
    name: 'Beverages',
    subgroups: null,
    items: [
      'Coffee', 'Black tea', 'Green tea', 'Herbal teas', 'Bone broth',
      'Sparkling water', 'Coconut water', 'Almond milk', 'Coconut milk',
      'Oat milk', 'Cashew milk', 'Kefir (water)'
    ]
  }
];

// All unique food names in a category, whether it's flat or subgrouped.
function getCategoryItems(category) {
  const items = category.subgroups
    ? category.subgroups.flatMap(group => group.items)
    : category.items;
  return [...new Set(items)];
}

// Every unique food name across the whole library (used to validate restrictions).
function getAllFoodNames() {
  return [...new Set(FOOD_CATEGORIES.flatMap(getCategoryItems))];
}

// Also loadable by the Netlify Functions (server-side validation); ignored in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FOOD_CATEGORIES, getCategoryItems, getAllFoodNames };
}
