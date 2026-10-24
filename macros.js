// RWC Meal Plan Generator — optional daily macro targets
//
// Works like calculator.net's macro calculator: Mifflin-St Jeor BMR × activity level,
// adjusted for the goal, then split into protein / fat / carbs by a macro style.
// Uses globals from app.js at runtime (state, saveState, esc, $, $$, refreshContinue …).

const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary — little or no exercise', factor: 1.2 },
  { value: 'light', label: 'Light — exercise 1–3 times a week', factor: 1.375 },
  { value: 'moderate', label: 'Moderate — exercise 4–5 times a week', factor: 1.465 },
  { value: 'active', label: 'Active — daily, or intense 3–4 times a week', factor: 1.55 },
  { value: 'very', label: 'Very active — intense 6–7 times a week', factor: 1.725 },
  { value: 'extra', label: 'Extra active — intense daily or a physical job', factor: 1.9 }
];

const MACRO_GOALS = [
  { value: 'lose', label: 'Lose weight', detail: '~1 lb a week', delta: -500 },
  { value: 'lose-mild', label: 'Lose gently', detail: '~½ lb a week', delta: -250 },
  { value: 'maintain', label: 'Maintain', detail: 'Stay steady', delta: 0 },
  { value: 'muscle', label: 'Build muscle', detail: 'Lean gain', delta: 250 },
  { value: 'gain', label: 'Gain weight', detail: '~1 lb a week', delta: 500 }
];

// Percent of calories from [protein, fat, carbs]
const MACRO_STYLES = [
  { value: 'balanced', label: 'Balanced', split: [30, 30, 40] },
  { value: 'protein', label: 'Protein-forward', split: [40, 30, 30] },
  { value: 'lowfat', label: 'Lower fat', split: [30, 20, 50] },
  { value: 'lowcarb', label: 'Lower carb', split: [35, 45, 20] },
  { value: 'keto', label: 'Keto', split: [25, 70, 5] },
  { value: 'custom', label: 'Custom', split: null }
];

const VERY_LOW_CARB_PROTOCOLS = ['Keto', 'Carnivore', "Lion's Diet"];
const CALORIE_FLOOR = { female: 1200, male: 1500 };

const findBy = (list, value) => list.find(item => item.value === value);

function heightInCm() {
  if (state.weightUnit === 'kg') return Number(state.heightCm) || 0;
  const inches = (Number(state.heightFt) || 0) * 12 + (Number(state.heightIn) || 0);
  return inches * 2.54;
}

function macroInputsComplete() {
  const cm = heightInCm();
  return ['female', 'male'].includes(state.sex)
    && cm >= 90 && cm <= 250
    && findBy(ACTIVITY_LEVELS, state.activity)
    && findBy(MACRO_GOALS, state.macroGoal)
    && findBy(MACRO_STYLES, state.macroStyle)
    && Number(state.age) >= 18
    && Number(state.weight) > 0;
}

// Returns { calories, protein_g, fat_g, carbs_g, goal, style, floored } or null
function computeMacroTargets() {
  if (!macroInputsComplete()) return null;
  const goal = findBy(MACRO_GOALS, state.macroGoal);
  const style = findBy(MACRO_STYLES, state.macroStyle);

  if (style.value === 'custom') {
    const { protein, fat, carbs } = state.customMacros || {};
    if (![protein, fat, carbs].every(g => Number.isFinite(g) && g >= 0)) return null;
    const calories = Math.round(protein * 4 + fat * 9 + carbs * 4);
    if (calories < 800) return null;
    return { calories, protein_g: protein, fat_g: fat, carbs_g: carbs, goal: goal.label, style: style.label, floored: false };
  }

  const kg = state.weightUnit === 'kg' ? Number(state.weight) : Number(state.weight) * 0.453592;
  const bmr = 10 * kg + 6.25 * heightInCm() - 5 * Number(state.age) + (state.sex === 'male' ? 5 : -161);
  const tdee = bmr * findBy(ACTIVITY_LEVELS, state.activity).factor;
  let calories = Math.round((tdee + goal.delta) / 10) * 10;
  const floor = CALORIE_FLOOR[state.sex];
  const floored = calories < floor;
  if (floored) calories = floor;

  const [p, f, c] = style.split;
  return {
    calories,
    protein_g: Math.round((calories * p) / 100 / 4),
    fat_g: Math.round((calories * f) / 100 / 9),
    carbs_g: Math.round((calories * c) / 100 / 4),
    goal: goal.label,
    style: style.label,
    floored
  };
}

/* ==========================================================================
   Screen
   ========================================================================== */
function choicePills(name, options, selected) {
  return `<div class="choice-pills" role="group" aria-label="${esc(name)}">
    ${options.map(o => `
      <button type="button" class="choice-pill" data-${name}="${esc(o.value)}" aria-pressed="${o.value === selected}">
        ${esc(o.label)}${o.detail ? `<small>${esc(o.detail)}</small>` : ''}
      </button>`).join('')}
  </div>`;
}

