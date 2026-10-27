# Meal Plan Generator

A quiz-style web app built for two brands from one codebase:
- **Redefining Wellness Center / Dr. Jaban Moore, DC** (`BRAND=rwc`, the default)
- **Biohacking Bombshell** (`BRAND=bb`)

 A health coach (or a client) answers a few questions. Claude then writes a personalized 7-day meal plan with full recipes that follows the client's protocols. The app shows a preview, downloads a branded PDF, and can email the plan through Zapier.

- **Coach mode** (default): `https://<your-site>/`
- **Client mode** (lead magnet): `https://<your-site>/?mode=client`. It uses warmer copy, requires an email address up front, and tags the lead `meal-plan-lead` in GoHighLevel.

Each brand gets its own Netlify site. The quiz, protocols, prompts and checks are shared; only the look and wording change:
- **RWC** follows drjabanmoore.com: navy gradients, Poppins with Fraunces italic accents, teal highlights and orange buttons.
- **Biohacking Bombshell** follows the BB estore: night-plum gradients, Montserrat, hot-pink pill buttons and the blue → plum → pink logo gradient.

## Brands

Everything brand-specific lives in `brands/<id>/`:

| File | What it holds |
|---|---|
| `brand.json` | Names, landing and email wording, logo files, PDF colors, fonts and wording, the practice name Claude is given, and the GHL tag |
| `brand.css` | Overrides for the design tokens in `style.css` (colors, fonts, radius) plus any brand-only touches |
| `assets/` | `logo.png` (light backgrounds), `logo-white.png` (dark), `favicon.png`, and anything `brand.css` uses (BB's `hero.jpg`) |

`scripts/build.mjs` builds the site for the brand named in the `BRAND` environment variable into `dist/`. The Netlify functions read the same variable.

---

## Setup on Netlify

Create one Netlify site per brand, both from this repo.

1. **Import the repo** into Netlify. Leave the build settings blank; `netlify.toml` already sets them.
2. **Add the environment variables** under Site configuration → Environment variables:

   | Variable | Value | Scopes |
   |---|---|---|
   | `BRAND` | `rwc` or `bb` (leave it unset for RWC) | **Builds and Functions** |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key | Functions |
   | `ZAPIER_WEBHOOK_URL` | That brand's Zapier "Catch Hook" URL (`https://hooks.zapier.com/hooks/catch/…`) | Functions |

3. **Redeploy**. Netlify only picks up environment variables on a new deploy.

Neither value ever reaches the browser. The page talks only to its own `/api/*` functions, and the functions call Claude and Zapier.

## The Zap

- **Trigger:** Webhooks by Zapier → Catch Hook.
- **Action:** Gmail → Send Email:
  - **From:** support@rwc.health for RWC, or Biohacking Bombshell's support address
  - **To:** `clientEmail`
  - **Subject:** `{{clientName}}'s 7-Day Meal Plan is Ready 🥗`
  - **Attachments:** map **`pdfUrl`**. Zapier downloads the PDF from that link and attaches it.
- **Optional:** for client-mode leads (`mode` = `client`), add a GoHighLevel step that applies `ghlTag` (`meal-plan-lead`).

Every webhook call includes these fields:
- the client and plan details: `clientName`, `clientEmail`, `dietProtocols`, `cookingSkill`, `cookingTime`, `servings`, `generatedDate`, `mode`
- the PDF, twice: `pdfBase64` (a data URI) and `pdfUrl` (a private link that works for 7 days), plus `pdfFileName`
- `ghlTag`, in client mode only
- `brand` (`rwc` or `bb`), in case one Zap ever serves both sites

## How it works

| Step | Where |
|---|---|
| Quiz screens, navigation, servings scaler | `app.js`, `style.css`, `index.html` |
| Optional macro targets (calculator + screen) | `macros.js` |
| Food list (14 categories) | `data/foods.js` |
| Protocol names and **the rules Claude must follow** | `data/protocols.js` |
| Starting generation and checking its progress | `generate.js` → `netlify/functions/generate-plan.mjs` and `plan-status.mjs` |
| Prompts, the 3 Claude calls, JSON repair, building the plan | `netlify/lib/meal-plan.mjs` |
| Branded PDF | `pdf.js` (jsPDF, with Poppins and Fraunces embedded from `assets/fonts/`) |
| Email | `email.js` → `netlify/functions/send-plan.mjs`, `plan-pdf.mjs`, `netlify/lib/send-plan.mjs` |

Generation runs as a Netlify **background function** because three full-recipe Claude calls take longer than a normal function is allowed to run. The browser checks `/api/plan-status` every 2 seconds, and Screen 9 shows each step as it finishes. The model is `claude-sonnet-4-6` with up to 10,000 tokens per call.

**Cooking time "Mix it up"** writes quick meals (under 30 min) Monday–Friday and in-depth recipes on Saturday and Sunday.

**Macro targets (optional):** after the protocols, the quiz asks whether the client tracks macros. If they do, it works like calculator.net:
- It uses the Mifflin-St Jeor equation with sex, height, weight, age and activity level.
- **Goals:** lose weight, lose gently, maintain, build muscle, gain weight.
- **Macro styles:** Balanced, Protein-forward, Lower fat, Lower carb, Keto, or Custom grams.
- Calories never go below 1,200 (women) or 1,500 (men), and targets are for adults 18 and over only.
- Claude is asked to keep each day within ±10% of every target, but protocol rules always come first.
- The results screen shows the targets at the top and marks each day's totals with ✓ (on target) or the gap. **Adjust targets** rebuilds the plan with new numbers.
- The Zap also receives a `macroTargets` summary line, or an empty string if no targets were set.

**Protocol avoid lists:** `PROTOCOL_AVOIDS` in `data/protocols.js` lists the foods each protocol rules out, such as Low-Mold → peanuts and cashews, or Low-Histamine → spinach and tomatoes. These foods are applied in three places:
- They show as locked 🔒 chips on the restrictions screen, so clients don't have to tick them.
- They are sent to Claude as a hard exclusion list.
- They are checked again after generation (`netlify/lib/compliance.mjs`). The same check covers calories, carbs and macro targets. If a day breaks a rule, Claude gets one revision pass. Anything still unresolved appears to the coach as "Double-check N items" on the results screen.

**Clinical review:** the per-protocol rules and avoid lists in `data/protocols.js` are sent to Claude word for word. Have the clinical team review and edit them so they match RWC's own protocol handouts.

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
cp .env.example .env    # then fill in ANTHROPIC_API_KEY, ZAPIER_WEBHOOK_URL and BRAND
npm run build           # or: npm run build:bb
npx netlify dev         # http://localhost:8888
```

`netlify dev` serves `dist/` and runs the functions. Rebuild after changing any front-end file.

## Notes

- jsPDF-AutoTable still loads from cdnjs as the original spec asked, but the PDF layout is drawn directly to match the site. You can remove that script tag from `index.html`.
- `GET /api/health` reports the site's brand and whether `ANTHROPIC_API_KEY` works and whether `ZAPIER_WEBHOOK_URL` is set (status words only, no secrets).
- The disclaimer on the last PDF page is in `pdf.js` (`drawNotes`); have it reviewed.
- Fonts (Poppins, Fraunces, Montserrat) are © their authors and used under the SIL Open Font License (`assets/fonts/OFL-*.txt`).
