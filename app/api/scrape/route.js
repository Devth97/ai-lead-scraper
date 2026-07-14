export const maxDuration = 60;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    business_name: { type: ["string", "null"] },
    contact_name: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    whatsapp: { type: ["string", "null"] },
    website: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    industry: {
      type: "string",
      enum: ["Jewellery", "Food & Beverage", "Real Estate", "Clothing & Fashion", "Other"],
    },
    instagram: { type: ["string", "null"] },
    lead_score: { type: "integer" },
    pitch_angle: { type: ["string", "null"] },
  },
  required: [
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
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You qualify sales leads for GrowPlus (growplus.site), an agency based in Mangalore, Karnataka, India whose core offer is AI-BASED CINEMATIC AD VIDEOS for brands — premium, film-quality product/brand ads generated with AI, delivered faster and cheaper than a traditional shoot. Strong fits are visual, product-led brands: jewellery, food & beverage, real estate, clothing/silk/fashion, and any consumer brand that markets on Instagram.

From the website text of a prospective client business, extract:
- business_name, contact_name (a person, if mentioned), email, phone, whatsapp (number or wa.me link if present), website, city
- industry: classify into Jewellery / Food & Beverage / Real Estate / Clothing & Fashion / Other
- instagram: their Instagram profile URL if linked
- lead_score (1-10) for how much this brand needs a cinematic AI ad video:
  * +3 if their product is inherently visual (jewellery, food, property, fashion, lifestyle/consumer goods)
  * +2 if they clearly invest in marketing (Instagram/social links, brand-conscious copy, promotions) — they already buy creative, an AI ad is an easy upsell
  * +2 if reachable (has phone/WhatsApp or email)
  * +1-3 if their visual content looks weak or absent: no video, stock-looking or thin imagery, text-heavy pages, outdated design — the before/after of a cinematic ad is dramatic
  * +1 if located in Karnataka or South India (Mangalore, Udupi, Bengaluru, Mysuru, etc.)
  * Cap at 10, floor at 1. A non-visual B2B service with no contact info scores 1-2.
- pitch_angle: ONE short sentence proposing a concrete cinematic AI ad concept for THIS brand, referencing their actual products or positioning (e.g. "Pitch a 20-second cinematic ad: slow-motion macro shots of their bridal gold collection with a festive Diwali storyline." or "Pitch an AI food film: steam rising off their signature ghee roast in dramatic lighting — their site has zero video."). null only if the page has no usable signal.

Use null for anything not found in the text. Never invent contact details.`;

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// mailto:/tel:/wa.me/instagram links often hold contact + social info
// that disappears when tags are stripped
function extractContactHints(html) {
  const hints = new Set();
  for (const m of html.matchAll(/(?:mailto|tel):([^"'\s>?]+)/gi)) hints.add(m[0]);
  for (const m of html.matchAll(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"'\s>]+/gi)) hints.add(m[0]);
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+/gi)) hints.add(m[0]);
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9_.]+/gi)) hints.add(m[0]);
  return [...hints].slice(0, 25).join(", ");
}

export async function POST(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured. Add it in your Vercel project settings (or .env.local for local dev)." },
      { status: 500 }
    );
  }

  let url;
  try {
    ({ url } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!url || typeof url !== "string") {
    return Response.json({ error: "Missing 'url' in request body" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  // 1. Fetch the page
  let html;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      return Response.json({ error: `Site responded with HTTP ${res.status}` }, { status: 502 });
    }
    html = await res.text();
  } catch (e) {
    return Response.json(
      { error: `Could not fetch the site: ${e.name === "TimeoutError" ? "timed out" : e.message}` },
      { status: 502 }
    );
  }

  const text = htmlToText(html).slice(0, 14000);
  const contactHints = extractContactHints(html);

  // 2. Extract + qualify with gpt-4o-mini
  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "growplus_lead", strict: true, schema: EXTRACTION_SCHEMA },
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Website URL: ${url}\n\nContact & social links found in page markup: ${contactHints || "none"}\n\nPage text:\n${text}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.json().catch(() => ({}));
      return Response.json(
        { error: `OpenAI API error (${aiRes.status}): ${errBody?.error?.message || "unknown"}` },
        { status: 502 }
      );
    }

    const data = await aiRes.json();
    const lead = JSON.parse(data.choices[0].message.content);
    lead.website = lead.website || url;
    lead.lead_score = Math.min(10, Math.max(1, lead.lead_score || 1));
    return Response.json({ lead });
  } catch (e) {
    return Response.json({ error: `Extraction failed: ${e.message}` }, { status: 502 });
  }
}
