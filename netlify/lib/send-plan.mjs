// RWC Meal Plan Generator — email delivery (validation + Zapier hand-off)
//
// The browser posts the finished plan here; this module validates it, stores the PDF
// for the Zap to attach (by URL), and forwards the payload to the Zapier webhook.
// The webhook URL lives only in the ZAPIER_WEBHOOK_URL environment variable.

import { getStore } from '@netlify/blobs';
import protocols from '../../data/protocols.js';

const { getProtocol } = protocols;

export const GHL_LEAD_TAG = 'meal-plan-lead';
const PDF_PREFIX = 'data:application/pdf;base64,';
const MAX_PDF_CHARS = 5 * 1024 * 1024;           // ~3.7 MB PDF — plans are typically ~400 KB
export const PDF_TTL_MS = 7 * 24 * 60 * 60 * 1000; // stored PDFs expire after 7 days
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PayloadError extends Error {}

const pdfStore = () => getStore({ name: 'meal-plan-pdfs', consistency: 'strong' });

const cleanName = value => String(value ?? '')
  .replace(/[^\p{L}\p{M}\s'.-]/gu, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 40);

export function validatePayload(raw) {
  if (!raw || typeof raw !== 'object') throw new PayloadError('Missing plan details.');

  const clientName = cleanName(raw.clientName);
  if (!clientName) throw new PayloadError('Client first name is required.');

  const clientEmail = String(raw.clientEmail ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clientEmail) || clientEmail.length > 254) {
    throw new PayloadError('That email address is not valid.');
  }

  const dietProtocols = Array.isArray(raw.dietProtocols) ? [...new Set(raw.dietProtocols)] : [];
  if (!dietProtocols.length || dietProtocols.some(name => !getProtocol(name))) {
    throw new PayloadError('The plan protocols are not valid.');
  }

  if (!['Beginner', 'Intermediate', 'Advanced'].includes(raw.cookingSkill)) throw new PayloadError('Cooking skill is not valid.');
  if (!['Quick', 'Standard', 'Leisurely', 'Mixed'].includes(raw.cookingTime)) throw new PayloadError('Cooking time is not valid.');

  const servings = Number(raw.servings);
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new PayloadError('Servings must be between 1 and 8.');

  const pdfBase64 = String(raw.pdfBase64 ?? '');
  if (!pdfBase64.startsWith(PDF_PREFIX) || pdfBase64.length > MAX_PDF_CHARS) {
    throw new PayloadError('The PDF attachment is missing or too large.');
  }
  const pdfBytes = Buffer.from(pdfBase64.slice(PDF_PREFIX.length), 'base64');
  if (pdfBytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new PayloadError('The attachment is not a PDF.');

  const mode = raw.mode === 'client' ? 'client' : 'coach';
  const generatedDate = String(raw.generatedDate ?? '').replace(/[^\w ,]/g, '').slice(0, 40)
    || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const pdfFileName = `${clientName.replace(/[^\p{L}\p{N}]+/gu, '_')}_Meal_Plan.pdf`;

  // Optional macro targets → one readable line for the coach's email/CRM
  const t = raw.macroTargets;
  const nums = t && ['calories', 'protein_g', 'fat_g', 'carbs_g'].map(k => Math.round(Number(t[k])));
  const macroTargets = nums && nums.every(n => Number.isFinite(n) && n >= 0 && n <= 6000)
    ? `${nums[0]} cal · P ${nums[1]}g · F ${nums[2]}g · C ${nums[3]}g per day`
    : '';

  return { clientName, clientEmail, dietProtocols, cookingSkill: raw.cookingSkill, cookingTime: raw.cookingTime,
    servings, generatedDate, pdfBase64, pdfBytes, pdfFileName, mode, macroTargets };
}

// Stores the PDF under an unguessable id; returns that id
export async function storePdf(bytes, fileName) {
  const id = crypto.randomUUID();
  await pdfStore().set(id, new Blob([bytes], { type: 'application/pdf' }), {
    metadata: { fileName, expiresAt: Date.now() + PDF_TTL_MS }
  });
  return id;
}

export async function readPdf(id) {
  if (!UUID.test(id)) return null;
  const entry = await pdfStore().getWithMetadata(id, { type: 'arrayBuffer' });
  if (!entry) return null;
  if (!(entry.metadata?.expiresAt > Date.now())) {
    await pdfStore().delete(id);
    return null;
  }
  return entry;
}

// Best-effort cleanup of expired PDFs so plans don't linger in storage
export async function deleteExpiredPdfs() {
  const store = pdfStore();
  const { blobs } = await store.list();
  for (const { key } of blobs) {
    const meta = await store.getMetadata(key);
    if (!(meta?.metadata?.expiresAt > Date.now())) await store.delete(key);
  }
}

export async function forwardToZapier(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`Zapier responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}
