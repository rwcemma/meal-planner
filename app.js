// RWC Meal Plan Generator — quiz state machine, navigation, screen rendering

/* ==========================================================================
   Mode + state
   ========================================================================== */
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') === 'client' ? 'client' : 'coach';

const STORAGE_KEY = 'rwc-meal-planner-state';

function initialState() {
  return {
    mode,                  // 'coach' | 'client'
    currentScreen: 0,
    clientName: '',
    clientEmail: '',
    age: null,
    weight: null,
    weightUnit: 'lbs',
    protocols: [],         // array of selected protocol names
    mealsPerDay: null,     // 3 | 4 — null until chosen on Screen 4
    cookingSkill: '',      // 'Beginner' | 'Intermediate' | 'Advanced'
    cookingTime: '',       // 'Quick' | 'Standard' | 'Leisurely' | 'Mixed'
    macroMode: null,       // 'none' | 'targets' — optional daily macro targets (macros.js)
    sex: '',               // 'female' | 'male' — only used for the calorie formula
    heightFt: null,
    heightIn: null,
    heightCm: null,
    activity: 'light',
    macroGoal: 'maintain',
    macroStyle: 'balanced',
    macroStyleTouched: false,
    customMacros: null,    // { protein, fat, carbs } grams when macroStyle is 'custom'
    lastPresetTargets: null,
    editingTargets: false, // true when opened from the results screen to adjust targets
    restrictions: {},      // { 'Chicken': true, 'Salmon': true, ... }
    baseServings: null,    // 1 | 2 | 4 — chosen on Screen 8, what recipes are written for
    servings: null,        // current serving count, adjustable 1–8 on Screen 10
    planData: null,        // assembled after generation
    generationError: null,
    planDelivered: false,  // set once the plan is emailed or downloaded
    groceryChecked: {}     // { 'Proteins::0': true } — shopping checkboxes on Screen 10
  };
}

let state = initialState();

/* ==========================================================================
   Copy (coach vs client framing)
   ========================================================================== */
const COPY = {
  coach: {
    heroSub: "Answer a few quick questions and we'll generate a complete 7-day meal plan tailored to your client's exact protocol.",
    infoHeadline: 'Who are we building this for?',
    emailLabel: "Client's email — we'll send the plan here",
    basicHeadline: name => `A bit about ${name}`,
    skillSub: 'This shapes how complex the recipes will be.',
    restrictSub: name => `Check anything ${name} can't eat — even if it's normally allowed on their protocol. Leave everything unchecked if none.`,
    genHeadline: name => `Building <span class="accent">${name}'s</span> meal plan…`,
    deliveryHeadline: name => `Ready! Let's get this to <span class="accent">${name}.</span>`
  },
  client: {
    heroSub: "Answer a few quick questions and we'll build a 7-day meal plan designed around your unique health needs.",
    infoHeadline: 'Tell us about yourself',
    emailLabel: "Your email — we'll send your plan here",
    basicHeadline: name => `A bit about you, ${name}`,
    skillSub: "We'll match recipes to your comfort in the kitchen.",
    restrictSub: () => "Check anything you can't eat — even if it's normally allowed on your protocol. Leave everything unchecked if none.",
    genHeadline: name => `Building <span class="accent">${name}'s</span> meal plan…`,
    deliveryHeadline: name => `Ready! Your plan is here, <span class="accent">${name}.</span>`
  }
};

const copy = () => COPY[state.mode];

/* ==========================================================================
   Option definitions (Screens 4, 5, 6, 8)
   ========================================================================== */
const MEAL_OPTIONS = [
  { value: 3, icon: '🍳', title: '3 Meals', desc: 'Breakfast, Lunch & Dinner' },
  { value: 4, icon: '🍎', title: '3 Meals + Snack', desc: 'Breakfast, Lunch, Dinner & a daily snack' }
];

const SKILL_OPTIONS = [
  { value: 'Beginner', icon: '🥚', title: 'Beginner', desc: 'Simple recipes, 5 ingredients or fewer, no special techniques' },
  { value: 'Intermediate', icon: '🍳', title: 'Intermediate', desc: 'Comfortable with basic techniques, moderate variety' },
  { value: 'Advanced', icon: '👨‍🍳', title: 'Advanced', desc: 'Confident cook, open to complex flavors and multi-step recipes' }
];

const TIME_OPTIONS = [
  { value: 'Quick', icon: '⚡', title: 'Quick', desc: 'Under 30 minutes — fast and simple' },
  { value: 'Standard', icon: '🕐', title: 'Standard', desc: '30–60 minutes — relaxed weeknight cooking' },
  { value: 'Leisurely', icon: '🍲', title: 'Leisurely', desc: '60+ minutes — I enjoy spending time in the kitchen' },
  { value: 'Mixed', icon: '🗓️', title: 'Mix it up', desc: 'Quick on weeknights (Mon–Fri), in-depth recipes on the weekend' }
];

const timeLabel = value => (value === 'Mixed' ? 'Quick weekdays · in-depth weekends' : value);

const SERVING_OPTIONS = [
  { value: 1, icon: '👤', title: 'Just me', desc: '1 serving per meal' },
  { value: 2, icon: '👥', title: '2 people', desc: 'Recipes scaled for 2' },
  { value: 4, icon: '👨‍👩‍👧', title: 'Family of 3–4', desc: 'Recipes scaled for a small family' }
];

