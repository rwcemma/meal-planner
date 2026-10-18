# RWC Meal Plan Generator

A quiz-style web app for **Redefining Wellness Center / Dr. Jaban Moore, DC**. A health coach (or a client) answers a few questions. Claude then writes a personalized 7-day meal plan with full recipes that follows the client's protocols. The app shows a preview, downloads a branded PDF, and can email the plan through Zapier.

- **Coach mode** (default): `https://<your-site>/`
- **Client mode** (lead magnet): `https://<your-site>/?mode=client`. It uses warmer copy, requires an email address up front, and tags the lead `meal-plan-lead` in GoHighLevel.

The design follows drjabanmoore.com: navy gradients, Poppins with Fraunces italic accents, teal highlights and orange buttons.

---

## Setup on Netlify

1. **Import the repo** into Netlify. Leave the build settings blank; `netlify.toml` already sets them.
2. **Add two environment variables** under Site configuration → Environment variables, with scope **Functions**:

   | Variable | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | Your Anthropic API key |
   | `ZAPIER_WEBHOOK_URL` | Your Zapier "Catch Hook" URL (`https://hooks.zapier.com/hooks/catch/…`) |

3. **Redeploy**. Netlify only picks up environment variables on a new deploy.

Neither value ever reaches the browser. The page talks only to its own `/api/*` functions, and the functions call Claude and Zapier.

## The Zap

- **Trigger:** Webhooks by Zapier → Catch Hook.
- **Action:** Gmail → Send Email:
  - **From:** support@rwc.health
  - **To:** `clientEmail`
  - **Subject:** `{{clientName}}'s 7-Day Meal Plan is Ready 🥗`
  - **Attachments:** map **`pdfUrl`**. Zapier downloads the PDF from that link and attaches it.
- **Optional:** for client-mode leads (`mode` = `client`), add a GoHighLevel step that applies `ghlTag` (`meal-plan-lead`).

Every webhook call includes these fields:
- the client and plan details: `clientName`, `clientEmail`, `dietProtocols`, `cookingSkill`, `cookingTime`, `servings`, `generatedDate`, `mode`
- the PDF, twice: `pdfBase64` (a data URI) and `pdfUrl` (a private link that works for 7 days), plus `pdfFileName`
- `ghlTag`, in client mode only

## How it works

| Step | Where |
|---|---|
| Quiz screens, navigation, servings scaler | `app.js`, `style.css`, `index.html` |
| Food list (14 categories) | `data/foods.js` |
| Protocol names and **the rules Claude must follow** | `data/protocols.js` |
| Starting generation and checking its progress | `generate.js` → `netlify/functions/generate-plan.mjs` and `plan-status.mjs` |
| Prompts, the 3 Claude calls, JSON repair, building the plan | `netlify/lib/meal-plan.mjs` |
| Branded PDF | `pdf.js` (jsPDF, with Poppins and Fraunces embedded from `assets/fonts/`) |
| Email | `email.js` → `netlify/functions/send-plan.mjs`, `plan-pdf.mjs`, `netlify/lib/send-plan.mjs` |

Generation runs as a Netlify **background function** because three full-recipe Claude calls take longer than a normal function is allowed to run. The browser checks `/api/plan-status` every 2 seconds, and Screen 9 shows each step as it finishes. The model is `claude-sonnet-4-6` with up to 10,000 tokens per call.

**Clinical review:** the per-protocol rules in `data/protocols.js` are sent to Claude word for word. Have the clinical team review and edit them so they match RWC's own protocol handouts.

## Data and limits

- **Saved in the browser:** quiz answers and the plan stay in the browser tab's storage until the tab closes or someone clicks "Build another plan".
- **Generation jobs** (stored in Netlify Blobs) hold progress and the finished plan, with no name or email. A job is deleted as soon as the browser collects the plan.
- **Emailed PDFs** are stored in Netlify Blobs for 7 days so the Zap can attach them, then deleted.
- Netlify Blobs is **not** part of Netlify's HIPAA-compliant offering.
- **Rate limits:** 5 plan generations and 5 emails per minute per visitor (`config.rateLimit` in each function).
- **The servings control (1–8)** rescales ingredient and grocery quantities in the browser. Macros are per serving and don't change.

## Run it locally

```bash
npm install
cp .env.example .env    # then fill in ANTHROPIC_API_KEY and ZAPIER_WEBHOOK_URL
npx netlify dev         # http://localhost:8888
```

`netlify dev` runs the static site and the functions together. Opening `index.html` directly lets you click through the quiz, but generation and email need the functions.

## Notes

- jsPDF-AutoTable still loads from cdnjs as the original spec asked, but the PDF layout is drawn directly to match the site. You can remove that script tag from `index.html`.
- Logo files: `assets/rwc-logo.png` (color), `assets/rwc-logo-white.png` (for navy backgrounds), `assets/rwc-mark.png` (favicon).
- `GET /api/health` reports whether `ANTHROPIC_API_KEY` works and whether `ZAPIER_WEBHOOK_URL` is set (status words only, no secrets).
- The disclaimer on the last PDF page is in `pdf.js` (`drawNotes`); have it reviewed.
- Fonts are © their authors and used under the SIL Open Font License (`assets/fonts/OFL-*.txt`).
