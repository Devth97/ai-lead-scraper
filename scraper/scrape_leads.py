"""
AI Lead Scraper - local version (ScrapeGraphAI + Playwright).

Reads URLs from urls.txt (one per line), extracts lead info with
gpt-4o-mini via SmartScraperMultiGraph, writes results to leads.csv,
and optionally POSTs each new lead to an n8n webhook.

Setup:
    python -m venv venv
    venv\\Scripts\\pip install -r requirements.txt
    venv\\Scripts\\playwright install
    copy .env.example .env   (then put your real OPENAI_API_KEY inside)

Run:
    venv\\Scripts\\python.exe scrape_leads.py
"""

import csv
import json
import os
import urllib.request

from dotenv import load_dotenv
from scrapegraphai.graphs import SmartScraperMultiGraph

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "").strip()  # optional

if not OPENAI_API_KEY:
    raise SystemExit("Missing OPENAI_API_KEY - create a .env file (see .env.example)")

FIELDS = [
    "business_name",
    "contact_name",
    "email",
    "phone",
    "whatsapp",
    "website",
    "city",
    "industry",
    "instagram",
    "lead_score",
    "pitch_angle",
]

PROMPT = (
    "You qualify sales leads for GrowPlus (growplus.site), an AI automation & creative "
    "agency in Mangalore, Karnataka serving jewellery, food & beverage, real estate and "
    "clothing/fashion brands. Services: AI automation, website development, Reels/content "
    "creation, brand storytelling, social media management, photography & videography. "
    "Extract: business name, contact person name, email, phone, WhatsApp number, website "
    "URL, city, industry (Jewellery / Food & Beverage / Real Estate / Clothing & Fashion / "
    "Other), and Instagram URL if linked. Then add lead_score (1-10 fit for GrowPlus: "
    "target industry +3, Karnataka/South India +2, reachable contact +2, visible gaps like "
    "no social links or weak content +1-3) and pitch_angle (one sentence: which GrowPlus "
    "service to pitch first and why, citing something specific from their site). "
    "Return JSON with keys: business_name, contact_name, email, phone, whatsapp, website, "
    "city, industry, instagram, lead_score, pitch_angle. "
    "Use null for anything not found. Never invent contact details."
)

graph_config = {
    "llm": {
        "api_key": OPENAI_API_KEY,
        "model": "openai/gpt-4o-mini",
        "temperature": 0,
    },
    "verbose": True,
    "headless": True,
}


def load_urls(path="urls.txt"):
    if not os.path.exists(path):
        raise SystemExit(f"{path} not found - add one URL per line")
    with open(path, encoding="utf-8") as f:
        urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    if not urls:
        raise SystemExit("urls.txt is empty - add one URL per line")
    return urls


def post_to_webhook(lead):
    """Bridge to the n8n outreach workflow (Part 4 of the guide)."""
    req = urllib.request.Request(
        N8N_WEBHOOK_URL,
        data=json.dumps(lead).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            print(f"  -> webhook {res.status} for {lead.get('website')}")
    except Exception as e:
        print(f"  -> webhook failed for {lead.get('website')}: {e}")


def main():
    urls = load_urls()
    print(f"Scraping {len(urls)} URL(s)...")

    graph = SmartScraperMultiGraph(prompt=PROMPT, source=urls, config=graph_config)
    result = graph.run()

    # SmartScraperMultiGraph may return a dict or a list depending on version
    if isinstance(result, dict):
        rows = result.get("results") or result.get("leads") or [result]
    else:
        rows = result or []

    leads = []
    for i, row in enumerate(rows):
        lead = {k: (row.get(k) if isinstance(row, dict) else None) for k in FIELDS}
        if not lead["website"] and i < len(urls):
            lead["website"] = urls[i]
        leads.append(lead)

    with open("leads.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(leads)
    print(f"Wrote {len(leads)} lead(s) to leads.csv")

    if N8N_WEBHOOK_URL:
        print("Posting leads to n8n webhook...")
        for lead in leads:
            post_to_webhook(lead)


if __name__ == "__main__":
    main()
