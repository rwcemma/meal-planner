// RWC Meal Plan Generator — branded PDF generation
//
// Visual language follows drjabanmoore.com: deep navy gradients with a faint teal
// pinstripe, Poppins ExtraBold headings with Fraunces italic accent words in teal,
// small uppercase teal eyebrows, rounded cards, and orange calls to action.
//
//   generatePDF(planData, clientInfo, settings) → Promise<string>  (data:application/pdf;base64,…)
//     clientInfo: { name, age, weight, weightUnit, protocols, restrictions }
//     settings:   { servings, baseServings, cookingSkill, cookingTime, download = true }
//
// Page 1 cover · pages 2+ one per day (continues onto a new page only if a day overflows)
// · weekly grocery list with checkboxes · protocol notes & reminders.

const PDF_PAGE = { width: 612, height: 792, margin: 44 }; // US Letter, points
const PDF_CONTENT_WIDTH = PDF_PAGE.width - PDF_PAGE.margin * 2;
const PDF_CONTENT_TOP = 106;
const PDF_CONTENT_BOTTOM = PDF_PAGE.height - 46;

const PDF_COLORS = {
  navy: '#040e68',
  navyBright: '#0a1fa8',
  navyDeep: '#051575',
  ink: '#0d1440',
  ink2: '#2a3a6e',
  muted: '#7a8ab0',
  onNavyMuted: '#9aa3cf',
  teal: '#00c4cc',
  tealDeep: '#04979e',
  tealLight: '#5fe3e8',
  tealBorder: '#ccf3f5',  // #00c4cc33 on white
  orange: '#ff8d28',
  cream: '#f0f8ff',
  border: '#e7e8ec',      // #0d14401a on white
  red: '#ef4444',
  redLight: '#fef2f2',
  white: '#ffffff'
};

const PDF_FONT_FILES = [
  ['Poppins-Light', 'Poppins_300Light.ttf'],
  ['Poppins', 'Poppins_400Regular.ttf'],
  ['Poppins-SemiBold', 'Poppins_600SemiBold.ttf'],
  ['Poppins-Bold', 'Poppins_700Bold.ttf'],
  ['Poppins-ExtraBold', 'Poppins_800ExtraBold.ttf'],
  ['Fraunces', 'Fraunces_900Black_Italic.ttf']
];

// Built-in fallbacks if the brand fonts can't be fetched
const PDF_FALLBACK_FONTS = {
  'Poppins-Light': ['helvetica', 'normal'],
  Poppins: ['helvetica', 'normal'],
  'Poppins-SemiBold': ['helvetica', 'bold'],
  'Poppins-Bold': ['helvetica', 'bold'],
  'Poppins-ExtraBold': ['helvetica', 'bold'],
  Fraunces: ['times', 'bolditalic']
};

const PDF_MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

const PDF_LOGOS = { color: 'assets/rwc-logo.png', white: 'assets/rwc-logo-white.png' };
const PDF_LOGO_RATIO = 323 / 900; // height / width of the logo files

let pdfFontData = null; // [[name, file, base64], ...] cached after first load
let pdfLogoData = null; // { color, white } data URLs, cached after first load

/* ==========================================================================
   Public API
   ========================================================================== */
async function generatePDF(planData, clientInfo, settings = {}) {
  if (!window.jspdf?.jsPDF) {
    throw new Error("The PDF library didn't load. Check your internet connection and refresh the page.");
  }
  if (!Array.isArray(planData?.days) || planData.days.length !== 7) {
    throw new Error('There is no complete plan to export yet.');
  }

  const [fontsLoaded, logos] = await Promise.all([loadPdfFonts(), loadPdfLogos()]);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
  if (fontsLoaded) registerPdfFonts(doc);

  const ctx = createPdfContext(doc, planData, clientInfo, settings, fontsLoaded);
  ctx.logos = logos;

  drawCover(ctx);
  planData.days.forEach((day, index) => drawDay(ctx, day, index));
  drawGrocery(ctx);
  drawNotes(ctx);
  drawPageFooters(ctx);

  doc.setProperties({
    title: `${clientInfo.name}'s 7-Day Meal Plan`,
    subject: 'Personalized 7-Day Meal Plan',
    author: 'Redefining Wellness Center — Dr. Jaban Moore, DC',
    creator: 'RWC Meal Plan Generator'
  });

  if (settings.download !== false) doc.save(pdfFileName(clientInfo.name));
  return `data:application/pdf;base64,${btoa(doc.output())}`;
}

