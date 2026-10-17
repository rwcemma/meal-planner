// RWC Meal Plan Generator — Claude API calls, JSON repair, plan assembly
//
// TEMPORARY PLACEHOLDER (Build step 5): simulates the generation steps so the quiz
// flow can be tested end to end without an API key. Replaced in Build step 7.
//
// Contract used by app.js:
//   generateMealPlan(input, onProgress) → Promise<planData>
//     input:      see getGenerationInput() in app.js
//     onProgress: (stepIndex 0–4, 'active' | 'done') => void
//
// Add ?simulateError to the URL to test Screen 9's error state.

async function generateMealPlan(input, onProgress) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const simulateError = new URLSearchParams(window.location.search).has('simulateError');

  for (let step = 0; step < 5; step++) {
    onProgress(step, 'active');
    await wait(step < 2 ? 500 : 900);
    if (simulateError && step === 2) {
      throw new Error('Simulated failure while writing Monday–Thursday recipes (placeholder until Step 7).');
    }
    onProgress(step, 'done');
  }

  return { placeholder: true, input, days: [], grocery_list: {}, protocol_notes: '' };
}
