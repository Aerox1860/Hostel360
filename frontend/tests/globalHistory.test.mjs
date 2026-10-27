import assert from "node:assert/strict";
import test from "node:test";
import { reportDate, reportStatusLabel, reportStatusTone } from "../src/utils/globalHistory.ts";

test("report statuses are displayed clearly without asserting allegations are verified", () => {
  assert.equal(reportStatusLabel("under_review"), "Under Review");
  assert.equal(reportStatusLabel("reported_pending_verification"), "Reported — Verification Pending");
  assert.equal(reportStatusLabel("disputed_by_tenant"), "Disputed by Tenant");
  assert.equal(reportStatusLabel(null), "Status unavailable");
  assert.equal(reportStatusTone("open"), "warning");
  assert.equal(reportStatusTone("unresolved"), "warning");
  assert.equal(reportStatusTone("settled"), "success");
  assert.equal(reportStatusTone("under_review"), "warning");
  assert.equal(reportStatusTone("verified_outstanding"), "neutral");
});

test("missing or malformed report dates do not render as invalid dates", () => {
  assert.equal(reportDate(null), "Date unavailable");
  assert.equal(reportDate("not-a-date"), "Date unavailable");
  assert.notEqual(reportDate("2026-10-25T10:00:00Z"), "Date unavailable");
});
