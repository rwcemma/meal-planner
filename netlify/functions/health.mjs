// Meal Plan Generator — configuration check
//
// GET /api/health → { brand, anthropicKey, anthropicError?, zapierWebhook, model }
//   anthropicKey:  'ok' | 'missing' | 'rejected' | 'error'  (checked with a free model lookup)
//   anthropicError: when not ok, the HTTP status and error type (e.g. '404 not_found_error') — never the key
//   zapierWebhook: 'set' | 'missing' | 'invalid'            (format only — never fires the Zap)
// Reports status words only; no secret values are ever returned.

import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from '../lib/meal-plan.mjs';
import { currentBrand } from '../lib/brand.mjs';
import { readEnv } from '../lib/env.mjs';

export default async () => {
  const apiKey = readEnv('ANTHROPIC_API_KEY');
  let anthropicKey = 'missing';
  let anthropicError;
  if (apiKey) {
    try {
      await new Anthropic({ apiKey, maxRetries: 0 }).models.retrieve(MODEL);
      anthropicKey = 'ok';
    } catch (err) {
      anthropicKey = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError
        ? 'rejected'
        : 'error';
      anthropicError = [err.status, err.error?.error?.type || err.name].filter(Boolean).join(' ');
      console.error('[health] Anthropic check failed', err.status, err.message);
    }
  }

  const webhook = readEnv('ZAPIER_WEBHOOK_URL');
  const zapierWebhook = !webhook ? 'missing' : /^https:\/\/hooks\.zapier\.com\/hooks\/catch\//.test(webhook) ? 'set' : 'invalid';

  return Response.json({ brand: currentBrand().id, anthropicKey, ...(anthropicError ? { anthropicError } : {}), zapierWebhook, model: MODEL }, { headers: { 'Cache-Control': 'no-store' } });
};

export const config = {
  path: '/api/health',
  method: 'GET',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
