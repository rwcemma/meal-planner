// Meal Plan Generator — reports generation progress
//
// GET /api/plan-status?id=<jobId>
//   404 → job not started yet (or expired)
//   200 → { status: 'running', step } | { status: 'done', planData } | { status: 'error', message }
// Finished jobs are deleted once collected.

import { isValidJobId, readJob, deleteJob } from '../lib/jobs.mjs';

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!isValidJobId(id)) return json({ error: 'Invalid job id' }, 400);

  const job = await readJob(id);
  if (!job) return json({ error: 'Not found' }, 404);

  if (job.status === 'done' || job.status === 'error') await deleteJob(id);
  return json(job);
};

export const config = {
  path: '/api/plan-status',
  method: 'GET'
};
