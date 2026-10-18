// RWC Meal Plan Generator — email delivery (browser side)
//
// The Zapier webhook URL is kept server-side (ZAPIER_WEBHOOK_URL in Netlify), so it
// can't be copied from the page and used to send email from support@rwc.health.
// This posts the plan to /api/send-plan (netlify/functions/send-plan.mjs), which
// validates it, adds the GHL tag in client mode, and forwards it to Zapier.
//
//   sendPlanEmail(payload) → Promise<{ success: true }>  (throws with a readable message)
//     payload: { clientName, clientEmail, dietProtocols, cookingSkill, cookingTime,
//                servings, generatedDate, pdfBase64, mode }

const SEND_PLAN_ENDPOINT = '/api/send-plan';

async function sendPlanEmail(payload) {
  let response;
  try {
    response = await fetch(SEND_PLAN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error("Couldn't reach the email service. Check your internet connection and try again.");
  }

  if (response.status === 429) {
    throw new Error('Too many emails were sent in the last minute. Please wait a moment, then try again.');
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.error || `The email couldn't be sent (error ${response.status}). Please try again.`);
  }
  return { success: true };
}
