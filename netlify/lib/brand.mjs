// Meal Plan Generator — which brand this Netlify site serves
//
// Each site sets BRAND (rwc | bb | jess) in its environment; scripts/build.mjs uses the same
// variable to build the matching front end. Defaults to rwc.

import rwc from '../../brands/rwc/brand.json' with { type: 'json' };
import bb from '../../brands/bb/brand.json' with { type: 'json' };
import jess from '../../brands/jess/brand.json' with { type: 'json' };

const BRANDS = { rwc, bb, jess };

export function currentBrand() {
  const id = (globalThis.Netlify?.env.get('BRAND') ?? process.env.BRAND) || 'rwc';
  return BRANDS[id] || rwc;
}
