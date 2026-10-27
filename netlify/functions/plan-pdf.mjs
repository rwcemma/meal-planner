// Meal Plan Generator — serves an emailed plan's PDF to the Zap (and the client)
//
// GET /api/plan-pdf/<id>  → the PDF, for 7 days after it was sent; 404 afterwards.

import { readPdf } from '../lib/send-plan.mjs';

export default async (req, context) => {
  const id = context.params?.id || new URL(req.url).pathname.split('/').pop();
  const entry = await readPdf(id);
  if (!entry) return new Response('This meal plan link has expired.', { status: 404 });

  return new Response(entry.data, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${entry.metadata.fileName || 'Meal_Plan.pdf'}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex'
    }
  });
};

export const config = {
  path: '/api/plan-pdf/:id',
  method: 'GET'
};
