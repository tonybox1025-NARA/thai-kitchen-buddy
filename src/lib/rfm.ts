// RFM customer segmentation — the POS's own replacement for MERI's auto-groups.
// Scores each member on Recency (days since last visit) and Frequency (visit count),
// then maps the (R,F) pair to a named segment via a standard 5×5 grid. Monetary
// (spend) is used only as a tie-breaker to nudge borderline members up.
//
// Thresholds are plain constants so they're easy to tune later (per the plan to
// keep MERI-style defaults for now). Everything is derived at display time from the
// combined MERI-seed + live POS activity — nothing is stored, so it never drifts.

export type Segment =
  | "Champions"
  | "Loyal"
  | "Potential Loyalists"
  | "Recent Customers"
  | "Promising"
  | "Need Attention"
  | "About to Sleep"
  | "At Risk"
  | "Can't Lose Them"
  | "Hibernating"
  | "Lost";

// R score (1–5) from days since last visit: fewer days = higher score.
const RECENCY_CUTOFFS: [number, number, number, number] = [14, 30, 90, 180];
// F score (1–5) from visit count: more visits = higher score.
const FREQUENCY_CUTOFFS: [number, number, number, number] = [12, 6, 3, 2];
// Spend (baht) at/above this bumps a borderline member's frequency score up by one.
const MONETARY_BUMP = 5000;

export function recencyScore(daysSinceLastVisit: number): number {
  const [a, b, c, d] = RECENCY_CUTOFFS;
  if (daysSinceLastVisit <= a) return 5;
  if (daysSinceLastVisit <= b) return 4;
  if (daysSinceLastVisit <= c) return 3;
  if (daysSinceLastVisit <= d) return 2;
  return 1;
}

export function frequencyScore(visits: number): number {
  const [a, b, c, d] = FREQUENCY_CUTOFFS;
  if (visits >= a) return 5;
  if (visits >= b) return 4;
  if (visits >= c) return 3;
  if (visits >= d) return 2;
  return 1;
}

// Grid rows = recency score 5→1 (top = most recent), cols = frequency score 1→5.
const GRID: Segment[][] = [
  /* R5 */ ["Recent Customers", "Promising", "Potential Loyalists", "Loyal", "Champions"],
  /* R4 */ ["Promising", "Promising", "Potential Loyalists", "Loyal", "Champions"],
  /* R3 */ ["About to Sleep", "Need Attention", "Need Attention", "Loyal", "Loyal"],
  /* R2 */ ["Hibernating", "About to Sleep", "At Risk", "At Risk", "Can't Lose Them"],
  /* R1 */ ["Lost", "Lost", "At Risk", "Can't Lose Them", "Can't Lose Them"],
];

/** Days between an ISO/`YYYY-MM-DD` date and now. Returns a large number if missing. */
export function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 100000;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 100000;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export function segmentFor(lastVisit: string | null, visits: number, spend: number): Segment {
  const r = recencyScore(daysSince(lastVisit));
  let f = frequencyScore(visits);
  if (spend >= MONETARY_BUMP && f < 5) f += 1; // monetary tie-breaker
  return GRID[5 - r][f - 1];
}
