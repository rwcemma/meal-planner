// Meal Plan Generator — configuration check
//
// GET /api/health → { brand, anthropicKey, zapierWebhook, model }
//   anthropicKey:  'ok' | 'missing' | 'rejected' | 'error'  (checked with a free model lookup)
//   zapierWebhook: 'set' | 'missing' | 'invalid'            (format only — never fires the Zap)
// Reports status words only; no secret values are ever returned.

import Anthropic from '@anthropic-ai/sdk';
import { MODEL } from '../lib/meal-plan.mjs';
import { currentBrand } from '../lib/brand.mjs';

export default async () => {
  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  let anthropicKey = 'missing';
  if (apiKey) {
    try {
      await new Anthropic({ apiKey, maxRetries: 0 }).models.retrieve(MODEL);
      anthropicKey = 'ok';
    } catch (err) {
      anthropicKey = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError
        ? 'rejected'
        : 'error';
      console.error('[health] Anthropic check failed', err.status, err.message);
    }
  }

  const webhook = Netlify.env.get('ZAPIER_WEBHOOK_URL');
  const zapierWebhook = !webhook ? 'missing' : /^https:\/\/hooks\.zapier\.com\/hooks\/catch\//.test(webhook) ? 'set' : 'invalid';

  return Response.json({ brand: currentBrand().id, anthropicKey, zapierWebhook, model: MODEL }, { headers: { 'Cache-Control': 'no-store' } });
};

export const config = {
  path: '/api/health',
  method: 'GET',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
