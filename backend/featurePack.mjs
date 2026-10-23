// Feature pack: main-list search/filter, CSV/JSON export, and deterministic
// insights computed only from this app's own records. No provider call is made
// in this module; every insight is labelled aiGenerated:false.
export const FALLBACK_LABEL = "Deterministic fallback — not AI-generated";

export function formatInsightValue(value) {
  if (value === false) return "No";
  if (value === true) return "Yes";
  if (value === 0) return "0";
  if (value === null || value === undefined || value === "") return "Not provided";
  return String(value);
}

export function parseListQuery(query = {}) {
  return {
    q: String(query.q || "").trim().toLowerCase(),
    status: String(query.status || query.state || "").trim(),
    risk: String(query.risk || "").trim(),
    workflow: String(query.workflow || "").trim(),
  };
}

export function filterRecords(rows, query = {}) {
  const { q, status, risk, workflow } = parseListQuery(query);
  return (rows || []).filter((row) => {
    if (workflow && String(row.workflow_id || "") !== workflow) return false;
    const state = String(row.status ?? row.state ?? "");
    if (status && state.toLowerCase() !== status.toLowerCase()) return false;
    if (risk && String(row.risk || "").toLowerCase() !== risk.toLowerCase()) return false;
    if (!q) return true;
    const haystack = [row.reference, row.title, row.subject, row.owner, row.status, row.state, row.risk, row.payload ? JSON.stringify(row.payload) : ""].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function recordsToCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(",");
  const lines = (rows || []).map((row) => columns.map((c) => csvCell(typeof c.value === "function" ? c.value(row) : row[c.key])).join(","));
  return [header, ...lines].join("\n") + "\n";
}

const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function buildInsights(rows, { subject = "Records", names, disclaimer = null } = {}) {
  const list = rows || [];
  const closed = new Set(["Approved", "Closed", "approved", "closed"]);
  const open = list.filter((r) => !closed.has(String(r.status ?? r.state ?? "")));
  const highRisk = list.filter((r) => ["High", "Critical"].includes(String(r.risk || "")));
  const totalValue = list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((r) => r.due_date && String(r.due_date).slice(0, 10) < today);
  const top = [...open].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 5);
  const titles = names || [`${subject} exposure summary`, `${subject} risk triage`, `${subject} follow-up queue`];
  const wrap = (id, title, summary, metrics, sections, actions) => ({
    id, title, summary, aiGenerated: false, source: "deterministic-fallback", label: FALLBACK_LABEL,
    ...(disclaimer ? { disclaimer } : {}),
    metrics: metrics.map(([label, value]) => ({ label, value: formatInsightValue(value) })),
    sections, actions,
  });
  return [
    wrap("exposure-summary", titles[0],
      `${list.length} ${subject} record(s) represent ${money(totalValue)}; ${open.length} remain open and ${highRisk.length} are high risk.`,
      [["Records reviewed", list.length], ["Total represented value", money(totalValue)], ["Open records", open.length], ["High-risk records", highRisk.length], ["Any high-risk records", highRisk.length > 0]],
      [{ title: "What was measured", detail: `Counts and represented value were calculated directly from ${list.length} stored ${subject} record(s). A count of 0 means no matching records were stored.` },
       { title: "Coverage", detail: list.length ? `All ${list.length} record(s) for this list were included; no external data was used.` : "No records were stored for this list, so every count above is 0." }],
      ["Validate the largest open records first", "Confirm source evidence for high-value items"]),
    wrap("risk-triage", titles[1],
      `${highRisk.length} high-risk and ${overdue.length} overdue open record(s) need reviewer attention.`,
      [["High-risk records", highRisk.length], ["Overdue open records", overdue.length], ["Overdue present", overdue.length > 0]],
      [{ title: "Triage rule", detail: "Records flagged High or Critical risk, plus open records past their due date, are listed first. Flags are read from stored records and are not re-scored." },
       { title: "Attention queue", detail: top.length ? top.map((r) => `${r.reference || r.id}: ${r.title || r.subject || "Untitled"} (${r.risk || "risk not set"}, ${money(r.amount)})`).join("; ") : "Queue is empty: 0 open records." }],
      highRisk.length ? ["Assign each high-risk record to its accountable owner", "Record the disposition in the workflow"] : ["No high-risk follow-up is required from current records"]),
    wrap("follow-up-queue", titles[2],
      top.length ? `${top.length} open record(s) form the next follow-up queue, ordered by represented value.` : "Follow-up queue is empty: 0 open records.",
      [["Queued records", top.length], ["Largest queued value", top.length ? money(top[0].amount) : 0], ["Queue empty", top.length === 0]],
      [{ title: "Queue order", detail: top.length ? top.map((r, i) => `${i + 1}. ${r.reference || r.id} — ${r.title || r.subject || "Untitled"} — ${money(r.amount)} — due ${r.due_date ? String(r.due_date).slice(0, 10) : "Not provided"}`).join("\n") : "No open records, so the queue is empty." },
       { title: "Preserved values", detail: "Amounts of 0, empty notes, and No flags from stored records are shown as 0, Not provided, and No rather than being hidden." }],
      ["Work the queue in order", "Update each record status after review"]),
  ];
}

export const RECORD_COLUMNS = [
  { key: "reference", label: "Reference" }, { key: "title", label: "Title" }, { key: "status", label: "Status" },
  { key: "owner", label: "Owner" }, { key: "risk", label: "Risk" },
  { key: "due_date", label: "Due date", value: (r) => (r.due_date ? String(r.due_date).slice(0, 10) : "") },
  { key: "amount", label: "Amount" },
];

export function mountFeaturePack(app, { pool, auth, featureById, domain = {} }) {
  if (typeof auth !== "function") throw new Error("mountFeaturePack requires the auth middleware");
  app.get("/api/features/:id/export", auth, async (req, res, next) => {
    try {
      const feature = featureById(req.params.id);
      const rows = filterRecords((await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC", [feature.id])).rows, req.query);
      if (String(req.query.format || "json").toLowerCase() === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${feature.id}-records.csv"`);
        return res.send(recordsToCsv(rows, RECORD_COLUMNS));
      }
      return res.json({ featureId: feature.id, count: rows.length, filters: parseListQuery(req.query), items: rows });
    } catch (error) { return next(error); }
  });
  app.get("/api/features/:id/insights", auth, async (req, res, next) => {
    try {
      const feature = featureById(req.params.id);
      const rows = (await pool.query("SELECT * FROM feature_records WHERE feature_id=$1 ORDER BY updated_at DESC,id DESC", [feature.id])).rows;
      return res.json({ featureId: feature.id, aiGenerated: false, source: "deterministic-fallback", label: FALLBACK_LABEL, insights: buildInsights(rows, { subject: feature.title, names: domain.names, disclaimer: domain.disclaimer || null }) });
    } catch (error) { return next(error); }
  });
}