// "Sarah" → "Sarah_Meal_Plan_2026-10-18.pdf"
function pdfFileName(name, date = new Date()) {
  const safeName = String(name || 'Client').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Client';
  const pad = n => String(n).padStart(2, '0');
  return `${safeName}_Meal_Plan_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}

/* ==========================================================================
   Fonts
   ========================================================================== */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function loadPdfFonts() {
  if (pdfFontData) return true;
  try {
    pdfFontData = await Promise.all(PDF_FONT_FILES.map(async ([name, file]) => {
      const response = await fetch(`assets/fonts/${file}`);
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return [name, file, arrayBufferToBase64(await response.arrayBuffer())];
    }));
    return true;
  } catch (err) {
    console.warn('[pdf] brand fonts unavailable, using built-in fonts', err);
    pdfFontData = null;
    return false;
  }
}

async function loadPdfLogos() {
  if (pdfLogoData) return pdfLogoData;
  try {
    const entries = await Promise.all(Object.entries(PDF_LOGOS).map(async ([key, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return [key, `data:image/png;base64,${arrayBufferToBase64(await response.arrayBuffer())}`];
    }));
    pdfLogoData = Object.fromEntries(entries);
  } catch (err) {
    console.warn('[pdf] logo unavailable', err);
    pdfLogoData = {};
  }
  return pdfLogoData;
}

function registerPdfFonts(doc) {
  for (const [name, file, base64] of pdfFontData) {
    doc.addFileToVFS(file, base64);
    doc.addFont(file, name, 'normal');
  }
}

/* ==========================================================================
   Drawing context + primitives
   ========================================================================== */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Keep only characters the embedded fonts can render
function pdfText(value) {
  return String(value ?? '')
    .replace(/⅓/g, '1/3').replace(/⅔/g, '2/3').replace(/⅛/g, '1/8')
    .replace(/⅜/g, '3/8').replace(/⅝/g, '5/8').replace(/⅞/g, '7/8')
    .replace(/[→⇒]/g, '-').replace(/[✓✔]/g, '')
    .replace(/[^\x20-\x7E -ſ–—‘’“”•…]/g, '')
    .replace(/\s+/g, ' '); // not trimmed: mixed-font headings rely on trailing spaces
}

function createPdfContext(doc, planData, clientInfo, settings, fontsLoaded) {
  const servings = settings.servings || settings.baseServings || 1;
  const factor = servings / (settings.baseServings || servings);

  const ctx = {
    doc,
    plan: planData,
    client: clientInfo,
    settings,
    servings,
    scaleIngredient: item => (typeof scaleIngredient === 'function' ? scaleIngredient(item, factor) : item),
    scaleGrocery: item => (typeof scaleGroceryItem === 'function' ? scaleGroceryItem(item, factor) : item),
    images: {},

    font(name, size) {
      if (fontsLoaded) doc.setFont(name, 'normal');
      else doc.setFont(...PDF_FALLBACK_FONTS[name]);
      doc.setFontSize(size);
    },
    color(hex) { doc.setTextColor(...hexToRgb(hex)); },
    fill(hex) { doc.setFillColor(...hexToRgb(hex)); },
    stroke(hex, width = 1) { doc.setDrawColor(...hexToRgb(hex)); doc.setLineWidth(width); },

    width(text, font, size, charSpace = 0) {
      ctx.font(font, size);
      const clean = pdfText(text);
      return doc.getTextWidth(clean) + charSpace * Math.max(clean.length - 1, 0);
    },

    // Draw text; align 'left' | 'center' | 'right'
    text(text, x, y, { font = 'Poppins', size = 9, color = PDF_COLORS.ink2, align = 'left', charSpace = 0 } = {}) {
      const clean = pdfText(text);
      const w = ctx.width(clean, font, size, charSpace);
      const startX = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      ctx.color(color);
      doc.text(clean, startX, y, charSpace ? { charSpace } : undefined);
      return w;
    },

    // Mixed-font line, e.g. ExtraBold "Weekly grocery " + Fraunces teal "list"
    mixed(parts, x, y, align = 'left') {
      const widths = parts.map(p => ctx.width(p.text, p.font, p.size));
      const total = widths.reduce((a, b) => a + b, 0);
      let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
      parts.forEach((p, i) => {
        ctx.text(p.text, cursor, y, { font: p.font, size: p.size, color: p.color });
        cursor += widths[i];
      });
      return total;
    },

    wrap(text, font, size, width) {
      ctx.font(font, size);
      return doc.splitTextToSize(pdfText(text), width);
    },

    // Site-style eyebrow: short teal rule + small uppercase letter-spaced label
    eyebrow(text, x, y, { color = PDF_COLORS.teal, align = 'left', rule = true, size = 7.5 } = {}) {
      const label = pdfText(text).toUpperCase();
      const charSpace = 1.4;
      const ruleWidth = rule ? 16 : 0;
      const gap = rule ? 7 : 0;
      const total = ruleWidth + gap + ctx.width(label, 'Poppins-SemiBold', size, charSpace);
      const startX = align === 'center' ? x - total / 2 : x;
      if (rule) {
        ctx.fill(color);
        doc.rect(startX, y - size * 0.38, ruleWidth, 1.4, 'F');
      }
      ctx.text(label, startX + ruleWidth + gap, y, { font: 'Poppins-SemiBold', size, color, charSpace });
      return total;
    },

    image(key, build, x, y, w, h) {
      if (!ctx.images[key]) ctx.images[key] = build();
      const { data, format } = ctx.images[key];
      doc.addImage(data, format, x, y, w, h, key, 'FAST');
    }
  };
  return ctx;
}

/* ==========================================================================
   Gradients (rendered to canvas, embedded as images)
   ========================================================================== */
function cssAngleGradient(g, w, h, angleDeg, stops) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const gradient = g.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  return gradient;
}

// Navy section background from drjabanmoore.com, optionally rounded, with the teal pinstripe
function navyPanelImage(w, h, { radius = 0, stripes = true, scale = 2 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const g = canvas.getContext('2d');
  g.scale(scale, scale);

  g.beginPath();
  if (radius) g.roundRect(0, 0, w, h, radius);
  else g.rect(0, 0, w, h);
  g.clip();

  g.fillStyle = cssAngleGradient(g, w, h, 135, [[0, PDF_COLORS.navy], [0.4, PDF_COLORS.navyBright], [1, PDF_COLORS.navyDeep]]);
  g.fillRect(0, 0, w, h);

  if (stripes) {
    g.strokeStyle = 'rgba(0, 196, 204, 0.07)';
    g.lineWidth = 0.6;
    for (let k = -h; k < w + h; k += 22) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + h, h);
      g.stroke();
    }
  }
  // Rounded panels need transparent corners (PNG); full-bleed ones compress better as JPEG
  return radius
    ? { data: canvas.toDataURL('image/png'), format: 'PNG' }
    : { data: canvas.toDataURL('image/jpeg', 0.92), format: 'JPEG' };
}

// Teal announcement-bar gradient used as a thin brand strip
function tealStripImage(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * 2);
  canvas.height = Math.max(2, Math.round(h * 2));
  const g = canvas.getContext('2d');
  g.scale(2, 2);
  g.fillStyle = cssAngleGradient(g, w, h, 120, [[0, PDF_COLORS.tealLight], [0.55, PDF_COLORS.teal], [1, PDF_COLORS.tealDeep]]);
  g.fillRect(0, 0, w, h);
  return { data: canvas.toDataURL('image/jpeg', 0.95), format: 'JPEG' };
}

/* ==========================================================================
   Page chrome
   ========================================================================== */
function startInnerPage(ctx, { eyebrow, title, accent, right }) {
  const { doc } = ctx;
  doc.addPage();
  ctx.image('strip', () => tealStripImage(PDF_PAGE.width, 5), 0, 0, PDF_PAGE.width, 5);

  const x = PDF_PAGE.margin;
  ctx.eyebrow(eyebrow, x, 42);
  ctx.mixed([
    { text: title, font: 'Poppins-ExtraBold', size: 26, color: PDF_COLORS.ink },
    ...(accent ? [{ text: accent, font: 'Fraunces', size: 26, color: PDF_COLORS.teal }] : [])
  ], x, 74);

  if (right) {
    const [line] = ctx.wrap(right, 'Poppins', 8.5, 250);
    ctx.text(line, PDF_PAGE.width - x, 72, { font: 'Poppins', size: 8.5, color: PDF_COLORS.muted, align: 'right' });
  }

  ctx.stroke(PDF_COLORS.teal, 1.2);
  doc.line(x, 88, PDF_PAGE.width - x, 88);
  return PDF_CONTENT_TOP;
}

function drawPageFooters(ctx) {
  const { doc } = ctx;
  const total = doc.getNumberOfPages();
  for (let page = 2; page <= total; page++) {
    doc.setPage(page);
    const y = PDF_PAGE.height - 24;
    ctx.stroke(PDF_COLORS.border, 0.6);
    doc.line(PDF_PAGE.margin, y - 11, PDF_PAGE.width - PDF_PAGE.margin, y - 11);
    let fx = PDF_PAGE.margin;
    if (ctx.logos.color) {
      const logoH = 15;
      doc.addImage(ctx.logos.color, 'PNG', fx, y - 11, logoH / PDF_LOGO_RATIO, logoH, 'logo-color', 'FAST');
      fx += logoH / PDF_LOGO_RATIO + 10;
    }
    ctx.text('Dr. Jaban Moore, DC  ·  drjabanmoore.com', fx, y, { font: 'Poppins-Light', size: 7.5, color: PDF_COLORS.muted });
    ctx.text(`${pdfText(ctx.client.name)}'s 7-Day Meal Plan  ·  Page ${page} of ${total}`, PDF_PAGE.width - PDF_PAGE.margin, y,
      { font: 'Poppins-Light', size: 7.5, color: PDF_COLORS.muted, align: 'right' });
  }
}

