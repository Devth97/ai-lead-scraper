# Prospect Discovery Workflow

The dashboard qualifies leads but you must bring the URLs. This document
describes the **top-of-funnel discovery** step, driven by an AI agent
(Claude Code) with [Agent-Reach](https://github.com/Panniantong/Agent-Reach)
installed.

## Pipeline

```
1. DISCOVER   Agent finds prospect websites (Exa search / Instagram)
2. QUALIFY    Paste URLs into the Lead Engine → score 1-10 + pitch angle
3. OUTREACH   Push hot leads to n8n → WhatsApp / email / AI call → CRM
```

## Step 1a: Find prospects via Exa semantic search (works today)

Ask the agent things like:

> Find 20 jewellery store websites in Udupi and Mangalore
> Find restaurant and cafe websites in Bengaluru with their own domain
> Find silk saree shop websites in coastal Karnataka

Under the hood the agent runs:

```powershell
mcporter call exa web_search_exa --args '{"query": "jewellery store Mangalore official website", "numResults": 10}'
```

Then it dedupes, drops national chains (Malabar, Tanishq, etc. — not
GrowPlus targets), and hands back a clean URL list to paste into the
dashboard.

## Step 1b: Find prospects via Instagram (needs one-time setup)

Brands active on Instagram but with **no video content** are the hottest
leads for AI cinematic ads. With the OpenCLI browser extension connected,
the agent can run:

```powershell
opencli instagram search "jewellery mangalore" -f yaml   # find accounts
opencli instagram profile SOME_BRAND -f yaml             # bio + website link
opencli instagram user SOME_BRAND --limit 12 -f yaml     # recent posts: photos or reels?
```

The agent checks each account's recent posts — all static photos and no
reels = prime prospect — then pulls the website from the bio for scoring.

**One-time setup (manual, in your own Chrome):**

1. Download the extension from https://github.com/jackwener/opencli/releases
2. Open `chrome://extensions` → enable **Developer Mode** → **Load unpacked**
3. Keep Chrome open and logged in to instagram.com

Notes: cookies stay local. Keep request volume low and human-scale —
automated scraping of logged-in sessions is against Instagram's ToS, so
use this for research, not bulk harvesting.

## Step 2-3: Qualify and reach out

Paste the discovered URLs into the
[Lead Engine](https://ai-lead-scraper-orcin.vercel.app), run the scrape,
filter to score ≥ 8, and send to your n8n webhook. Each lead arrives with
a ready-made cinematic ad concept referencing a matching Grow+ portfolio
reel.
