// Meal Plan Generator — emails a plan via the Zapier webhook
//
// POST /api/send-plan  { clientName, clientEmail, dietProtocols, cookingSkill, cookingTime,
//                        servings, generatedDate, pdfBase64, mode }
// → 200 { success: true } | 4xx/5xx { error }
// The GHL tag is decided here from `mode` (never trusted from the browser).

import { currentBrand } from '../lib/brand.mjs';
import {
  validatePayload, storePdf, forwardToZapier, deleteExpiredPdfs, PayloadError, ghlLeadTag
} from '../lib/send-plan.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export default async (req, context) => {
  const webhookUrl = Netlify.env.get('ZAPIER_WEBHOOK_URL');
  if (!webhookUrl || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(webhookUrl)) {
    return json({ error: "Email isn't set up yet — add ZAPIER_WEBHOOK_URL in Netlify and redeploy." }, 500);
  }

  let plan;
  try {
    plan = validatePayload(await req.json());
  } catch (err) {
    const message = err instanceof PayloadError ? err.message : 'The request was not valid.';
    return json({ error: message }, 400);
  }

  try {
    const pdfId = await storePdf(plan.pdfBytes, plan.pdfFileName);
    const pdfUrl = new URL(`/api/plan-pdf/${pdfId}`, req.url).toString();

    await forwardToZapier(webhookUrl, {
      clientName: plan.clientName,
      clientEmail: plan.clientEmail,
      dietProtocols: plan.dietProtocols,
      cookingSkill: plan.cookingSkill,
      cookingTime: plan.cookingTime,
      macroTargets: plan.macroTargets, // '' when no targets were set
      servings: plan.servings,
      generatedDate: plan.generatedDate,
      pdfBase64: plan.pdfBase64,
      pdfUrl,                       // same PDF as a link — easiest to attach in a Zap
      pdfFileName: plan.pdfFileName,
      mode: plan.mode,
      brand: currentBrand().id,     // rwc | bb — lets one Zap serve both sites if needed
      ...(plan.mode === 'client' ? { ghlTag: ghlLeadTag() } : {})
    });
  } catch (err) {
    console.error('[send-plan]', err);
    return json({ error: "The email service didn't accept the plan. Please try again in a moment." }, 502);
  }

  context.waitUntil(deleteExpiredPdfs().catch(err => console.warn('[send-plan] cleanup failed', err)));
  return json({ success: true });
};

export const config = {
  path: '/api/send-plan',
  method: 'POST',
  // Each call sends a real email — keep one visitor from spamming it
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