/* ==========================================================================
   Helpers
   ========================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const name = () => esc(state.clientName || 'your client');

const isValidEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
const isValidAge = age => Number.isInteger(age) && age >= 1 && age <= 110;
const isValidWeight = weight => typeof weight === 'number' && weight > 0 && weight <= 1500;

const restrictedFoods = () => Object.keys(state.restrictions).filter(food => state.restrictions[food]);

function optionCard({ value, icon, title, desc }, selected, large = false) {
  return `
    <div class="option-card${large ? ' option-card--lg' : ''}${selected ? ' is-selected' : ''}"
         role="button" tabindex="0" aria-pressed="${selected}" data-value="${esc(value)}">
      <span class="option-card__icon" aria-hidden="true">${icon}</span>
      <span class="option-card__body">
        <span class="option-card__title">${esc(title)}</span>
        <span class="option-card__desc">${esc(desc)}</span>
      </span>
    </div>`;
}

function continueButton(label = 'Continue →') {
  return `<button type="button" class="btn btn--primary btn--lg" data-action="continue">${label}</button>`;
}

// Enable/disable the screen's Continue button based on the screen's validation.
function refreshContinue(el) {
  const btn = $('[data-action="continue"]', el);
  if (btn) btn.disabled = !SCREENS[state.currentScreen].isValid();
}

// Shared wiring for single-select card screens.
function bindSingleSelect(el, key, parse = v => v) {
  $$('.option-card', el).forEach(card => {
    card.addEventListener('click', () => {
      state[key] = parse(card.dataset.value);
      $$('.option-card', el).forEach(c => {
        const selected = c === card;
        c.classList.toggle('is-selected', selected);
        c.setAttribute('aria-pressed', selected);
      });
      if (key === 'baseServings') state.servings = state.baseServings;
      refreshContinue(el);
      saveState();
    });
  });
}

function singleSelectScreen({ headline, subhead, options, selected, gridClass }) {
  return `
    <div class="screen__inner">
      <h2 class="screen-headline" tabindex="-1">${headline}</h2>
      ${subhead ? `<p class="screen-subhead">${subhead}</p>` : ''}
      <div class="card-grid ${gridClass}" role="group" aria-label="${esc(headline)}">
        ${options.map(opt => optionCard(opt, opt.value === selected, true)).join('')}
      </div>
      <div class="screen-actions">${continueButton()}</div>
    </div>`;
}

function protocolLabel() {
  const p = state.protocols;
  if (p.length <= 2) return p.join(' + ');
  return `${p.slice(0, 2).join(' + ')} + ${p.length - 2} more`;
}

/* ==========================================================================
   Screens
   Each screen: { title, render(), bind(el)?, onEnter(el)?, isValid() }
   ========================================================================== */