/* ==========================================================================
   Page 1 — cover
   ========================================================================== */
function drawCover(ctx) {
  const { doc, client } = ctx;
  const { width: W, height: H } = PDF_PAGE;
  const cx = W / 2;

  ctx.image('cover', () => navyPanelImage(W, H, { scale: 1.5 }), 0, 0, W, H);
  ctx.image('strip', () => tealStripImage(W, 5), 0, 0, W, 5);

  if (ctx.logos.white) {
    const logoW = 190;
    doc.addImage(ctx.logos.white, 'PNG', cx - logoW / 2, 150, logoW, logoW * PDF_LOGO_RATIO, 'logo-white', 'FAST');
  }

  let y = 268;
  ctx.eyebrow('Redefining Wellness Center', cx, y, { align: 'center', size: 8.5 });

  // Largest size (54pt down to 26pt) where no word is split and the name fits on two lines
  const nameText = `${client.name}'s`;
  const nameWidth = W - 120;
  let nameSize = 54;
  let nameLines = ctx.wrap(nameText, 'Poppins-ExtraBold', nameSize, nameWidth);
  const fits = size => pdfText(nameText).split(' ').every(word => ctx.width(word, 'Poppins-ExtraBold', size) <= nameWidth)
    && ctx.wrap(nameText, 'Poppins-ExtraBold', size, nameWidth).length <= 2;
  while (nameSize > 26 && !fits(nameSize)) nameSize -= 2;
  nameLines = ctx.wrap(nameText, 'Poppins-ExtraBold', nameSize, nameWidth);

  y += 8 + nameSize;
  nameLines.forEach(line => {
    ctx.text(line, cx, y, { font: 'Poppins-ExtraBold', size: nameSize, color: PDF_COLORS.white, align: 'center' });
    y += nameSize * 1.04;
  });

  y += 2;
  ctx.mixed([
    { text: 'Personalized 7-Day ', font: 'Poppins-ExtraBold', size: 24, color: PDF_COLORS.white },
    { text: 'Meal Plan', font: 'Fraunces', size: 26, color: PDF_COLORS.teal }
  ], cx, y, 'center');

  // Protocol pills (wrapping rows, centered)
  y += 34;
  const pillH = 22;
  const pills = (client.protocols || []).map(p => ({ label: pdfText(p), w: ctx.width(p, 'Poppins-SemiBold', 9) + 24 }));
  const rows = [];
  let row = [];
  let rowW = 0;
  for (const pill of pills) {
    if (row.length && rowW + pill.w + 8 > W - 140) { rows.push(row); row = []; rowW = 0; }
    row.push(pill);
    rowW += pill.w + (row.length > 1 ? 8 : 0);
  }
  if (row.length) rows.push(row);
  rows.forEach(r => {
    const total = r.reduce((sum, p) => sum + p.w, 0) + 8 * (r.length - 1);
    let x = cx - total / 2;
    r.forEach(p => {
      ctx.fill('#101a72');
      ctx.stroke('#0b4f96', 0.8);
      doc.roundedRect(x, y, p.w, pillH, pillH / 2, pillH / 2, 'FD');
      ctx.text(p.label, x + p.w / 2, y + 14.6, { font: 'Poppins-SemiBold', size: 9, color: PDF_COLORS.white, align: 'center' });
      x += p.w + 8;
    });
    y += pillH + 8;
  });

  y += 18;
  const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const info = [
    client.age ? `Age ${client.age}` : '',
    client.weight ? `${client.weight} ${client.weightUnit || 'lbs'}` : '',
    ctx.settings.macroTargets ? `${Number(ctx.settings.macroTargets.calories).toLocaleString('en-US')} cal/day target` : '',
    `Generated ${generated}`
  ].filter(Boolean).join('   ·   ');
  ctx.text(info, cx, y, { font: 'Poppins-Light', size: 10, color: PDF_COLORS.onNavyMuted, align: 'center' });

  y += 48;
  ctx.text('Your nutrition, personalized to heal from the root.', cx, y,
    { font: 'Fraunces', size: 17, color: PDF_COLORS.teal, align: 'center' });

  // Footer
  ctx.stroke('#1b2a8a', 0.6);
  doc.line(PDF_PAGE.margin, H - 64, W - PDF_PAGE.margin, H - 64);
  ctx.text('Dr. Jaban Moore, DC  ·  drjabanmoore.com', cx, H - 42,
    { font: 'Poppins-SemiBold', size: 9, color: PDF_COLORS.onNavyMuted, align: 'center' });
}