function renderMacroScreen() {
  const client = state.mode === 'client';
  const editing = state.editingTargets && state.planData;
  const tooYoung = Number(state.age) < 18;
  const heightFields = state.weightUnit === 'kg'
    ? `<input class="input" id="heightCm" type="number" inputmode="numeric" min="90" max="250" placeholder="cm"
              value="${state.heightCm ?? ''}" aria-label="Height in centimeters" />`
    : `<div class="height-ftin">
         <input class="input" id="heightFt" type="number" inputmode="numeric" min="3" max="8" placeholder="ft"
                value="${state.heightFt ?? ''}" aria-label="Height, feet" />
         <input class="input" id="heightIn" type="number" inputmode="numeric" min="0" max="11" placeholder="in"
                value="${state.heightIn ?? ''}" aria-label="Height, inches" />
       </div>`;

  return `
    <div class="screen__inner">
      <h2 class="screen-headline" tabindex="-1">${client ? 'Do you track your macros?' : `Does ${name()} track macros?`}</h2>
      <p class="screen-subhead">Optional — set daily calorie and macro targets and we'll build every day of the plan around them.</p>

      <div class="card-grid card-grid--narrow" role="group" aria-label="Macro targets">
        ${optionCard({ value: 'none', icon: '🍽️', title: 'No targets', desc: 'Just healthy, protocol-friendly meals' }, state.macroMode === 'none', true)}
        ${optionCard({ value: 'targets', icon: '🎯', title: 'Set macro targets', desc: tooYoung ? 'Available for adults 18 and over' : 'We’ll calculate calories and macros from the goal' }, state.macroMode === 'targets', true)}
      </div>

      <div class="macro-panel" id="macroPanel" ${state.macroMode === 'targets' ? '' : 'hidden'}>
        <div class="macro-grid">
          <div class="field">
            <span class="field__label" id="sexLabel">Sex <span class="field__hint">(for the calorie formula)</span></span>
            <div class="unit-toggle" role="group" aria-labelledby="sexLabel">
              <button type="button" class="unit-toggle__btn" data-sex="female" aria-pressed="${state.sex === 'female'}">Female</button>
              <button type="button" class="unit-toggle__btn" data-sex="male" aria-pressed="${state.sex === 'male'}">Male</button>
            </div>
          </div>
          <div class="field">
            <span class="field__label">Height</span>
            ${heightFields}
          </div>
          <div class="field macro-grid__wide">
            <label class="field__label" for="activity">Activity level</label>
            <select class="input" id="activity">
              ${ACTIVITY_LEVELS.map(a => `<option value="${a.value}" ${a.value === state.activity ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="field">
          <span class="field__label">Goal</span>
          ${choicePills('goal', MACRO_GOALS, state.macroGoal)}
        </div>
        <div class="field">
          <span class="field__label">Macro style</span>
          ${choicePills('style', MACRO_STYLES, state.macroStyle)}
        </div>

        <div class="macro-result" id="macroResult" aria-live="polite"></div>
        <p class="macro-note">Estimates use the Mifflin-St Jeor equation (the same as calculator.net). ${client ? 'Your coach' : 'You'} can fine-tune them with Custom.</p>
      </div>

      <div class="screen-actions">
        ${editing
          ? `<button type="button" class="btn btn--primary btn--lg" data-action="rebuild">Rebuild my plan →</button>
             <button type="button" class="btn btn--text" data-action="keep">Keep my current plan</button>`
          : continueButton()}
      </div>
    </div>`;
}

function renderMacroResult(el) {
  const box = $('#macroResult', el);
  if (!box) return;
  const targets = computeMacroTargets();
  const custom = state.macroStyle === 'custom';

  if (!targets && !custom) {
    box.innerHTML = '<p class="macro-result__empty">Fill in sex and height to see daily targets.</p>';
    return;
  }

  const t = targets || { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 };
  const pct = (grams, perGram) => (t.calories ? Math.round((grams * perGram * 100) / t.calories) : 0);
  const macroBox = (key, label, grams, perGram) => custom
    ? `<label class="macro-box">
         <span class="macro-box__label">${label}</span>
         <span class="macro-box__input"><input class="input" type="number" inputmode="numeric" min="0" max="900"
           data-custom="${key}" value="${state.customMacros?.[key] ?? ''}" aria-label="${label} grams per day" /> g</span>
         <span class="macro-box__pct">${pct(grams, perGram)}% of calories</span>
       </label>`
    : `<div class="macro-box">
         <span class="macro-box__label">${label}</span>
         <span class="macro-box__value">${grams}<small>g</small></span>
         <span class="macro-box__pct">${pct(grams, perGram)}% of calories</span>
       </div>`;

  box.innerHTML = `
    <div class="macro-result__calories">
      <span class="eyebrow">Daily target</span>
      <span class="macro-result__number">${t.calories ? t.calories.toLocaleString('en-US') : '—'}</span>
      <span class="macro-result__unit">calories / day</span>
    </div>
    <div class="macro-result__boxes">
      ${macroBox('protein', 'Protein', t.protein_g, 4)}
      ${macroBox('fat', 'Fat', t.fat_g, 9)}
      ${macroBox('carbs', 'Carbs', t.carbs_g, 4)}
    </div>
    ${targets?.floored ? `<p class="macro-warning">⚠ The goal would put calories below ${CALORIE_FLOOR[state.sex].toLocaleString('en-US')}/day, so we've held them at that minimum. Talk with your provider before going lower.</p>` : ''}
    ${state.protocols.some(p => VERY_LOW_CARB_PROTOCOLS.includes(p)) && !['keto', 'custom'].includes(state.macroStyle)
      ? `<p class="macro-warning">⚠ ${esc(state.protocols.filter(p => VERY_LOW_CARB_PROTOCOLS.includes(p)).join(' + '))} keeps carbs very low — the Keto style fits best. The protocol always wins over these targets.</p>`
      : ''}`;

  // Custom inputs only re-render the numbers around them, so typing keeps focus
  $$('[data-custom]', box).forEach(input => {
    input.addEventListener('input', () => {
      const value = input.value === '' ? null : Math.max(0, Math.round(Number(input.value)));
      state.customMacros = { ...(state.customMacros || {}), [input.dataset.custom]: value };
      saveState();
      const updated = computeMacroTargets();
      const calories = $('.macro-result__number', box);
      if (calories) calories.textContent = updated ? updated.calories.toLocaleString('en-US') : '—';
      $$('.macro-box__pct', box).forEach((pctEl, i) => {
        const grams = [updated?.protein_g, updated?.fat_g, updated?.carbs_g][i] || 0;
        pctEl.textContent = `${updated ? Math.round((grams * [4, 9, 4][i] * 100) / updated.calories) : 0}% of calories`;
      });
      refreshContinue(el);
    });
  });
}

function bindMacroScreen(el) {
  const panel = $('#macroPanel', el);
  const tooYoung = Number(state.age) < 18;

  // Very-low-carb protocols default to the Keto split the first time targets are opened
  if (!state.macroStyleTouched && state.protocols.some(p => VERY_LOW_CARB_PROTOCOLS.includes(p))) {
    state.macroStyle = 'keto';
  }

  const refresh = () => {
    renderMacroResult(el);
    refreshContinue(el);
    const rebuild = $('[data-action="rebuild"]', el);
    if (rebuild) rebuild.disabled = !macroScreenValid();
    saveState();
  };

  $$('.option-card', el).forEach(card => {
    if (card.dataset.value === 'targets' && tooYoung) card.setAttribute('aria-disabled', 'true');
    card.addEventListener('click', () => {
      if (card.dataset.value === 'targets' && tooYoung) return;
      state.macroMode = card.dataset.value;
      $$('.option-card', el).forEach(c => {
        const selected = c === card;
        c.classList.toggle('is-selected', selected);
        c.setAttribute('aria-pressed', selected);
      });
      panel.hidden = state.macroMode !== 'targets';
      refresh();
    });
  });

  $$('[data-sex]', el).forEach(btn => btn.addEventListener('click', () => {
    state.sex = btn.dataset.sex;
    $$('[data-sex]', el).forEach(b => b.setAttribute('aria-pressed', b === btn));
    refresh();
  }));

  [['heightFt', 'heightFt'], ['heightIn', 'heightIn'], ['heightCm', 'heightCm']].forEach(([id, key]) => {
    const input = $(`#${id}`, el);
    if (input) input.addEventListener('input', () => {
      state[key] = input.value === '' ? null : Number(input.value);
      refresh();
    });
  });

  $('#activity', el).addEventListener('change', event => {
    state.activity = event.target.value;
    refresh();
  });

  const bindPills = (attr, key, after) => $$(`[data-${attr}]`, el).forEach(btn => btn.addEventListener('click', () => {
    state[key] = btn.dataset[attr];
    $$(`[data-${attr}]`, el).forEach(b => b.setAttribute('aria-pressed', b === btn));
    if (after) after();
    refresh();
  }));

  bindPills('goal', 'macroGoal');
  bindPills('style', 'macroStyle', () => {
    state.macroStyleTouched = true;
    // Custom starts from the numbers the previous style produced
    if (state.macroStyle === 'custom' && !state.customMacros?.protein) {
      const previous = state.lastPresetTargets;
      if (previous) state.customMacros = { protein: previous.protein_g, fat: previous.fat_g, carbs: previous.carbs_g };
    }
  });

  const rebuild = $('[data-action="rebuild"]', el);
  if (rebuild) {
    rebuild.addEventListener('click', () => {
      if (!macroScreenValid()) return;
      state.editingTargets = false;
      goToScreen(screenIndex('generate'), 'forward', { force: true });
    });
    $('[data-action="keep"]', el).addEventListener('click', () => {
      state.editingTargets = false;
      goToScreen(screenIndex('results'), 'forward', { force: true });
    });
  }

  refresh();
}

function macroScreenValid() {
  if (state.macroMode === 'none') return true;
  if (state.macroMode !== 'targets') return false;
  const targets = computeMacroTargets();
  if (targets && state.macroStyle !== 'custom') state.lastPresetTargets = targets;
  return Boolean(targets);
}