const SCREENS = [
  /* ── LANDING ───────────────────────────────────────────────────────── */
  {
    id: 'landing',
    title: '',
    render: () => `
      <div class="hero">
        <div class="hero__content">
          <img src="assets/rwc-logo-white.png" alt="Redefining Wellness Centers" class="hero__logo" width="200" height="72" />
          <p class="eyebrow hero__eyebrow">Redefining Wellness Center</p>
          <h1 class="hero__title" tabindex="-1">Your personalized meal plan <span class="accent">starts here.</span></h1>
          <p class="hero__sub">${copy().heroSub}</p>
          <button type="button" class="btn btn--primary btn--lg" data-action="continue">Get Started →</button>
          <p class="hero__note">Takes about 2 minutes</p>
        </div>
      </div>`,
    isValid: () => true
  },

  /* ── CLIENT INFO ─────────────────────────────────────────────────────── */
  {
    id: 'info',
    title: 'Client Info',
    render: () => `
      <div class="screen__inner screen__inner--narrow">
        <h2 class="screen-headline" tabindex="-1">${copy().infoHeadline}</h2>
        <form class="form-stack" novalidate>
          <div class="field">
            <label class="field__label" for="clientName">First name</label>
            <input class="input input--lg" id="clientName" name="clientName" type="text"
                   placeholder="First name" autocomplete="given-name" maxlength="40"
                   value="${esc(state.clientName)}" required />
          </div>
          <div class="field">
            <label class="field__label" for="clientEmail">${copy().emailLabel}</label>
            <input class="input input--lg" id="clientEmail" name="clientEmail" type="email"
                   placeholder="Email address" autocomplete="email" inputmode="email"
                   value="${esc(state.clientEmail)}" aria-describedby="emailError" required />
            <p class="field__error" id="emailError" aria-live="polite"></p>
            ${state.mode === 'client'
              ? '<p class="field__hint">We\'ll email your plan here and may follow up with helpful resources from Redefining Wellness Center. Unsubscribe anytime.</p>'
              : ''}
          </div>
          <div class="screen-actions">
            <button type="submit" class="btn btn--primary btn--lg" data-action="continue">Continue →</button>
          </div>
        </form>
      </div>`,
    bind(el) {
      const nameInput = $('#clientName', el);
      const emailInput = $('#clientEmail', el);
      const emailError = $('#emailError', el);

      const showEmailError = () => {
        const bad = emailInput.value.trim() !== '' && !isValidEmail(emailInput.value);
        emailInput.setAttribute('aria-invalid', bad);
        emailError.textContent = bad ? 'Please enter a valid email address.' : '';
      };

      nameInput.addEventListener('input', () => {
        state.clientName = nameInput.value.trim();
        refreshContinue(el);
        saveState();
      });
      emailInput.addEventListener('input', () => {
        state.clientEmail = emailInput.value.trim();
        if (emailInput.getAttribute('aria-invalid') === 'true') showEmailError();
        refreshContinue(el);
        saveState();
      });
      emailInput.addEventListener('blur', showEmailError);

      $('form', el).addEventListener('submit', event => {
        event.preventDefault();
        showEmailError();
        if (SCREENS[state.currentScreen].isValid()) goToScreen(state.currentScreen + 1);
      });
    },
    isValid: () => state.clientName.length > 0 && isValidEmail(state.clientEmail)
  },

  /* ── BASIC INFO ──────────────────────────────────────────────────────── */
  {
    id: 'basic',
    title: 'Basic Info',
    render: () => `
      <div class="screen__inner">
        <h2 class="screen-headline" tabindex="-1">${copy().basicHeadline(name())}</h2>
        <form class="field-row" novalidate>
          <div class="field">
            <label class="field__label" for="age">Age</label>
            <input class="input input--lg" id="age" type="number" inputmode="numeric"
                   min="1" max="110" step="1" placeholder="Age" value="${state.age ?? ''}"
                   aria-describedby="ageError" required />
            <p class="field__error" id="ageError" aria-live="polite"></p>
          </div>
          <div class="field">
            <label class="field__label" for="weight">Weight</label>
            <div class="input-with-toggle">
              <input class="input input--lg" id="weight" type="number" inputmode="decimal"
                     min="1" step="0.1" placeholder="Weight" value="${state.weight ?? ''}"
                     aria-describedby="weightError" required />
              <div class="unit-toggle" role="group" aria-label="Weight unit">
                <button type="button" class="unit-toggle__btn" data-unit="lbs" aria-pressed="${state.weightUnit === 'lbs'}">lbs</button>
                <button type="button" class="unit-toggle__btn" data-unit="kg" aria-pressed="${state.weightUnit === 'kg'}">kg</button>
              </div>
            </div>
            <p class="field__error" id="weightError" aria-live="polite"></p>
          </div>
          <button type="submit" hidden></button>
        </form>
        <div class="screen-actions">${continueButton()}</div>
      </div>`,
    bind(el) {
      const ageInput = $('#age', el);
      const weightInput = $('#weight', el);

      const validateField = (input, errorEl, valid, message) => {
        const bad = input.value !== '' && !valid;
        input.setAttribute('aria-invalid', bad);
        $(errorEl, el).textContent = bad ? message : '';
      };

      ageInput.addEventListener('input', () => {
        const value = Number(ageInput.value);
        state.age = ageInput.value === '' ? null : value;
        validateField(ageInput, '#ageError', isValidAge(state.age), 'Enter an age between 1 and 110.');
        refreshContinue(el);
        saveState();
      });
      weightInput.addEventListener('input', () => {
        const value = Number(weightInput.value);
        state.weight = weightInput.value === '' ? null : value;
        validateField(weightInput, '#weightError', isValidWeight(state.weight), 'Enter a valid weight.');
        refreshContinue(el);
        saveState();
      });

      $$('.unit-toggle__btn', el).forEach(btn => {
        btn.addEventListener('click', () => {
          state.weightUnit = btn.dataset.unit;
          $$('.unit-toggle__btn', el).forEach(b => b.setAttribute('aria-pressed', b === btn));
          saveState();
        });
      });

      $('form', el).addEventListener('submit', event => {
        event.preventDefault();
        if (SCREENS[state.currentScreen].isValid()) goToScreen(state.currentScreen + 1);
      });
    },
    isValid: () => isValidAge(state.age) && isValidWeight(state.weight)
  },

  /* ── DIET PROTOCOLS ──────────────────────────────────────────────────── */
  {
    id: 'protocols',
    title: 'Diet Protocols',
    render: () => `
      <div class="screen__inner">
        <h2 class="screen-headline" tabindex="-1">Which eating protocol(s) has your provider recommended?</h2>
        <p class="screen-subhead">Select all that apply — we'll automatically find foods that work across all selected protocols.</p>
        <div class="card-grid" role="group" aria-label="Diet protocols">
          ${PROTOCOLS.map(p => optionCard(
            { value: p.name, icon: p.icon, title: p.name, desc: p.description },
            state.protocols.includes(p.name)
          )).join('')}
        </div>
        <p class="selection-count" id="protocolCount" aria-live="polite"></p>
        <div class="protocol-warning" id="protocolWarning" aria-live="polite"></div>
        <div class="screen-actions">${continueButton()}</div>
      </div>`,
    bind(el) {
      const refresh = () => {
        const n = state.protocols.length;
        $('#protocolCount', el).innerHTML = n
          ? `<strong>${n}</strong> protocol${n === 1 ? '' : 's'} selected`
          : 'Select at least one protocol to continue';

        const conflicts = getIncompatiblePairs(state.protocols);
        $('#protocolWarning', el).innerHTML = conflicts.length
          ? `<div class="alert alert--error" role="alert">
               <span class="alert__icon" aria-hidden="true">⚠</span>
               <span>${conflicts.map(([a, b]) => `<strong>${esc(a)}</strong> and <strong>${esc(b)}</strong>`).join('; ')}
               have no foods in common. Deselect one to continue.</span>
             </div>`
          : '';
        refreshContinue(el);
      };

      $$('.option-card', el).forEach(card => {
        card.addEventListener('click', () => {
          const value = card.dataset.value;
          const selected = !state.protocols.includes(value);
          state.protocols = selected
            ? PROTOCOLS.map(p => p.name).filter(n => n === value || state.protocols.includes(n)) // keep spec order
            : state.protocols.filter(n => n !== value);
          card.classList.toggle('is-selected', selected);
          card.setAttribute('aria-pressed', selected);
          refresh();
          saveState();
        });
      });
      refresh();
    },
    isValid: () => state.protocols.length > 0 && getIncompatiblePairs(state.protocols).length === 0
  },

  /* ── MACRO TARGETS (optional, macros.js) ───────────────────────────── */
  {
    id: 'macros',
    title: 'Macro Targets',
    render: renderMacroScreen,
    bind: bindMacroScreen,
    isValid: () => macroScreenValid()
  },

  /* ── MEALS PER DAY ─────────────────────────────────────────────────── */
  {
    id: 'meals',
    title: 'Meals Per Day',
    render: () => singleSelectScreen({
      headline: 'How many meals per day?',
      options: MEAL_OPTIONS,
      selected: state.mealsPerDay,
      gridClass: 'card-grid--narrow'
    }),
    bind: el => bindSingleSelect(el, 'mealsPerDay', Number),
    isValid: () => state.mealsPerDay === 3 || state.mealsPerDay === 4
  },

  /* ── COOKING SKILL ───────────────────────────────────────────────────── */
  {
    id: 'skill',
    title: 'Cooking Skill',
    render: () => singleSelectScreen({
      headline: "What's the cooking skill level?",
      subhead: copy().skillSub,
      options: SKILL_OPTIONS,
      selected: state.cookingSkill,
      gridClass: 'card-grid--3'
    }),
    bind: el => bindSingleSelect(el, 'cookingSkill'),
    isValid: () => SKILL_OPTIONS.some(o => o.value === state.cookingSkill)
  },

  /* ── COOKING TIME ────────────────────────────────────────────────────── */
  {
    id: 'time',
    title: 'Cooking Time',
    render: () => singleSelectScreen({
      headline: 'How much time per meal?',
      options: TIME_OPTIONS,
      selected: state.cookingTime,
      gridClass: 'card-grid--narrow'
    }),
    bind: el => bindSingleSelect(el, 'cookingTime'),
    isValid: () => TIME_OPTIONS.some(o => o.value === state.cookingTime)
  },

  /* ── FOOD RESTRICTIONS ───────────────────────────────────────────────── */
  {
    id: 'restrictions',
    title: 'Food Restrictions',
    render: renderRestrictions,
    bind: bindRestrictions,
    isValid: () => true
  },

  /* ── SERVING SIZE ────────────────────────────────────────────────────── */
  {
    id: 'servings',
    title: 'Serving Size',
    render: () => singleSelectScreen({
      headline: 'How many people are we cooking for?',
      subhead: 'You can adjust this per meal after the plan is generated.',
      options: SERVING_OPTIONS,
      selected: state.baseServings,
      gridClass: 'card-grid--3'
    }),
    bind: el => bindSingleSelect(el, 'baseServings', Number),
    isValid: () => [1, 2, 4].includes(state.baseServings)
  },

  /* ── GENERATION ──────────────────────────────────────────────────────── */
  {
    id: 'generate',
    title: 'Building Your Plan',
    render: () => `
      <div class="gen">
        <div class="gen__content">
          <div class="gen__mark" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 40 40" fill="none">
              <path d="M10 24c5-11 15-13 20-13-1 10-8 19-18 19" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
            </svg>
          </div>
          <h2 class="gen__title" tabindex="-1">${copy().genHeadline(name())}</h2>
          <p class="gen__sub">Making it from scratch. This takes about 60 seconds.</p>
          <ol class="gen-steps" aria-label="Generation progress">
            ${generationSteps().map((label, i) => `
              <li class="gen-step" data-step="${i}" data-status="pending">
                <span class="gen-step__dot" aria-hidden="true"></span>
                <span>${esc(label)}</span>
                <span class="sr-only gen-step__status">pending</span>
              </li>`).join('')}
          </ol>
          <div class="gen-error" id="genError" hidden>
            <div class="alert alert--error" role="alert">
              <span class="alert__icon" aria-hidden="true">⚠</span>
              <span id="genErrorMessage"></span>
            </div>
            <button type="button" class="btn btn--primary btn--lg" data-action="retry">Try Again</button>
          </div>
          <p class="gen__note">Don't close this tab</p>
        </div>
      </div>`,
    bind(el) {
      $('[data-action="retry"]', el).addEventListener('click', () => runGeneration(el));
    },
    onEnter: el => runGeneration(el),
    isValid: () => Boolean(state.planData)
  },

  /* ── PREVIEW & DELIVERY ──────────────────────────────────────────────── */
  {
    id: 'results',
    title: 'Your Meal Plan',
    render: renderResults,
    bind: bindResults,
    isValid: () => true
  }
];

