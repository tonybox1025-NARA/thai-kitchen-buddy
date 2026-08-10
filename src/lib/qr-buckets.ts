// User-defined time windows for breaking the QR payments total into segments
// (e.g. 11:00–15:00, 15:00–18:00, 18:00–22:00). Configured in Settings › General,
// stored on settings.qr_time_buckets (jsonb), and shown on the QR detail page and
// the X/Z report. Windows are matched by local time-of-day, so they work regardless
// of business day and support a single window that crosses midnight (end ≤ start).

export type QrTimeBucket = { start: string; end: string; label?: string }; // times are "HH:MM"; label is an optional custom name shown on reports

export type QrPayLike = { amount: number; tip: number; at: string };

export type QrBucketTotal = {
  bucket: QrTimeBucket;
  label: string;
  net: number; // sum of payment.amount (excludes tips)
  tips: number; // sum of tip_amount
  gross: number; // net + tips
  count: number;
};

export function bucketLabel(b: QrTimeBucket): string {
  const custom = b.label?.trim();
  return custom ? custom : `${b.start}–${b.end}`;
}

/** Parse "HH:MM" to minutes-of-day, or null if malformed. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function isValidBucket(b: QrTimeBucket): boolean {
  const s = toMinutes(b?.start);
  const e = toMinutes(b?.end);
  return s !== null && e !== null && s !== e;
}

/** Local time-of-day (minutes) for an ISO timestamp, or null if unparseable. */
function minuteOfDay(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

/** True if the timestamp's local time-of-day falls in [start, end).
 *  Supports a window that crosses midnight (end ≤ start), e.g. 22:00–02:00. */
export function inBucket(iso: string, b: QrTimeBucket): boolean {
  const t = minuteOfDay(iso);
  const s = toMinutes(b.start);
  const e = toMinutes(b.end);
  if (t === null || s === null || e === null || s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** Sum QR payments into the given time windows. One item can fall into multiple
 *  windows if the user defines overlapping ranges — that is intentional. */
export function bucketizeQr(pays: QrPayLike[], buckets: QrTimeBucket[]): QrBucketTotal[] {
  return buckets.map((bucket) => {
    let net = 0;
    let tips = 0;
    let count = 0;
    for (const p of pays) {
      if (inBucket(p.at, bucket)) {
        net += p.amount;
        tips += p.tip;
        count += 1;
      }
    }
    return { bucket, label: bucketLabel(bucket), net, tips, gross: net + tips, count };
  });
}

/** Coerce the raw jsonb value from settings into a clean, valid bucket list. */
export function parseBuckets(raw: unknown): QrTimeBucket[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) =>
      x &&
      typeof x === "object" &&
      typeof (x as QrTimeBucket).start === "string" &&
      typeof (x as QrTimeBucket).end === "string"
        ? {
            start: (x as QrTimeBucket).start,
            end: (x as QrTimeBucket).end,
            ...(typeof (x as QrTimeBucket).label === "string"
              ? { label: (x as QrTimeBucket).label }
              : {}),
          }
        : null,
    )
    .filter((b): b is QrTimeBucket => b !== null && isValidBucket(b));
}
