# AI Lead Scraper — GrowPlus Lead Engine

AI-powered lead scraper + outreach automation dashboard, built from the
**"Complete Guide: AI Lead Scraper + Automation Setup"** and optimised for
finding clients for **[growplus.site](https://growplus.site)** — a Mangalore
agency creating **AI-based cinematic ad videos for brands**.

Paste prospect website URLs → an LLM (gpt-4o-mini) reads each page and
extracts **business name, contact, email, phone, WhatsApp, city, Instagram**,
classifies the **industry**, assigns a **1–10 lead score** for how much that
brand needs a cinematic ad video (visual product, marketing investment,
reachability, weak or missing video content) and writes a one-line
**pitch angle** — a concrete cinematic ad concept for that specific brand.
Sort, filter by industry, export CSV, or push leads straight to an
**n8n webhook** that drives WhatsApp / email / AI-calling outreach.

## What's in this repo

| Path | What it is |
|---|---|
| `app/` | Next.js dashboard (deployed on Vercel) — URL input, live scrape progress, sortable/searchable results table, CSV export, n8n webhook push. Results persist in your browser via localStorage. |
| `app/api/scrape` | Serverless scraper: fetches the page server-side and extracts lead fields with gpt-4o-mini (structured JSON output). |
| `app/api/webhook` | Forwards leads to your n8n webhook server-side (no CORS issues). |
| `scraper/` | The original local Python version from the guide — ScrapeGraphAI + Playwright + SmartScraperMultiGraph, writes `leads.csv`, optionally POSTs each lead to n8n. |

> **Why two scrapers?** Vercel serverless functions can't run Playwright's
> headless browser, so the hosted dashboard uses a plain server-side fetch +
> LLM extraction. For heavy JavaScript-rendered sites, use the local Python
> scraper in `scraper/`, which drives a real headless browser.

## Running the dashboard

### On Vercel (hosted)

1. Import this repo in Vercel (or `vercel --prod` from the repo root)
2. In **Project Settings → Environment Variables**, add:
   - `OPENAI_API_KEY` = your OpenAI API key
3. Redeploy. Done.

### Locally

```bash
npm install
cp .env.example .env.local   # put your real OPENAI_API_KEY inside
npm run dev                  # http://localhost:3000
```

## Running the local Python scraper (ScrapeGraphAI)

```bash
cd scraper
python -m venv venv
venv\Scripts\pip install -r requirements.txt
venv\Scripts\playwright install
copy .env.example .env       # put your real OPENAI_API_KEY inside
# add target URLs to urls.txt, one per line
venv\Scripts\python.exe scrape_leads.py
```

Results land in `scraper/leads.csv`. Set `N8N_WEBHOOK_URL` in `.env` to also
POST each lead to your n8n workflow automatically.

## n8n outreach automation (Part 4 of the guide)

The dashboard's **step 3** POSTs each lead as JSON to your n8n Webhook node:

```json
{
  "business_name": "Kohinoor Property Studio",
  "contact_name": null,
  "email": "info@example.com",
  "phone": "+91 98765 43210",
  "whatsapp": "+91 98765 43210",
  "website": "https://www.kohinoorpropertystudio.in/",
  "city": "Bengaluru",
  "industry": "Real Estate",
  "instagram": "https://instagram.com/kohinoorproperty",
  "lead_score": 8,
  "pitch_angle": "Pitch a 25-second cinematic property film: golden-hour drone-style flyover of their villa project — their listings have no video at all."
}
```

Suggested workflow, per the guide:

1. **Webhook node** (POST) — receives each lead
2. **IF node** — branch on which fields are present
3. **Anthropic / HTTP Request node** — draft a personalized opener
   (e.g. *"Write a short, casual WhatsApp opener to {business_name} in {city}
   introducing AI Trity's automation services. Under 300 characters."*)
4. Branches:
   - has WhatsApp number → **Unipile node** → WhatsApp message
   - has email → **SendGrid node** → email
   - phone only → **HTTP Request → `https://api.vapi.ai/call`** → AI call
5. **HubSpot node** — log the outreach attempt to CRM
6. Toggle the workflow **Active** — the webhook URL is now live

## Cost

ScrapeGraphAI and this dashboard are open source. The only cost is the LLM
call per page — gpt-4o-mini is typically a fraction of a cent per page.

## Responsible use

Scrape only publicly available business information, respect site terms of
service and robots.txt, and comply with applicable anti-spam / data-protection
laws (e.g. consent rules for WhatsApp and email outreach) in your region.