/* ==========================================================================
   Pages 2–8 — one per day
   ========================================================================== */
const CARD_PAD = 12;
const COL_GAP = 16;
const BODY_SIZE = 8;
const LEAD = 10.2;        // body line height at 8pt
const CARD_GAP = 8;
const TOTALS_HEIGHT = 28;

// Lays out (and optionally draws) one meal card; returns its height.
// Header row: meal eyebrow (left) + per-serving macro chips (right); then name, meta,
// and two columns — ingredients (36%) and numbered instructions.
function layoutMeal(ctx, slot, meal, x, y, draw) {
  const { doc } = ctx;
  const inner = PDF_CONTENT_WIDTH - CARD_PAD * 2;
  const leftW = Math.round(inner * 0.36);
  const rightW = inner - leftW - COL_GAP;
  const ix = x + CARD_PAD;

  const nameLines = ctx.wrap(meal.name, 'Poppins-ExtraBold', 12.5, inner);
  const meta = [`Prep ${meal.prep_time}`, `Cook ${meal.cook_time}`, `Serves ${ctx.servings}`, ctx.settings.cookingSkill]
    .filter(Boolean).join('   ·   ');
  const ingredients = meal.ingredients.map(item => ctx.wrap(ctx.scaleIngredient(item), 'Poppins', BODY_SIZE, leftW - 9));
  const steps = meal.instructions.map(step => ctx.wrap(step, 'Poppins', BODY_SIZE, rightW - 17));
  const ingredientsH = ingredients.reduce((h, lines) => h + lines.length * LEAD + 1.5, 0);
  const stepsH = steps.reduce((h, lines) => h + lines.length * LEAD + 2, 0);

  // Meta sits beside a one-line recipe name when there's room, otherwise below it
  const metaInline = nameLines.length === 1
    && ctx.width(nameLines[0], 'Poppins-ExtraBold', 12.5) + 14 + ctx.width(meta, 'Poppins-Light', 8) <= inner;

  const labelY = y + CARD_PAD + 6;                       // eyebrow baseline
  const nameTop = labelY + 4;
  const nameBottom = nameTop + nameLines.length * 15;
  const metaY = metaInline ? nameTop + 12 : nameBottom + 9; // meta baseline
  const columnsTop = (metaInline ? nameBottom : metaY) + 6;
  const height = columnsTop + 10 + Math.max(ingredientsH, stepsH) + CARD_PAD - 2 - y;

  if (!draw) return height;

  ctx.fill(PDF_COLORS.white);
  ctx.stroke(PDF_COLORS.border, 0.8);
  doc.roundedRect(x, y, PDF_CONTENT_WIDTH, height, 12, 12, 'FD');

  ctx.eyebrow(PDF_MEAL_LABELS[slot] || slot, ix, labelY);

  // Macro chips, right-aligned in the header row
  const chips = [`P ${meal.protein_g}g`, `F ${meal.fat_g}g`, `C ${meal.carbs_g}g`, `${meal.calories} cal`];
  const chipW = chips.map(label => ctx.width(label, 'Poppins-SemiBold', 7) + 12);
  let cx = x + PDF_CONTENT_WIDTH - CARD_PAD - chipW.reduce((a, b) => a + b, 0) - 4 * (chips.length - 1);
  ctx.text('per serving', cx - 6, labelY, { font: 'Poppins-Light', size: 7, color: PDF_COLORS.muted, align: 'right' });
  chips.forEach((label, i) => {
    ctx.fill(PDF_COLORS.cream);
    ctx.stroke(PDF_COLORS.tealBorder, 0.6);
    doc.roundedRect(cx, labelY - 9.5, chipW[i], 13.5, 6.75, 6.75, 'FD');
    ctx.text(label, cx + chipW[i] / 2, labelY, { font: 'Poppins-SemiBold', size: 7, color: PDF_COLORS.ink2, align: 'center' });
    cx += chipW[i] + 4;
  });

  nameLines.forEach((line, i) => {
    ctx.text(line, ix, nameTop + 12 + i * 15, { font: 'Poppins-ExtraBold', size: 12.5, color: PDF_COLORS.ink });
  });
  const metaX = metaInline ? ix + ctx.width(nameLines[0], 'Poppins-ExtraBold', 12.5) + 14 : ix;
  ctx.text(meta, metaX, metaY, { font: 'Poppins-Light', size: 8, color: PDF_COLORS.muted });

  const rx = ix + leftW + COL_GAP;
  const headingY = columnsTop + 8;
  ctx.text('INGREDIENTS', ix, headingY, { font: 'Poppins-Bold', size: 6.5, color: PDF_COLORS.ink, charSpace: 0.9 });
  ctx.text('INSTRUCTIONS', rx, headingY, { font: 'Poppins-Bold', size: 6.5, color: PDF_COLORS.ink, charSpace: 0.9 });

  let ly = headingY + 2;
  ingredients.forEach(lines => {
    ctx.fill(PDF_COLORS.teal);
    doc.circle(ix + 2, ly + LEAD - 5.4, 1.4, 'F');
    lines.forEach(line => {
      ly += LEAD;
      ctx.text(line, ix + 9, ly - 2.5, { font: 'Poppins', size: BODY_SIZE, color: PDF_COLORS.ink2 });
    });
    ly += 1.5;
  });

  let ry = headingY + 2;
  steps.forEach((lines, i) => {
    ctx.text(String(i + 1).padStart(2, '0'), rx, ry + LEAD - 2.5, { font: 'Fraunces', size: 8.5, color: PDF_COLORS.teal });
    lines.forEach(line => {
      ry += LEAD;
      ctx.text(line, rx + 17, ry - 2.5, { font: 'Poppins', size: BODY_SIZE, color: PDF_COLORS.ink2 });
    });
    ry += 2;
  });

  return height;
}

