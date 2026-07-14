export const maxDuration = 60;

// Forwards leads to an n8n webhook server-side, one POST per lead,
// so the browser never hits CORS restrictions on the n8n instance.
export async function POST(request) {
  let webhookUrl, leads;
  try {
    ({ webhookUrl, leads } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!webhookUrl || !/^https?:\/\//i.test(webhookUrl)) {
    return Response.json({ error: "A valid webhook URL is required" }, { status: 400 });
  }
  if (!Array.isArray(leads) || leads.length === 0) {
    return Response.json({ error: "No leads to send" }, { status: 400 });
  }

  let sent = 0;
  const failures = [];
  for (const lead of leads) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) sent++;
      else failures.push(`${lead.website || "lead"}: HTTP ${res.status}`);
    } catch (e) {
      failures.push(`${lead.website || "lead"}: ${e.message}`);
    }
  }

  return Response.json({ sent, total: leads.length, failures });
}
