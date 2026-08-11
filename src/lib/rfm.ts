// RFM customer segmentation — the POS's own replacement for MERI DotDash's groups.
//
// Calibrated (Aug 2026) against MERI's own labels on the imported member base to
// ~99.3% row-level agreement, so the POS shows the same segments MERI does while
// MERI is still running in parallel. MERI's scheme here is essentially:
//   • a few very-frequent customers → Champions / Potential Loyalists / Need Attention
//   • everyone else banded by recency → Recent Customers / Promising / About to Sleep / Lost
//   • members who never really visited (0 visits) → Lost
//
// All thresholds are plain constants — tune them here as MERI is retired. Inputs are
// the member's combined MERI-seed + live POS activity, derived at display time, so
// nothing is stored and nothing drifts.

export type Segment =
  | "Champions"
  | "Potential Loyalists"
  | "Need Attention"
  | "Recent Customers"
  | "Promising"
  | "About to Sleep"
  | "Lost";

// ── Tunable thresholds ───────────────────────────────────────────────────────
// Frequent ("elite") customers, classified by recency:
const CHAMPION_MIN_VISITS = 40;
const CHAMPION_MAX_RECENCY = 15;      // days
const FREQUENT_MIN_VISITS = 18;
const FREQUENT_RECENT_RECENCY = 60;   // ≤ → Potential Loyalists; beyond (but active) → Need Attention
const ACTIVE_MAX_RECENCY = 180;       // past this, even frequent customers count as Lost
// Recency bands (days) for ordinary (low-frequency) members:
const RECENT_MAX = 60;                // < → Recent Customers
const PROMISING_MAX = 118;            // < → Promising
const SLEEP_MAX = 177;                // < → About to Sleep; else Lost

/** Whole days between a date (`YYYY-MM-DD` or ISO) and now; large if missing. */
export function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 100000;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 100000;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export function segmentFor(lastVisit: string | null, visits: number): Segment {
  const rec = daysSince(lastVisit);
  const v = Math.max(0, Math.round(visits));

  if (v >= CHAMPION_MIN_VISITS && rec <= CHAMPION_MAX_RECENCY) return "Champions";
  if (v >= FREQUENT_MIN_VISITS && rec <= FREQUENT_RECENT_RECENCY) return "Potential Loyalists";
  if (v >= FREQUENT_MIN_VISITS && rec < ACTIVE_MAX_RECENCY) return "Need Attention";

  if (v === 0) return "Lost";
  if (rec < RECENT_MAX) return "Recent Customers";
  if (rec < PROMISING_MAX) return "Promising";
  if (rec < SLEEP_MAX) return "About to Sleep";
  return "Lost";
}