// Slim navy band: "DAILY TOTALS · per person" on the left, values on the right
function drawDailyTotals(ctx, day, y) {
  const h = TOTALS_HEIGHT;
  const x = PDF_PAGE.margin;
  ctx.image('totals', () => navyPanelImage(PDF_CONTENT_WIDTH, h, { radius: h / 2 }), x, y, PDF_CONTENT_WIDTH, h);
  const baseline = y + h / 2 + 3;
  const labelW = ctx.eyebrow('Daily totals', x + 16, baseline, { size: 7 });
  ctx.text('per person', x + 16 + labelW + 8, baseline, { font: 'Poppins-Light', size: 7.5, color: PDF_COLORS.onNavyMuted });

  const values = [
    ['Protein', `${day.daily_protein_g}g`],
    ['Fat', `${day.daily_fat_g}g`],
    ['Carbs', `${day.daily_carbs_g}g`],
    ['', `${Number(day.daily_calories).toLocaleString('en-US')} cal`]
  ];
  let vx = PDF_PAGE.width - PDF_PAGE.margin - 18;
  for (const [label, value] of values.reverse()) {
    vx -= ctx.text(value, vx, baseline + 0.5, { font: 'Fraunces', size: 11.5, color: PDF_COLORS.white, align: 'right' });
    if (label) vx -= ctx.text(`${label} `, vx - 3, baseline, { font: 'Poppins-Light', size: 7.5, color: PDF_COLORS.onNavyMuted, align: 'right' }) + 3;
    vx -= 16;
  }
}

