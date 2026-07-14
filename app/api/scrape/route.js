export const maxDuration = 60;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    business_name: { type: ["string", "null"] },
    contact_name: { type: ["string", "null"] },
    email: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    website: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
  },
  required: ["business_name", "contact_name", "email", "phone", "website", "city"],
  additionalProperties: false,
};

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

// mailto:/tel: links often hold contact info that disappears when tags are stripped
function extractContactHints(html) {
  const hints = new Set();
  for (const m of html.matchAll(/(?:mailto|tel):([^"'\s>?]+)/gi)) hints.add(m[1]);
  return [...hints].slice(0, 20).join(", ");
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

  // 2. Extract structured lead data with gpt-4o-mini
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
          json_schema: { name: "lead", strict: true, schema: EXTRACTION_SCHEMA },
        },
        messages: [
          {
            role: "system",
            content:
              "You extract business lead information from website text. Return the business name, a contact person's name if mentioned, email address, phone number, and the city the business operates in. Use null for anything not found in the text. Never invent values.",
          },
          {
            role: "user",
            content: `Website URL: ${url}\n\nContact links found in page markup: ${contactHints || "none"}\n\nPage text:\n${text}`,
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
    return Response.json({ lead });
  } catch (e) {
    return Response.json({ error: `Extraction failed: ${e.message}` }, { status: 502 });
  }
}