/* ==========================================================================
   Screen 7 — restrictions
   ========================================================================== */
let openCategory = null;

function categoryRestrictedCount(category) {
  return getCategoryItems(category).filter(food => state.restrictions[food]).length;
}

function foodChip(food) {
  const restricted = Boolean(state.restrictions[food]);
  return `<button type="button" class="food-chip${restricted ? ' is-restricted' : ''}"
                  aria-pressed="${restricted}" data-food="${esc(food)}">${esc(food)}</button>`;
}

function renderRestrictions() {
  return `
    <div class="screen__inner screen__inner--wide">
      <h2 class="screen-headline" tabindex="-1">Any foods to avoid?</h2>
      <p class="screen-subhead">${esc(copy().restrictSub(state.clientName || 'your client'))}</p>
      <div class="category-grid">
        ${FOOD_CATEGORIES.map((category, i) => {
          const items = getCategoryItems(category);
          const open = openCategory === i;
          return `
            <div class="category-card${open ? ' is-open' : ''}" data-cat="${i}">
              <button type="button" class="category-card__header" aria-expanded="${open}" aria-controls="catPanel${i}">
                <span class="category-card__icon" aria-hidden="true">${category.icon}</span>
                <span class="category-card__text">
                  <span class="category-card__name">${esc(category.name)}</span>
                  <span class="category-card__count">${items.length} items</span>
                </span>
                <span class="restrict-badge" data-badge></span>
                <span class="category-card__chevron" aria-hidden="true">▾</span>
              </button>
              <div class="category-card__panel" id="catPanel${i}" role="region" aria-label="${esc(category.name)} foods" ${open ? '' : 'inert'}>
                <div class="category-card__panel-inner">
                  <div class="select-all">
                    <span class="select-all__label" id="selectAll${i}">Select all in ${esc(category.name)}</span>
                    <button type="button" class="switch" role="switch" aria-checked="false"
                            aria-labelledby="selectAll${i}" data-select-all="${i}">
                      <span class="switch__track" aria-hidden="true"></span>
                    </button>
                  </div>
                  ${category.subgroups
                    ? category.subgroups.map(group => `
                        <div class="subgroup">
                          <h3 class="subgroup__title">${esc(group.name)}</h3>
                          <div class="chip-list">${group.items.map(foodChip).join('')}</div>
                        </div>`).join('')
                    : `<div class="chip-list">${category.items.map(foodChip).join('')}</div>`}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <p class="restriction-summary" id="restrictionSummary" aria-live="polite"></p>
      <div class="screen-actions">
        ${continueButton()}
        <button type="button" class="btn btn--text" data-action="skip">No restrictions → Skip this step</button>
      </div>
    </div>`;
}

// Sync every chip, badge, switch and summary with state.restrictions (no re-render).
function refreshRestrictions(el) {
  $$('.food-chip', el).forEach(chip => {
    const restricted = Boolean(state.restrictions[chip.dataset.food]);
    chip.classList.toggle('is-restricted', restricted);
    chip.setAttribute('aria-pressed', restricted);
  });

  FOOD_CATEGORIES.forEach((category, i) => {
    const card = $(`.category-card[data-cat="${i}"]`, el);
    const count = categoryRestrictedCount(category);
    const total = getCategoryItems(category).length;
    $('[data-badge]', card).textContent = count ? `× ${count} avoided` : '';
    card.classList.toggle('has-restrictions', count > 0);
    $('[data-select-all]', card).setAttribute('aria-checked', count === total);
  });

  const n = restrictedFoods().length;
  $('#restrictionSummary', el).innerHTML = n
    ? `<strong>${n}</strong> food${n === 1 ? '' : 's'} marked to avoid`
    : 'No foods marked to avoid';
  $('[data-action="skip"]', el).hidden = n > 0;
}

function bindRestrictions(el) {
  $$('.category-card__header', el).forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.category-card');
      const index = Number(card.dataset.cat);
      openCategory = openCategory === index ? null : index;

      $$('.category-card', el).forEach(c => {
        const open = Number(c.dataset.cat) === openCategory;
        c.classList.toggle('is-open', open);
        $('.category-card__header', c).setAttribute('aria-expanded', open);
        $('.category-card__panel', c).toggleAttribute('inert', !open);
      });

      if (openCategory !== null) {
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 210);
      }
    });
  });

  el.addEventListener('click', event => {
    const chip = event.target.closest('.food-chip');
    if (chip) {
      const food = chip.dataset.food;
      if (state.restrictions[food]) delete state.restrictions[food];
      else state.restrictions[food] = true;
      refreshRestrictions(el);
      saveState();
      return;
    }

    const toggle = event.target.closest('[data-select-all]');
    if (toggle) {
      const items = getCategoryItems(FOOD_CATEGORIES[Number(toggle.dataset.selectAll)]);
      const selectAll = toggle.getAttribute('aria-checked') !== 'true';
      items.forEach(food => {
        if (selectAll) state.restrictions[food] = true;
        else delete state.restrictions[food];
      });
      refreshRestrictions(el);
      saveState();
    }
  });

  $('[data-action="skip"]', el).addEventListener('click', () => goToScreen(state.currentScreen + 1));
  refreshRestrictions(el);
}

/* ==========================================================================
   Screen 9 — generation
   ========================================================================== */
let generationRun = 0;

function generationSteps() {
  return [
    `Applying ${protocolLabel()} protocol rules`,
    'Filtering personal restrictions',
    'Writing Monday–Thursday recipes',
    'Writing Friday–Sunday recipes',
    'Building weekly grocery list'
  ];
}

// Everything generate.js needs to build the plan.
function getGenerationInput() {
  return {
    clientName: state.clientName,
    age: state.age,
    weight: state.weight,
    weightUnit: state.weightUnit,
    protocols: [...state.protocols],
    restrictions: restrictedFoods(),
    cookingSkill: state.cookingSkill,
    cookingTime: state.cookingTime,
    servings: state.baseServings,
    includeSnack: state.mealsPerDay === 4,
    macroTargets: state.macroMode === 'targets' ? computeMacroTargets() : null
  };
}

function setStepStatus(el, index, status) {
  const step = $(`.gen-step[data-step="${index}"]`, el);
  if (!step) return;
  step.dataset.status = status;
  $('.gen-step__status', step).textContent = status;
}

async function runGeneration(el) {
  const run = ++generationRun;
  state.planData = null;
  state.generationError = null;
  $$('.gen-step', el).forEach((_, i) => setStepStatus(el, i, 'pending'));
  $('#genError', el).hidden = true;
  $('.gen__mark', el).style.animationPlayState = 'running';

  try {
    const input = getGenerationInput();
    const planData = await generateMealPlan(input, (index, status) => {
      if (run === generationRun) setStepStatus(el, index, status);
    });
    if (run !== generationRun || state.currentScreen !== screenIndex('generate')) return;

    planData.macro_targets = input.macroTargets; // what this plan was built to hit
    state.planData = planData;
    state.servings = state.baseServings;
    state.groceryChecked = {};
    activeTab = 0;
    state.planDelivered = false;
    saveState();
    goToScreen(screenIndex('results'));
  } catch (err) {
    if (run !== generationRun || state.currentScreen !== screenIndex('generate')) return;
    console.error(err);
    state.generationError = err.message || 'Something went wrong while building the plan.';
    $$('.gen-step[data-status="active"]', el).forEach(step => setStepStatus(el, Number(step.dataset.step), 'error'));
    $('#genErrorMessage', el).textContent = state.generationError;
    $('#genError', el).hidden = false;
    $('.gen__mark', el).style.animationPlayState = 'paused';
    $('[data-action="retry"]', el).focus();
  }
}

/* ==========================================================================
   Screen 10 — serving scaler
   Recipes are written for state.baseServings; quantities are rescaled client-side
   for state.servings (1–8). Macros are per serving, so they never scale.
   ========================================================================== */
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 8;

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

// One quantity: "1 1/2", "1½", "1/2", "½", "1.5", "2"
const QTY = String.raw`(?:\d+\s+\d+\/\d+|\d*\s?[½¼¾⅓⅔⅛⅜⅝⅞]|\d+\/\d+|\d+(?:\.\d+)?)`;
// Optional range: "2-3", "2 – 3", "2 to 3"
const QTY_RANGE = new RegExp(String.raw`(${QTY})(\s*(?:-|–|to)\s*)?(${QTY})?`);
const LEADING_QTY = new RegExp(String.raw`^(\s*)` + QTY_RANGE.source);

function parseQuantity(text) {
  text = text.trim();
  const unicode = text.match(/^(\d*)\s?([½¼¾⅓⅔⅛⅜⅝⅞])$/);
  if (unicode) return Number(unicode[1] || 0) + UNICODE_FRACTIONS[unicode[2]];
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return parseFloat(text);
}

// Kitchen-friendly output: whole numbers, common fractions, else one decimal
function formatQuantity(value) {
  const whole = Math.floor(value + 1e-9);
  const rest = value - whole;
  const fractions = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'],
    [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'], [1, '']];
  const [nearest, label] = fractions.reduce((best, f) => (Math.abs(f[0] - rest) < Math.abs(best[0] - rest) ? f : best));
  if (Math.abs(nearest - rest) > 0.04) return String(Math.round(value * 10) / 10);
  const wholePart = nearest === 1 ? whole + 1 : whole;
  if (!label) return String(wholePart);
  return wholePart ? `${wholePart} ${label}` : label;
}

function scaleMatch(match, factor) {
  const [, lead = '', first, separator, second] = match;
  let out = lead + formatQuantity(parseQuantity(first) * factor);
  if (separator && second) out += separator + formatQuantity(parseQuantity(second) * factor);
  return out;
}

// "1 1/2 lbs ground beef" ×2 → "3 lbs ground beef". No leading number → unchanged.
function scaleIngredient(ingredient, factor) {
  if (factor === 1) return ingredient;
  const match = ingredient.match(LEADING_QTY);
  if (!match || !/\d|[½¼¾⅓⅔⅛⅜⅝⅞]/.test(match[0])) return ingredient;
  return scaleMatch(match, factor) + ingredient.slice(match[0].length);
}

// Grocery lines look like "Wild-caught salmon — 2 lbs for the week": scale the first
// quantity after the dash, or a leading quantity, else leave the line unchanged.
function scaleGroceryItem(item, factor) {
  if (factor === 1) return item;
  const dash = item.match(/\s[—–-]\s/);
  if (dash) {
    const head = item.slice(0, dash.index + dash[0].length);
    const tail = item.slice(dash.index + dash[0].length);
    const match = tail.match(QTY_RANGE);
    if (match && match.index === tail.search(/\d|[½¼¾⅓⅔⅛⅜⅝⅞]/)) {
      const scaled = scaleMatch([match[0], '', match[1], match[2], match[3]], factor);
      return head + tail.slice(0, match.index) + scaled + tail.slice(match.index + match[0].length);
    }
    return item;
  }
  return scaleIngredient(item, factor);
}

const servingFactor = () => (state.servings || state.baseServings || 1) / (state.baseServings || 1);

/* ==========================================================================
   Screen 10 — preview & delivery
   ========================================================================== */
const DAY_TABS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
const SKILL_DOTS = { Beginner: 1, Intermediate: 2, Advanced: 3 };

let activeTab = 0; // 0–6 = Monday–Sunday, 'grocery' = grocery list

const hasPlan = () => Array.isArray(state.planData?.days) && state.planData.days.length === 7;

function skillIndicator() {
  const level = SKILL_DOTS[state.cookingSkill] || 1;
  const dots = '●'.repeat(level) + '○'.repeat(3 - level);
  return `<span class="pill pill--teal"><span aria-hidden="true">${dots}</span> ${esc(state.cookingSkill)}</span>`;
}

function renderMeal(slot, meal, factor) {
  return `
    <article class="meal-card">
      <div class="meal-card__label">${MEAL_LABELS[slot] || esc(slot)}</div>
      <h3 class="meal-card__name">${esc(meal.name)}</h3>
      <div class="meta-row">
        <span class="pill">⏱ Prep ${esc(meal.prep_time)}</span>
        <span class="pill">🔥 Cook ${esc(meal.cook_time)}</span>
        <span class="pill">🍽 Serves ${state.servings}</span>
        ${skillIndicator()}
      </div>
      <h4 class="section-title">Ingredients</h4>
      <ul class="ingredient-list">
        ${meal.ingredients.map(item => `<li>${esc(scaleIngredient(item, factor))}</li>`).join('')}
      </ul>
      <h4 class="section-title">Instructions</h4>
      <ol class="instruction-list">
        ${meal.instructions.map(step => `<li>${esc(step)}</li>`).join('')}
      </ol>
      <div class="macro-row" aria-label="Macros per serving">
        <span class="macro-pill">P <b>${meal.protein_g}g</b></span>
        <span class="macro-pill">F <b>${meal.fat_g}g</b></span>
        <span class="macro-pill">C <b>${meal.carbs_g}g</b></span>
        <span class="macro-pill"><b>${meal.calories}</b> cal</span>
        <span class="macro-row__note">per serving</span>
      </div>
    </article>`;
}

// "✓" when a day's total is within ±10% of its target, otherwise the gap ("+18g", "−120")
function targetDelta(actual, target, unit = 'g') {
  if (!target) return '';
  const diff = actual - target;
  if (Math.abs(diff) <= target * 0.1) return '<span class="target-delta target-delta--ok" title="Within 10% of target">✓</span>';
  const sign = diff > 0 ? '+' : '−';
  return `<span class="target-delta" title="Target ${target.toLocaleString('en-US')}${unit}">${sign}${Math.abs(Math.round(diff)).toLocaleString('en-US')}${unit}</span>`;
}

function renderDay(day) {
  const factor = servingFactor();
  const t = state.planData.macro_targets;
  return `
    <h3 class="sr-only">${esc(day.day)}</h3>
    ${Object.entries(day.meals).map(([slot, meal]) => renderMeal(slot, meal, factor)).join('')}
    <div class="daily-totals">
      <span class="daily-totals__label">Daily totals</span>
      <span>P ${day.daily_protein_g}g ${targetDelta(day.daily_protein_g, t?.protein_g)}</span>
      <span>F ${day.daily_fat_g}g ${targetDelta(day.daily_fat_g, t?.fat_g)}</span>
      <span>C ${day.daily_carbs_g}g ${targetDelta(day.daily_carbs_g, t?.carbs_g)}</span>
      <span>${day.daily_calories.toLocaleString()} cal ${targetDelta(day.daily_calories, t?.calories, '')}</span>
      <span class="daily-totals__note">per person${t ? ' · ✓ = within 10% of target' : ''}</span>
    </div>`;
}

// Daily macro targets at the top of the preview, with a way to set or change them
function renderMacroBar() {
  const t = state.planData.macro_targets;
  if (!t) {
    return `
      <div class="macro-bar macro-bar--empty">
        <span>Tracking macros?</span>
        <button type="button" class="btn btn--text" data-action="adjust-macros">🎯 Set daily macro targets</button>
      </div>`;
  }
  return `
    <div class="macro-bar">
      <div class="macro-bar__targets">
        <span class="eyebrow">Daily targets</span>
        <span class="macro-bar__values">
          <b>${t.calories.toLocaleString('en-US')}</b> cal · P <b>${t.protein_g}g</b> · F <b>${t.fat_g}g</b> · C <b>${t.carbs_g}g</b>
        </span>
        <span class="macro-bar__meta">per person · ${esc(t.goal)} · ${esc(t.style)}</span>
      </div>
      <button type="button" class="btn btn--ghost macro-bar__adjust" data-action="adjust-macros">Adjust targets</button>
    </div>`;
}

function renderGrocery() {
  const factor = servingFactor();
  const checked = state.groceryChecked || {};
  const categories = Object.entries(state.planData.grocery_list || {}).filter(([, items]) => items.length);
  return `
    <h3 class="sr-only">Weekly grocery list</h3>
    <p class="grocery-intro">Quantities for ${state.servings} serving${state.servings === 1 ? '' : 's'} per meal. Tap items to check them off while you shop.</p>
    <div class="grocery-grid">
      ${categories.map(([category, items]) => `
        <div class="grocery-cat">
          <h4 class="grocery-cat__title">${esc(category)}</h4>
          ${items.map((item, i) => {
            const key = `${category}::${i}`;
            return `
              <label class="grocery-item">
                <input type="checkbox" data-grocery="${esc(key)}" ${checked[key] ? 'checked' : ''} />
                <span>${esc(scaleGroceryItem(item, factor))}</span>
              </label>`;
          }).join('')}
        </div>`).join('')}
    </div>`;
}

function renderPlanPanel() {
  if (!hasPlan()) {
    return statusAlert('error', 'This plan has no recipes to show. Use “Build another plan” to generate a new one.');
  }
  return activeTab === 'grocery' ? renderGrocery() : renderDay(state.planData.days[activeTab]);
}

function renderPreview() {
  if (!hasPlan()) return renderPlanPanel();
  const restrictions = restrictedFoods();
  return `
    ${renderMacroBar()}

    <div class="preview-toolbar">
      <div class="servings-control" role="group" aria-label="Servings per meal">
        <span id="servingsLabel">Servings:</span>
        <button type="button" class="stepper-btn" data-servings="-1" aria-label="Fewer servings"
                ${state.servings <= MIN_SERVINGS ? 'disabled' : ''}>−</button>
        <span class="servings-control__value" id="servingsValue" aria-live="polite" aria-labelledby="servingsLabel">${state.servings}</span>
        <button type="button" class="stepper-btn" data-servings="1" aria-label="More servings"
                ${state.servings >= MAX_SERVINGS ? 'disabled' : ''}>+</button>
      </div>
      <span class="preview-toolbar__note">Ingredient amounts adjust · macros are per serving</span>
    </div>

    <div class="tabs" role="tablist" aria-label="Plan days">
      ${DAY_TABS.map((label, i) => `
        <button type="button" class="tab" role="tab" id="tab-${i}" data-tab="${i}" aria-controls="planPanel"
                aria-selected="${activeTab === i}" tabindex="${activeTab === i ? 0 : -1}"
                aria-label="${esc(state.planData.days[i].day)}">${label}</button>`).join('')}
      <button type="button" class="tab tab--grocery" role="tab" id="tab-grocery" data-tab="grocery" aria-controls="planPanel"
              aria-selected="${activeTab === 'grocery'}" tabindex="${activeTab === 'grocery' ? 0 : -1}">🛒 Grocery List</button>
    </div>

    <div id="planPanel" role="tabpanel" aria-labelledby="tab-${activeTab}">${renderPlanPanel()}</div>

    ${state.planData.protocol_notes ? `
      <div class="protocol-notes">
        <strong>Protocol notes:</strong> ${esc(state.planData.protocol_notes)}
      </div>` : ''}
    ${restrictions.length ? `
      <div class="restriction-notes">
        <strong>Avoiding:</strong> ${restrictions.map(esc).join(', ')}
      </div>` : ''}`;
}

function bindPreview(el) {
  const preview = $('#planPreview', el);
  if (!preview || !hasPlan()) return;

  const refreshPanel = () => {
    $('#planPanel', el).innerHTML = renderPlanPanel();
    $('#planPanel', el).setAttribute('aria-labelledby', `tab-${activeTab}`);
  };

  const selectTab = (tab, focus = false) => {
    activeTab = tab;
    $$('.tab', el).forEach(btn => {
      const selected = btn.dataset.tab === String(tab);
      btn.setAttribute('aria-selected', selected);
      btn.tabIndex = selected ? 0 : -1;
      if (selected && focus) btn.focus();
    });
    refreshPanel();
  };

  preview.addEventListener('click', event => {
    if (event.target.closest('[data-action="adjust-macros"]')) {
      state.editingTargets = true;
      saveState();
      goToScreen(screenIndex('macros'), 'back', { force: true });
      return;
    }

    const tab = event.target.closest('.tab');
    if (tab) {
      selectTab(tab.dataset.tab === 'grocery' ? 'grocery' : Number(tab.dataset.tab));
      return;
    }

    const stepper = event.target.closest('[data-servings]');
    if (stepper) {
      const next = Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, state.servings + Number(stepper.dataset.servings)));
      if (next === state.servings) return;
      state.servings = next;
      saveState();
      $('#servingsValue', el).textContent = next;
      $('[data-servings="-1"]', el).disabled = next <= MIN_SERVINGS;
      $('[data-servings="1"]', el).disabled = next >= MAX_SERVINGS;
      refreshPanel();
    }
  });

  // Arrow keys move between tabs (WAI-ARIA tabs pattern)
  $('.tabs', el).addEventListener('keydown', event => {
    const order = [...DAY_TABS.keys(), 'grocery'];
    const index = order.indexOf(activeTab);
    let next = null;
    if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
    if (event.key === 'ArrowLeft') next = order[(index - 1 + order.length) % order.length];
    if (event.key === 'Home') next = order[0];
    if (event.key === 'End') next = order[order.length - 1];
    if (next !== null) {
      event.preventDefault();
      selectTab(next, true);
    }
  });

  preview.addEventListener('change', event => {
    const box = event.target.closest('[data-grocery]');
    if (!box) return;
    state.groceryChecked = { ...(state.groceryChecked || {}), [box.dataset.grocery]: box.checked };
    saveState();
  });
}

function renderResults() {
  return `
    <div class="screen__inner screen__inner--wide">
      <div class="results">
        <section class="panel preview-panel" aria-label="Meal plan preview">
          <div class="summary-bar">
            <span class="summary-bar__name">${esc(state.clientName)}</span>
            ${state.protocols.map(p => `<span class="pill">${esc(p)}</span>`).join('')}
            <span class="pill">${esc(state.cookingSkill)}</span>
            <span class="pill">${esc(timeLabel(state.cookingTime))}</span>
          </div>
          <div id="planPreview">${renderPreview()}</div>
        </section>

        <aside class="panel delivery-card" aria-label="Deliver the plan">
          <h2 class="delivery-card__title" tabindex="-1">${copy().deliveryHeadline(name())}</h2>
          <div class="field">
            <label class="field__label" for="deliveryEmail">Email</label>
            <input class="input" id="deliveryEmail" type="email" inputmode="email" autocomplete="email"
                   value="${esc(state.clientEmail)}" aria-describedby="deliveryEmailError" />
            <p class="field__error" id="deliveryEmailError" aria-live="polite"></p>
          </div>
          <button type="button" class="btn btn--primary btn--block" data-action="email">📧 Email this plan</button>
          <div id="emailStatus" aria-live="polite"></div>
          <div class="divider-or">or</div>
          <button type="button" class="btn btn--ghost btn--block" data-action="download">⬇ Download PDF</button>
          <div id="downloadStatus" aria-live="polite"></div>
          <div class="delivery-card__footer">
            <button type="button" class="btn btn--text" data-action="reset">🔄 Build another plan</button>
          </div>
        </aside>
      </div>
    </div>`;
}

function statusAlert(type, message) {
  const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ';
  return `<div class="alert alert--${type}"><span class="alert__icon" aria-hidden="true">${icon}</span><span>${message}</span></div>`;
}

// Client details + current serving settings for pdf.js
function pdfClientInfo() {
  return {
    name: state.clientName,
    age: state.age,
    weight: state.weight,
    weightUnit: state.weightUnit,
    protocols: [...state.protocols],
    restrictions: restrictedFoods()
  };
}

function pdfSettings(overrides = {}) {
  return {
    servings: state.servings,
    baseServings: state.baseServings,
    cookingSkill: state.cookingSkill,
    cookingTime: state.cookingTime,
    macroTargets: state.planData?.macro_targets || null,
    ...overrides
  };
}

function setButtonBusy(button, busy, label = '') {
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${label}`;
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

function bindResults(el) {
  bindPreview(el);

  const emailInput = $('#deliveryEmail', el);
  const emailBtn = $('[data-action="email"]', el);

  emailInput.addEventListener('input', () => {
    const valid = isValidEmail(emailInput.value);
    emailBtn.disabled = !valid;
    emailInput.setAttribute('aria-invalid', !valid && emailInput.value !== '');
    $('#deliveryEmailError', el).textContent = valid || emailInput.value === '' ? '' : 'Please enter a valid email address.';
    if (valid) {
      state.clientEmail = emailInput.value.trim();
      saveState();
    }
  });

  emailBtn.addEventListener('click', async () => {
    const status = $('#emailStatus', el);
    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
      emailInput.setAttribute('aria-invalid', 'true');
      $('#deliveryEmailError', el).textContent = 'Please enter a valid email address.';
      emailInput.focus();
      return;
    }

    setButtonBusy(emailBtn, true, 'Sending…');
    status.innerHTML = '';
    try {
      const pdfBase64 = await generatePDF(state.planData, pdfClientInfo(), pdfSettings({ download: false }));
      await sendPlanEmail({
        clientName: state.clientName,
        clientEmail: email,
        dietProtocols: [...state.protocols],
        cookingSkill: state.cookingSkill,
        cookingTime: state.cookingTime,
        macroTargets: state.planData?.macro_targets || null,
        servings: state.servings,
        generatedDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        pdfBase64,
        mode: state.mode
      });
      state.planDelivered = true;
      saveState();
      status.innerHTML = statusAlert('success', `Sent to ${esc(email)}`);
      setButtonBusy(emailBtn, false);
      emailBtn.innerHTML = '📧 Send again';
    } catch (err) {
      console.error(err);
      status.innerHTML = statusAlert('error', esc(err.message || "The email couldn't be sent."));
      setButtonBusy(emailBtn, false);
      emailBtn.innerHTML = '📧 Retry sending';
    }
  });

  $('[data-action="download"]', el).addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = $('#downloadStatus', el);
    setButtonBusy(button, true, 'Preparing PDF…');
    status.innerHTML = '';
    try {
      await generatePDF(state.planData, pdfClientInfo(), pdfSettings({ download: true }));
      state.planDelivered = true;
      saveState();
      status.innerHTML = statusAlert('success', `Downloaded ${esc(pdfFileName(state.clientName))}`);
    } catch (err) {
      console.error(err);
      status.innerHTML = statusAlert('error', esc(err.message || "Couldn't create the PDF. Please try again."));
    } finally {
      setButtonBusy(button, false);
    }
  });

  $('[data-action="reset"]', el).addEventListener('click', resetApp);
}

