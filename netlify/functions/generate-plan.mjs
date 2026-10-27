// Meal Plan Generator — starts plan generation (Netlify Background Function)
//
// POST /api/generate-plan  { jobId, input }
// Responds 202 immediately; runs the 3 Claude calls (up to 15 min allowed) and
// records progress + the finished plan under jobId for /api/plan-status.

import { generatePlan, validateInput, InputError } from '../lib/meal-plan.mjs';
import { isValidJobId, writeJob } from '../lib/jobs.mjs';

export default async (req) => {
  let body;
  try {
    body = await req.json();
  } catch {
    return; // not JSON — nothing to record
  }

  const { jobId } = body ?? {};
  if (!isValidJobId(jobId)) return;

  try {
    const input = validateInput(body.input);
    await writeJob(jobId, { status: 'running', step: 1 });

    const planData = await generatePlan(input, step => writeJob(jobId, { status: 'running', step }));
    await writeJob(jobId, { status: 'done', step: 5, planData });
  } catch (err) {
    console.error('[generate-plan]', err);
    const message = err instanceof InputError
      ? `Some plan details weren't valid: ${err.message}`
      : err.message || 'Something went wrong while building the plan.';
    await writeJob(jobId, { status: 'error', message }).catch(e => console.error('[generate-plan] could not record error', e));
  }
};

export const config = {
  path: '/api/generate-plan',
  method: 'POST',
  background: true,
  // Each plan makes 3 Claude calls — cap how many plans one visitor can start
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
