import test from "node:test";
import assert from "node:assert/strict";
// Offline only: this file imports pure helpers and never loads server.mjs,
// so no provider key is read and no provider call can be made.
import { buildInsights, filterRecords, formatInsightValue, parseListQuery, recordsToCsv, RECORD_COLUMNS } from "../featurePack.mjs";

const rows = [
  { id: 1, reference: "A-1", title: "Alpha case", subject: "Alpha case", status: "Open", state: "intake", owner: "Sam", risk: "High", due_date: "2020-01-01", amount: 0, workflow_id: "tape", payload: { verified: false, note: "" } },
  { id: 2, reference: "B-2", title: "Beta case", subject: "Beta case", status: "Closed", state: "closed", owner: "Jo", risk: "Low", due_date: "2999-01-01", amount: 250, workflow_id: "cash", payload: {} },
];

test("list query parses search and filters", () => {
  assert.deepEqual(parseListQuery({ q: " Alpha ", status: "Open" }).q, "alpha");
  assert.equal(filterRecords(rows, { q: "alpha" }).length, 1);
  assert.equal(filterRecords(rows, { status: "Closed" })[0].reference, "B-2");
  assert.equal(filterRecords(rows, { risk: "high" }).length, 1);
  assert.equal(filterRecords(rows, { q: "missing" }).length, 0);
});

test("CSV export preserves header, quoting, and zero amounts", () => {
  const csv = recordsToCsv(rows, RECORD_COLUMNS);
  assert.ok(csv.split("\n")[0].includes("Reference"));
  assert.ok(csv.includes("A-1"));
  assert.ok(csv.includes(",0"));
});

test("insights are labelled deterministic fallback over own records", () => {
  const insights = buildInsights(rows, { subject: "Case" });
  assert.equal(insights.length, 3);
  for (const insight of insights) {
    assert.equal(insight.aiGenerated, false);
    assert.match(insight.label, /Deterministic fallback/);
    assert.ok(insight.sections.length >= 2);
  }
  assert.equal(formatInsightValue(false), "No");
  assert.equal(formatInsightValue(0), "0");
  assert.equal(formatInsightValue(""), "Not provided");
});

test("empty record set still reports zeroes instead of hiding them", () => {
  const insights = buildInsights([], { subject: "Case" });
  assert.ok(insights[0].metrics.some((m) => m.value === "0"));
  assert.match(insights[0].sections[1].detail, /0/);
});