function resetApp() {
  generationRun++; // cancel any in-flight generation
  openCategory = null;
  activeTab = 0;
  state = initialState();
  try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
  goToScreen(0, 'back', { force: true });
}

/* ==========================================================================
   Navigation
   ========================================================================== */
const screenIndex = id => SCREENS.findIndex(screen => screen.id === id);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function updateChrome() {
  const n = state.currentScreen;
  const screen = SCREENS[n];

  $('#appHeader').hidden = n === 0;
  $('#stepTitle').textContent = screen.title;
  // Back is hidden on the landing page, during generation, and on the results
  // (going back from results would re-run generation — use "Build another plan").
  $('#backBtn').hidden = n === 0 || n >= screenIndex('generate');

  const progress = Math.min(100, (n / screenIndex('generate')) * 100);
  $('#progressFill').style.width = `${progress}%`;
  $('#progress').setAttribute('aria-valuenow', Math.round(progress));

  document.title = screen.title ? `${screen.title} · RWC Meal Plan Generator` : 'RWC Meal Plan Generator';
}

function goToScreen(n, direction = 'forward', { force = false } = {}) {
  if (n < 0 || n >= SCREENS.length) return;

  // Validate the current screen before advancing
  if (!force && n > state.currentScreen && !SCREENS[state.currentScreen].isValid()) {
    const btn = $('.screen:not(.is-leaving) [data-action="continue"]');
    if (btn) btn.disabled = true;
    return;
  }

  const viewport = $('#screenViewport');
  $$('.screen.is-leaving', viewport).forEach(s => s.remove()); // finish any in-progress transition
  const old = $('.screen', viewport);

  const next = document.createElement('section');
  next.className = 'screen';
  state.currentScreen = n;
  next.innerHTML = SCREENS[n].render();

  if (old && direction !== 'none' && !reduceMotion.matches) {
    const forward = direction === 'forward';
    old.classList.add('is-leaving', forward ? 'slide-out-left' : 'slide-out-right');
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    next.classList.add(forward ? 'slide-in-right' : 'slide-in-left');
    viewport.appendChild(next);

    const cleanup = () => {
      old.remove();
      next.classList.remove('slide-in-right', 'slide-in-left');
    };
    old.addEventListener('animationend', cleanup, { once: true });
    setTimeout(cleanup, 400); // fallback if animationend doesn't fire
  } else {
    if (old) old.remove();
    viewport.appendChild(next);
  }

  updateChrome();
  bindScreen(next);
  window.scrollTo({ top: 0, behavior: 'auto' });

  const heading = $('[tabindex="-1"]', next);
  if (heading) heading.focus({ preventScroll: true });

  saveState();
  if (SCREENS[n].onEnter) SCREENS[n].onEnter(next);
}

