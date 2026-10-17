// RWC Meal Plan Generator — generation job records (Netlify Blobs)
//
// A job record holds progress and, once finished, the plan itself. It contains no
// client name or email, and it's deleted as soon as the browser collects the result.

import { getStore } from '@netlify/blobs';

const JOB_TTL_MS = 60 * 60 * 1000; // records older than an hour are treated as expired
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidJobId = id => typeof id === 'string' && UUID.test(id);

const store = () => getStore({ name: 'meal-plan-jobs', consistency: 'strong' });

export async function writeJob(id, record) {
  await store().setJSON(id, { ...record, updatedAt: Date.now() });
}

export async function readJob(id) {
  const record = await store().get(id, { type: 'json' });
  if (record && Date.now() - record.updatedAt > JOB_TTL_MS) {
    await deleteJob(id);
    return null;
  }
  return record;
}

export async function deleteJob(id) {
  await store().delete(id);
}
