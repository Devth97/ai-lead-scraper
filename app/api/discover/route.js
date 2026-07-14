export const maxDuration = 60;

// Domains that are directories/aggregators/social, not a brand's own site —
// we want the business's real website, so these are filtered out.
const BLOCKED_HOSTS = [
  "justdial.com",
  "sulekha.com",
  "indiamart.com",
  "tradeindia.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linkedin.com",
  "yelp.com",
  "tripadvisor.com",
  "zomato.com",
  "swiggy.com",
  "google.com",
  "maps.google.com",
  "wikipedia.org",
  "amazon.in",
  "flipkart.com",
  "99acres.com",
  "magicbricks.com",
  "housing.com",
];

// National chains that aren't a fit for a boutique agency's outreach.
const BLOCKED_NAME_PARTS = [
  "malabar",
  "tanishq",
  "kalyan",
  "joyalukkas",
  "reliance",
  "titan",
  "caratlane",
  "pc jeweller",
  "senco",
];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export async function POST(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured. Add it in your Vercel project settings." },
      { status: 500 }
    );
  }

  let industry, location, count;
  try {
    ({ industry, location, count } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  industry = (industry || "").trim();
  location = (location || "").trim();
  count = Math.min(Math.max(parseInt(count) || 12, 1), 25);
  if (!industry || !location) {
    return Response.json({ error: "Both an industry and a location are required." }, { status: 400 });
  }

  const prompt = `Use web search to find ${count} REAL, individual (non-chain) ${industry} businesses based in or around ${location}, India that have their OWN website.

For each, give the exact homepage URL of their own website (not a directory, social media, or marketplace listing). Prefer small and mid-size local businesses — skip large national chains.

Respond with ONLY a JSON object of this exact shape, no prose:
{"businesses": [{"name": "Business Name", "website": "https://their-own-site.com", "city": "City"}]}

Only include a business if you found an actual website URL for it in your search results. If you cannot find ${count}, return fewer rather than inventing any.`;

  let resp;
  try {
    resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: prompt,
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch (e) {
    return Response.json(
      { error: `Discovery request failed: ${e.name === "TimeoutError" ? "timed out" : e.message}` },
      { status: 502 }
    );
  }

  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    return Response.json(
      { error: `OpenAI web search error (${resp.status}): ${errBody?.error?.message || "unknown"}` },
      { status: 502 }
    );
  }

  const data = await resp.json();

  // Pull the assistant's text output out of the Responses API shape
  let text = data.output_text || "";
  const citationUrls = new Set();
  if (!text && Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.type === "output_text") text += c.text || "";
          for (const ann of c.annotations || []) {
            if (ann.url) citationUrls.add(ann.url);
          }
        }
      }
    }
  }

  // Parse the JSON the model returned (tolerate code fences / surrounding prose)
  let businesses = [];
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) businesses = JSON.parse(match[0]).businesses || [];
  } catch {
    businesses = [];
  }

  // Clean, filter, dedupe
  const seen = new Set();
  const results = [];
  for (const b of businesses) {
    let url = (b.website || "").trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const host = hostOf(url);
    if (!host || BLOCKED_HOSTS.some((h) => host === h || host.endsWith("." + h))) continue;
    const nameLower = (b.name || "").toLowerCase();
    if (BLOCKED_NAME_PARTS.some((p) => nameLower.includes(p))) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    results.push({ name: b.name || host, website: url, city: b.city || location });
  }

  return Response.json({
    results,
    count: results.length,
    note: results.length === 0 ? "No individual business websites found — try a broader location or different wording." : undefined,
  });
}