function bindScreen(el) {
  const screen = SCREENS[state.currentScreen];
  if (screen.bind) screen.bind(el);

  // Generic Continue buttons (Screen 1's is a form submit, handled in its bind)
  $$('[data-action="continue"]:not([type="submit"])', el).forEach(btn => {
    btn.addEventListener('click', () => goToScreen(state.currentScreen + 1));
  });
  refreshContinue(el);
}

/* ==========================================================================
   Persistence — survives an accidental refresh; cleared by "Build another plan"
   or when the tab closes
   ========================================================================== */
function saveState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage unavailable or full — the app still works without it */ }
}

function loadState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== 'object') return;
    state = { ...initialState(), ...saved, mode }; // URL decides the mode
    // A refresh mid-generation (or with no plan) resumes at the last quiz step
    const generate = screenIndex('generate');
    if (state.currentScreen === generate || (state.currentScreen === screenIndex('results') && !state.planData)) {
      state.currentScreen = generate - 1;
    }
  } catch (e) { /* ignore corrupt or unavailable storage */ }
}

/* ==========================================================================
   Global events + boot
   ========================================================================== */

// Enter / Space activate role="button" cards (native buttons already do this)
document.addEventListener('keydown', event => {
  const target = event.target;
  if (target.getAttribute('role') !== 'button' || target.tagName === 'BUTTON') return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    target.click();
  }
});

$('#backBtn').addEventListener('click', () => {
  if (state.currentScreen > 0) goToScreen(state.currentScreen - 1, 'back');
});

// Warn before leaving mid-generation or with an undelivered plan
window.addEventListener('beforeunload', event => {
  if (state.currentScreen === screenIndex('generate') || (state.currentScreen === screenIndex('results') && !state.planDelivered)) {
    event.preventDefault();
    event.returnValue = '';
  }
});

loadState();
goToScreen(state.currentScreen, 'none', { force: true });
