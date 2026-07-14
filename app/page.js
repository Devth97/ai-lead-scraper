"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const COLUMNS = [
  ["business_name", "Business"],
  ["industry", "Industry"],
  ["lead_score", "Score"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["whatsapp", "WhatsApp"],
  ["city", "City"],
  ["website", "Website"],
  ["pitch_angle", "Pitch Angle"],
];

// CSV keeps every field, including ones not shown as table columns
const CSV_FIELDS = [
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
  "scraped_at",
];

const STORAGE_KEY = "ai-lead-scraper:leads";

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_FIELDS.join(",");
  const body = rows.map((r) => CSV_FIELDS.map((k) => esc(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}

function scoreClass(score) {
  if (score >= 8) return "score-hot";
  if (score >= 5) return "score-warm";
  return "score-cold";
}

export default function Home() {
  const [urlText, setUrlText] = useState("");
  const [leads, setLeads] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [log, setLog] = useState([]);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [sort, setSort] = useState({ key: "lead_score", dir: -1 });
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [sendingWebhook, setSendingWebhook] = useState(false);
  // discovery
  const [discIndustry, setDiscIndustry] = useState("Jewellery");
  const [discLocation, setDiscLocation] = useState("");
  const [discCount, setDiscCount] = useState(12);
  const [discovering, setDiscovering] = useState(false);
  const [discStatus, setDiscStatus] = useState(null);
  const stopRef = useRef(false);

  // persist results between runs
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setLeads(JSON.parse(saved));
      const savedHook = localStorage.getItem(STORAGE_KEY + ":webhook");
      if (savedHook) setWebhookUrl(savedHook);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
    } catch {}
  }, [leads]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY + ":webhook", webhookUrl);
    } catch {}
  }, [webhookUrl]);

  const urls = useMemo(
    () =>
      [...new Set(
        urlText
          .split(/[\n,\s]+/)
          .map((u) => u.trim())
          .filter((u) => u.length > 3 && u.includes("."))
      )],
    [urlText]
  );

  async function runScrape(urlList) {
    const list = urlList && urlList.length ? urlList : urls;
    if (list.length === 0 || running) return;
    setRunning(true);
    stopRef.current = false;
    setLog([]);
    setProgress({ done: 0, total: list.length, current: list[0] });

    for (let i = 0; i < list.length; i++) {
      if (stopRef.current) break;
      const url = list[i];
      setProgress({ done: i, total: list.length, current: url });
      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const lead = { ...data.lead, scraped_at: new Date().toISOString() };
        setLeads((prev) => {
          const rest = prev.filter((l) => l.website !== lead.website);
          return [lead, ...rest];
        });
        setLog((prev) => [
          ...prev,
          { ok: true, msg: `✓ ${url} — ${lead.business_name || "extracted"} (score ${lead.lead_score}/10)` },
        ]);
      } catch (e) {
        setLog((prev) => [...prev, { ok: false, msg: `✗ ${url} — ${e.message}` }]);
      }
      setProgress({ done: i + 1, total: list.length, current: url });
    }
    setRunning(false);
    setProgress((p) => ({ ...p, current: "" }));
  }

  // Find prospects automatically, then qualify them in one shot — no pasting.
  async function discoverAndQualify() {
    if (discovering || running || !discLocation.trim()) return;
    setDiscovering(true);
    setDiscStatus({ ok: true, msg: "Searching the web for matching businesses…" });
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ industry: discIndustry, location: discLocation, count: discCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const found = (data.results || []).map((r) => r.website);
      if (found.length === 0) {
        setDiscStatus({ ok: false, msg: data.note || "No businesses found — try a broader location." });
        setDiscovering(false);
        return;
      }
      // show what was found in the URL box too, so it's transparent + reusable
      setUrlText([...new Set(found)].join("\n"));
      setDiscStatus({
        ok: true,
        msg: `Found ${found.length} prospect${found.length === 1 ? "" : "s"} — qualifying now…`,
      });
      setDiscovering(false);
      await runScrape(found);
    } catch (e) {
      setDiscStatus({ ok: false, msg: `Discovery failed: ${e.message}` });
      setDiscovering(false);
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUrlText((t) => (t ? t + "\n" : "") + reader.result);
    reader.readAsText(file);
    e.target.value = "";
  }

  const industries = useMemo(() => {
    const set = new Set(leads.map((l) => l.industry).filter(Boolean));
    return ["All", ...set];
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = leads.filter((l) => {
      if (industryFilter !== "All" && l.industry !== industryFilter) return false;
      if (!q) return true;
      return CSV_FIELDS.some((k) => String(l[k] ?? "").toLowerCase().includes(q));
    });
    if (sort.key) {
      rows.sort((a, b) => {
        if (sort.key === "lead_score") {
          return ((a.lead_score ?? 0) - (b.lead_score ?? 0)) * sort.dir;
        }
        const av = String(a[sort.key] ?? "").toLowerCase();
        const bv = String(b[sort.key] ?? "").toLowerCase();
        if (av === bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -sort.dir : sort.dir;
      });
    }
    return rows;
  }, [leads, search, sort, industryFilter]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "lead_score" ? -1 : 1 }));
  }

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "growplus-leads.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function sendToWebhook() {
    if (!webhookUrl || filtered.length === 0 || sendingWebhook) return;
    setSendingWebhook(true);
    setWebhookStatus(null);
    try {
      const res = await fetch("/api/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl, leads: filtered }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setWebhookStatus({
        ok: data.failures.length === 0,
        msg:
          `Sent ${data.sent}/${data.total} leads to n8n.` +
          (data.failures.length ? ` Failures: ${data.failures.slice(0, 3).join("; ")}` : ""),
      });
    } catch (e) {
      setWebhookStatus({ ok: false, msg: `Failed: ${e.message}` });
    }
    setSendingWebhook(false);
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <div className="logo-mark">G+</div>
          <div className="logo-text">
            Grow<span>Plus</span> · Lead Engine
          </div>
          <div className="topbar-tag">AI Based Ads · Scale Smarter. Grow Faster.</div>
        </div>
      </div>

      <div className="container">
        <div className="hero">
          <h1>GrowPlus Lead Engine</h1>
          <p>
            Find brands that need an AI cinematic ad video. Tell it an industry and a city and it
            <strong> finds real local businesses for you</strong>, then the AI extracts contacts,
            classifies the industry, scores each lead 1–10 on how badly they need a cinematic ad,
            and drafts a concrete ad concept to pitch — then push the hot ones straight into your
            n8n outreach automation.
          </p>
        </div>

        {/* Step 1: Auto-discover */}
        <div className="card card-accent">
          <h2>
            <span className="step-num">1</span> Find prospects automatically
          </h2>
          <p className="hint">
            No pasting needed — pick an industry and type a city or area. It searches the web for
            real local businesses with their own websites, then qualifies each one below.
          </p>
          <div className="discover-grid">
            <div className="field">
              <label>Industry</label>
              <input
                type="text"
                list="industry-options"
                value={discIndustry}
                onChange={(e) => setDiscIndustry(e.target.value)}
                placeholder="e.g. Jewellery"
                disabled={discovering || running}
              />
              <datalist id="industry-options">
                <option value="Jewellery" />
                <option value="Restaurants & cafes" />
                <option value="Packaged food brands" />
                <option value="Real estate builders" />
                <option value="Silk & saree stores" />
                <option value="Clothing & fashion brands" />
                <option value="Footwear brands" />
                <option value="Salons & spas" />
              </datalist>
            </div>
            <div className="field">
              <label>City / area</label>
              <input
                type="text"
                value={discLocation}
                onChange={(e) => setDiscLocation(e.target.value)}
                placeholder="e.g. Mangalore, Udupi"
                disabled={discovering || running}
                onKeyDown={(e) => e.key === "Enter" && discoverAndQualify()}
              />
            </div>
            <div className="field field-narrow">
              <label>How many</label>
              <input
                type="number"
                min="1"
                max="25"
                value={discCount}
                onChange={(e) => setDiscCount(e.target.value)}
                disabled={discovering || running}
              />
            </div>
          </div>
          <div className="row">
            <button
              className="btn btn-primary"
              onClick={discoverAndQualify}
              disabled={discovering || running || !discLocation.trim() || !discIndustry.trim()}
            >
              {discovering ? (
                <>
                  <span className="spinner" /> Finding…
                </>
              ) : (
                <>🔎 Find &amp; qualify leads</>
              )}
            </button>
            {discStatus && (
              <span className={`disc-status ${discStatus.ok ? "ok" : "err"}`}>{discStatus.msg}</span>
            )}
          </div>
        </div>

        {/* Step 2: URLs */}
        <div className="card">
          <h2>
            <span className="step-num">2</span> …or add prospect websites yourself
          </h2>
          <p className="hint">
            Optional — paste URLs (one per line, or comma/space separated) or upload a .txt / .csv
            file. Discovered prospects also land here so you can review or re-run them.
          </p>
          <textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={"https://some-jeweller-in-mangalore.in/\nhttps://some-cafe-in-udupi.com/\nhttps://some-builder-in-bengaluru.in/"}
            disabled={running}
          />
          <div className="row">
            <button className="btn btn-primary" onClick={runScrape} disabled={running || urls.length === 0}>
              {running ? (
                <>
                  <span className="spinner" /> Scraping…
                </>
              ) : (
                <>▶ Run Scrape{urls.length > 0 ? ` (${urls.length} URL${urls.length > 1 ? "s" : ""})` : ""}</>
              )}
            </button>
            {running && (
              <button className="btn btn-plain" onClick={() => (stopRef.current = true)}>
                ■ Stop
              </button>
            )}
            <label className="file-label">
              ⬆ Upload URL file
              <input type="file" accept=".txt,.csv" onChange={handleFile} disabled={running} />
            </label>
          </div>

          {(running || log.length > 0) && (
            <div className="status-box">
              {running ? (
                <div className="status-line">
                  <span className="spinner" />
                  Processing {progress.done + 1} of {progress.total}: <strong>{progress.current}</strong>
                </div>
              ) : (
                <div className="status-line">
                  Finished — {log.filter((l) => l.ok).length} succeeded, {log.filter((l) => !l.ok).length} failed.
                </div>
              )}
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="log">
                {log.map((l, i) => (
                  <div key={i} className={l.ok ? "ok" : "err"}>
                    {l.msg}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Results */}
        <div className="card">
          <h2>
            <span className="step-num">3</span> Qualified leads
          </h2>
          <p className="hint">
            Sorted by ad-video fit score by default — <strong>8–10 hot</strong>, 5–7 warm, 1–4 cold.
            The pitch angle is a ready-made cinematic ad concept for that brand, with a matching
            Grow+ portfolio reel to attach as proof where one fits. Click any column header to
            re-sort. Results persist in your browser between runs.
          </p>
          <div className="table-toolbar">
            <input
              type="text"
              placeholder="Search leads…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {industries.length > 2 && (
              <select
                className="industry-select"
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
              >
                {industries.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind === "All" ? "All industries" : ind}
                  </option>
                ))}
              </select>
            )}
            <span className="count-pill">
              {filtered.length} lead{filtered.length === 1 ? "" : "s"}
            </span>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}>
              ⬇ Export CSV
            </button>
            <button
              className="btn btn-plain"
              onClick={() => {
                if (confirm("Clear all stored leads?")) setLeads([]);
              }}
              disabled={leads.length === 0}
            >
              Clear
            </button>
          </div>

          <div className="table-wrap">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="big">🎯</div>
                {leads.length === 0
                  ? "No leads yet — add prospect URLs above and hit Run Scrape."
                  : "No leads match your filters."}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    {COLUMNS.map(([key, label]) => (
                      <th key={key} onClick={() => toggleSort(key)}>
                        {label}
                        {sort.key === key && <span className="arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l, i) => (
                    <tr key={(l.website || "") + i}>
                      <td>
                        <strong>{l.business_name || <span className="muted">—</span>}</strong>
                        {l.contact_name && <div className="sub">{l.contact_name}</div>}
                        {l.instagram && (
                          <div className="sub">
                            <a href={l.instagram} target="_blank" rel="noreferrer">
                              Instagram ↗
                            </a>
                          </div>
                        )}
                      </td>
                      <td>{l.industry || <span className="muted">—</span>}</td>
                      <td>
                        {l.lead_score != null ? (
                          <span className={`score-badge ${scoreClass(l.lead_score)}`}>{l.lead_score}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : <span className="muted">—</span>}
                      </td>
                      <td>
                        {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : <span className="muted">—</span>}
                      </td>
                      <td>
                        {l.whatsapp ? (
                          <a
                            href={
                              /^https?:/i.test(l.whatsapp)
                                ? l.whatsapp
                                : `https://wa.me/${String(l.whatsapp).replace(/[^\d]/g, "")}`
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            {String(l.whatsapp).replace(/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//i, "")}
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{l.city || <span className="muted">—</span>}</td>
                      <td>
                        {l.website ? (
                          <a href={l.website} target="_blank" rel="noreferrer">
                            {l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="pitch-cell">{l.pitch_angle || <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Step 3: n8n webhook */}
        <div className="card">
          <h2>
            <span className="step-num">4</span> Push to n8n outreach automation
          </h2>
          <p className="hint">
            Paste your n8n Webhook node URL. Each lead is POSTed as JSON with its score and ad
            concept, so your workflow can prioritise hot leads and open with the pitch angle in
            the WhatsApp (Unipile) or email (SendGrid) message, or brief the AI caller (Vapi) —
            then log to CRM. Tip: filter to one industry first to send a targeted batch.
          </p>
          <div className="row" style={{ marginTop: 0 }}>
            <input
              type="url"
              style={{ flex: 1, minWidth: 260 }}
              placeholder="https://your-n8n-instance/webhook/lead-intake"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={sendToWebhook}
              disabled={!webhookUrl || filtered.length === 0 || sendingWebhook}
            >
              {sendingWebhook ? (
                <>
                  <span className="spinner" /> Sending…
                </>
              ) : (
                <>⚡ Send {filtered.length} lead{filtered.length === 1 ? "" : "s"}</>
              )}
            </button>
          </div>
          {webhookStatus && (
            <div className={`webhook-result ${webhookStatus.ok ? "ok" : "err"}`}>{webhookStatus.msg}</div>
          )}
        </div>

        <footer>
          Built for{" "}
          <a href="https://growplus.site" target="_blank" rel="noreferrer">
            growplus.site
          </a>{" "}
          ·{" "}
          <a href="https://www.instagram.com/grow.plus_/" target="_blank" rel="noreferrer">
            @grow.plus_
          </a>{" "}
          · AI cinematic ad videos for brands ·{" "}
          <a href="https://github.com/Devth97/ai-lead-scraper" target="_blank" rel="noreferrer">
            source
          </a>
        </footer>
      </div>
    </>
  );
}
