"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const COLUMNS = [
  ["business_name", "Business Name"],
  ["contact_name", "Contact Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["website", "Website"],
  ["city", "City"],
];

const STORAGE_KEY = "ai-lead-scraper:leads";

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = COLUMNS.map(([k]) => k).join(",");
  const body = rows.map((r) => COLUMNS.map(([k]) => esc(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}

export default function Home() {
  const [urlText, setUrlText] = useState("");
  const [leads, setLeads] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [log, setLog] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState(null);
  const [sendingWebhook, setSendingWebhook] = useState(false);
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

  async function runScrape() {
    if (urls.length === 0 || running) return;
    setRunning(true);
    stopRef.current = false;
    setLog([]);
    setProgress({ done: 0, total: urls.length, current: urls[0] });

    for (let i = 0; i < urls.length; i++) {
      if (stopRef.current) break;
      const url = urls[i];
      setProgress({ done: i, total: urls.length, current: url });
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
        setLog((prev) => [...prev, { ok: true, msg: `✓ ${url} — ${lead.business_name || "extracted"}` }]);
      } catch (e) {
        setLog((prev) => [...prev, { ok: false, msg: `✗ ${url} — ${e.message}` }]);
      }
      setProgress({ done: i + 1, total: urls.length, current: url });
    }
    setRunning(false);
    setProgress((p) => ({ ...p, current: "" }));
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUrlText((t) => (t ? t + "\n" : "") + reader.result);
    reader.readAsText(file);
    e.target.value = "";
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = q
      ? leads.filter((l) => COLUMNS.some(([k]) => String(l[k] ?? "").toLowerCase().includes(q)))
      : [...leads];
    if (sort.key) {
      rows.sort((a, b) => {
        const av = String(a[sort.key] ?? "").toLowerCase();
        const bv = String(b[sort.key] ?? "").toLowerCase();
        if (av === bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -sort.dir : sort.dir;
      });
    }
    return rows;
  }, [leads, search, sort]);

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "leads.csv";
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
          <div className="logo-mark">AT</div>
          <div className="logo-text">
            AI <span>Trity</span> · Lead Scraper
          </div>
          <div className="topbar-tag">gpt-4o-mini powered</div>
        </div>
      </div>

      <div className="container">
        <div className="hero">
          <h1>AI Lead Scraper</h1>
          <p>
            Paste website URLs below. The AI reads each page and extracts business name, contact,
            email, phone and city — no CSS selectors needed. Export as CSV or push straight into
            your n8n outreach automation.
          </p>
        </div>

        {/* Step 1: URLs */}
        <div className="card">
          <h2>
            <span className="step-num">1</span> Add website URLs
          </h2>
          <p className="hint">One URL per line (or comma/space separated). You can also upload a .txt / .csv file.</p>
          <textarea
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            placeholder={"https://www.kohinoorpropertystudio.in/\nhttps://shivaproperty.in/"}
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
            <span className="step-num">2</span> Leads
          </h2>
          <p className="hint">Click a column header to sort. Results persist in your browser between runs.</p>
          <div className="table-toolbar">
            <input
              type="text"
              placeholder="Search leads…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
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
                  ? "No leads yet — add URLs above and hit Run Scrape."
                  : "No leads match your search."}
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
                      <td>{l.business_name || <span className="muted">—</span>}</td>
                      <td>{l.contact_name || <span className="muted">—</span>}</td>
                      <td>
                        {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : <span className="muted">—</span>}
                      </td>
                      <td>
                        {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : <span className="muted">—</span>}
                      </td>
                      <td>
                        {l.website ? (
                          <a href={l.website} target="_blank" rel="noreferrer">
                            {l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                          </a>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{l.city || <span className="muted">—</span>}</td>
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
            <span className="step-num">3</span> Push to n8n outreach automation
          </h2>
          <p className="hint">
            Paste your n8n Webhook node URL. Each lead is POSTed as JSON — your workflow branches to
            WhatsApp (Unipile), email (SendGrid) or an AI call (Vapi), then logs to CRM.
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
          AI Trity · Lead scraping + outreach automation ·{" "}
          <a href="https://github.com/ScrapeGraphAI/Scrapegraph-ai" target="_blank" rel="noreferrer">
            local Python scraper included in repo
          </a>
        </footer>
      </div>
    </>
  );
}
