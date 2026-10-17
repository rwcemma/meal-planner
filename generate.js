// RWC Meal Plan Generator — plan generation (browser side)
//
// The Claude API key lives only on the server. The prompts, the 3 sequential Claude
// calls, JSON repair and plan assembly run in a Netlify Background Function
// (netlify/functions/generate-plan.mjs → netlify/lib/meal-plan.mjs). This file
// starts that job and polls for progress so Screen 9 can show each step live.
//
// Contract used by app.js:
//   generateMealPlan(input, onProgress) → Promise<planData>
//     input:      see getGenerationInput() in app.js
//     onProgress: (stepIndex 0–4, 'active' | 'done') => void

const GENERATE_ENDPOINT = '/api/generate-plan';
const STATUS_ENDPOINT = '/api/plan-status';

const POLL_INTERVAL_MS = 2000;
const START_GRACE_MS = 60 * 1000;      // how long to wait for the job to appear
const GENERATION_TIMEOUT_MS = 8 * 60 * 1000;
const MAX_POLL_FAILURES = 5;           // consecutive network/server errors before giving up

const GENERATION_STEP_COUNT = 5;

async function generateMealPlan(input, onProgress) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const jobId = crypto.randomUUID();

  // Steps before `step` are done, `step` is active
  let reported = -1;
  const reportStep = step => {
    for (let i = Math.max(reported, 0); i < Math.min(step, GENERATION_STEP_COUNT); i++) onProgress(i, 'done');
    if (step < GENERATION_STEP_COUNT) onProgress(step, 'active');
    reported = step;
  };
  reportStep(0);

  let response;
  try {
    response = await fetch(GENERATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, input })
    });
  } catch (err) {
    throw new Error("Couldn't reach the meal plan service. Check your internet connection and try again.");
  }
  if (response.status === 429) {
    throw new Error('Too many plans were started in the last minute. Please wait a moment, then try again.');
  }
  if (!response.ok) {
    throw new Error(`The meal plan service couldn't start (error ${response.status}). Please try again.`);
  }

  const started = Date.now();
  let failures = 0;

  while (true) {
    await wait(POLL_INTERVAL_MS);

    if (Date.now() - started > GENERATION_TIMEOUT_MS) {
      throw new Error('Building the plan is taking much longer than expected. Please try again.');
    }

    let job;
    try {
      const res = await fetch(`${STATUS_ENDPOINT}?id=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
      if (res.status === 404) {
        if (Date.now() - started > START_GRACE_MS) {
          throw new Error("The meal plan service didn't start the job. Please try again.");
        }
        continue;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);
      job = await res.json();
      failures = 0;
    } catch (err) {
      if (err.message.startsWith('The meal plan service')) throw err;
      if (++failures >= MAX_POLL_FAILURES) {
        throw new Error('Lost connection to the meal plan service. Check your internet connection and try again.');
      }
      continue;
    }

    if (job.status === 'error') throw new Error(job.message || 'Something went wrong while building the plan.');
    if (typeof job.step === 'number' && job.step > reported) reportStep(job.step);
    if (job.status === 'done') {
      reportStep(GENERATION_STEP_COUNT);
      return job.planData;
    }
  }
}