function drawDay(ctx, day, index) {
  const right = `${ctx.client.name}  ·  ${(ctx.client.protocols || []).join(' + ')}`;
  const header = continued => ({
    eyebrow: `Day ${index + 1} of 7`,
    title: continued ? `${day.day} ` : day.day,
    accent: continued ? 'continued' : '',
    right
  });

  let y = startInnerPage(ctx, header(false));
  const totalsY = PDF_CONTENT_BOTTOM - TOTALS_HEIGHT;

  for (const [slot, meal] of Object.entries(day.meals)) {
    const h = layoutMeal(ctx, slot, meal, PDF_PAGE.margin, y, false);
    if (y + h > PDF_CONTENT_BOTTOM && y > PDF_CONTENT_TOP) y = startInnerPage(ctx, header(true));
    layoutMeal(ctx, slot, meal, PDF_PAGE.margin, y, true);
    y += h + CARD_GAP;
  }

  // Totals band sits at the foot of the page; move to a new page if the meals reach it
  if (y > totalsY - 4) y = startInnerPage(ctx, header(true));
  drawDailyTotals(ctx, day, Math.max(y, totalsY));
}

/* ==========================================================================
   Grocery list — two columns of category cards with checkboxes
   ========================================================================== */
function drawGrocery(ctx) {
  const { doc } = ctx;
  const header = continued => ({
    eyebrow: 'Shopping list',
    title: continued ? 'Weekly grocery list ' : 'Weekly grocery ',
    accent: continued ? 'continued' : 'list',
    right: ctx.client.name
  });

  let top = startInnerPage(ctx, header(false));
  ctx.text(`Quantities for ${ctx.servings} serving${ctx.servings === 1 ? '' : 's'} per meal. Check items off as you shop.`,
    PDF_PAGE.margin, top + 4, { font: 'Poppins-Light', size: 9, color: PDF_COLORS.ink2 });
  top += 20;

  const colW = (PDF_CONTENT_WIDTH - 14) / 2;
  const colX = [PDF_PAGE.margin, PDF_PAGE.margin + colW + 14];
  let colY = [top, top];
  const textW = colW - 24 - 14;

  const categories = Object.entries(ctx.plan.grocery_list || {}).filter(([, items]) => items.length);
  for (const [category, items] of categories) {
    const wrapped = items.map(item => ctx.wrap(ctx.scaleGrocery(item), 'Poppins', 8.5, textW));
    const h = 12 + 14 + wrapped.reduce((sum, lines) => sum + lines.length * LEAD + 4, 0) + 8;

    let col = colY[0] <= colY[1] ? 0 : 1;
    if (colY[col] + h > PDF_CONTENT_BOTTOM) {
      const other = 1 - col;
      if (colY[other] + h <= PDF_CONTENT_BOTTOM) col = other;
      else {
        top = startInnerPage(ctx, header(true));
        colY = [top, top];
        col = 0;
      }
    }

    const x = colX[col];
    let y = colY[col];
    ctx.fill(PDF_COLORS.white);
    ctx.stroke(PDF_COLORS.border, 0.8);
    doc.roundedRect(x, y, colW, h, 12, 12, 'FD');

    ctx.eyebrow(category, x + 12, y + 18, { rule: false, size: 7.5 });
    y += 26;
    wrapped.forEach(lines => {
      ctx.fill(PDF_COLORS.white);
      ctx.stroke(PDF_COLORS.teal, 0.9);
      doc.roundedRect(x + 12, y + 2.2, 8.5, 8.5, 1.8, 1.8, 'FD');
      lines.forEach(line => {
        y += LEAD;
        ctx.text(line, x + 12 + 14, y - 1.5, { font: 'Poppins', size: 8.5, color: PDF_COLORS.ink2 });
      });
      y += 4;
    });
    colY[col] += h + 12;
  }
}

