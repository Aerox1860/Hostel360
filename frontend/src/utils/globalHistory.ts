export function reportStatusLabel(status?: string | null) {
  if (!status) return "Status unavailable";
  const labels: Record<string, string> = {
    reported_pending_verification: "Reported — Verification Pending",
    under_review: "Under Review",
    verified_outstanding: "Verified Outstanding",
    disputed_by_tenant: "Disputed by Tenant",
    partially_settled: "Partially Settled",
    resolved_paid: "Resolved / Paid",
    rejected: "Rejected",
  };
  if (labels[status]) return labels[status];
  return status.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function reportStatusTone(status?: string | null): "warning" | "success" | "neutral" {
  if (status && /^(reported_pending_verification|under_review|disputed_by_tenant|partially_settled)$/.test(status)) return "warning";
  if (status && /^(verified_outstanding)$/.test(status)) return "neutral";
  if (status && /^(resolved_paid|rejected)$/.test(status)) return "success";
  if (status && /\b(open|pending|unresolved)\b/i.test(status.replace(/[_-]+/g, " "))) return "warning";
  if (status && /\b(resolved|settled|closed)\b/i.test(status.replace(/[_-]+/g, " "))) return "success";
  return "neutral";
}

export function reportDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString();
}