/* ==========================================================================
   Protocol notes & reminders
   ========================================================================== */
function drawCallout(ctx, y, { label, labelColor, body, border, background }) {
  const { doc } = ctx;
  const x = PDF_PAGE.margin;
  const lines = ctx.wrap(body, 'Poppins', 9.5, PDF_CONTENT_WIDTH - 36);
  const h = 22 + 12 + lines.length * 13.5 + 10;
  ctx.fill(background);
  doc.roundedRect(x, y, PDF_CONTENT_WIDTH, h, 12, 12, 'F');
  ctx.fill(border);
  doc.rect(x, y, 3, h, 'F');
  ctx.eyebrow(label, x + 18, y + 20, { color: labelColor, rule: false });
  let ty = y + 36;
  lines.forEach(line => {
    ctx.text(line, x + 18, ty, { font: 'Poppins', size: 9.5, color: PDF_COLORS.ink2 });
    ty += 13.5;
  });
  return h;
}

function drawNotes(ctx) {
  const { doc, client, plan } = ctx;
  let y = startInnerPage(ctx, { eyebrow: 'Your protocol', title: 'Protocol notes & ', accent: 'reminders', right: client.name });

  // Selected protocols
  let x = PDF_PAGE.margin;
  for (const protocol of client.protocols || []) {
    const w = ctx.width(protocol, 'Poppins-SemiBold', 8.5) + 22;
    if (x + w > PDF_PAGE.width - PDF_PAGE.margin) { x = PDF_PAGE.margin; y += 28; }
    ctx.fill(PDF_COLORS.cream);
    ctx.stroke(PDF_COLORS.tealBorder, 0.8);
    doc.roundedRect(x, y, w, 21, 10.5, 10.5, 'FD');
    ctx.text(protocol, x + w / 2, y + 14, { font: 'Poppins-SemiBold', size: 8.5, color: PDF_COLORS.ink, align: 'center' });
    x += w + 8;
  }
  y += 40;

  const t = ctx.settings.macroTargets;
  if (t) {
    y += drawCallout(ctx, y, {
      label: 'Daily macro targets', labelColor: PDF_COLORS.tealDeep,
      body: `${Number(t.calories).toLocaleString('en-US')} calories · Protein ${t.protein_g}g · Fat ${t.fat_g}g · Carbs ${t.carbs_g}g per person, per day`
        + `${t.goal ? ` (${t.goal}${t.style ? `, ${t.style}` : ''})` : ''}. Each day's totals are shown at the bottom of its page — the protocol rules always come first.`,
      border: PDF_COLORS.navyBright, background: PDF_COLORS.cream
    }) + 14;
  }

  if (plan.protocol_notes) {
    y += drawCallout(ctx, y, {
      label: 'Protocol notes', labelColor: PDF_COLORS.tealDeep, body: plan.protocol_notes,
      border: PDF_COLORS.teal, background: PDF_COLORS.cream
    }) + 14;
  }

  const restrictions = client.restrictions || [];
  if (restrictions.length) {
    y += drawCallout(ctx, y, {
      label: 'Foods to avoid', labelColor: PDF_COLORS.red, body: restrictions.join(', '),
      border: PDF_COLORS.red, background: PDF_COLORS.redLight
    }) + 14;
  }

  // Closing CTA panel (navy, like the site's closing section)
  const panelH = 132;
  y = Math.max(y + 6, PDF_CONTENT_BOTTOM - panelH - 56);
  const px = PDF_PAGE.margin;
  ctx.image('cta', () => navyPanelImage(PDF_CONTENT_WIDTH, panelH, { radius: 16 }), px, y, PDF_CONTENT_WIDTH, panelH);
  ctx.eyebrow('Next step', px + 24, y + 28);
  ctx.mixed([
    { text: 'Questions? ', font: 'Poppins-ExtraBold', size: 19, color: PDF_COLORS.white },
    { text: 'Contact your health coach.', font: 'Fraunces', size: 19, color: PDF_COLORS.teal }
  ], px + 24, y + 56);
  ctx.text('Your coach can adjust this plan as your body heals and your protocol changes.', px + 24, y + 76,
    { font: 'Poppins-Light', size: 9.5, color: PDF_COLORS.onNavyMuted });

  const btnLabel = 'drjabanmoore.com';
  const btnW = ctx.width(btnLabel, 'Poppins-Bold', 10) + 40;
  const btnY = y + 92;
  ctx.fill(PDF_COLORS.orange);
  doc.roundedRect(px + 24, btnY, btnW, 26, 8, 8, 'F');
  ctx.text(btnLabel, px + 24 + btnW / 2, btnY + 16.8, { font: 'Poppins-Bold', size: 10, color: PDF_COLORS.white, align: 'center' });
  doc.link(px + 24, btnY, btnW, 26, { url: 'https://drjabanmoore.com' });

  // Disclaimer
  const disclaimer = 'This meal plan was generated with AI assistance from the protocols and food restrictions selected for you. '
    + 'It is educational and does not replace individualized medical advice. Always read ingredient labels, and talk with your '
    + 'health coach or provider before making changes to your diet, supplements, or medications.';
  let dy = y + panelH + 20;
  ctx.wrap(disclaimer, 'Poppins-Light', 7, PDF_CONTENT_WIDTH).forEach(line => {
    ctx.text(line, PDF_PAGE.margin, dy, { font: 'Poppins-Light', size: 7, color: PDF_COLORS.muted });
    dy += 9.5;
  });
}
