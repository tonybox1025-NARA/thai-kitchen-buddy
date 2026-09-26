import { supabase } from "@/integrations/supabase/client";
import { bangkokDateKey, bangkokDayUtcBounds } from "@/lib/business-day";

export type DashRange = "today" | "yesterday" | "week" | "month" | "ytd" | "custom";

type ShiftRef = {
  id: string;
  business_day: string;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function keyFromDate(date: Date): string {
  return localDateKey(date);
}

async function currentBusinessShift(): Promise<ShiftRef | null> {
  const select = "id,business_day,opened_at,closed_at,status";
  const { data: openRows } = await supabase.from("shifts").select(select)
    .eq("status", "open").order("opened_at", { ascending: false }).limit(1);
  if (openRows?.[0]) return openRows[0] as ShiftRef;

  const { data: latestRows } = await supabase.from("shifts").select(select)
    .order("opened_at", { ascending: false }).limit(1);
  return (latestRows?.[0] as ShiftRef | undefined) ?? null;
}

export function rangeBounds(r: Exclude<DashRange, "custom">): [Date, Date] {
  const now = new Date();
  const s = new Date(now), e = new Date(now);
  e.setHours(23,59,59,999);
  if (r === "today")     { s.setHours(0,0,0,0); }
  else if (r === "yesterday") { s.setDate(s.getDate()-1); s.setHours(0,0,0,0); e.setDate(e.getDate()-1); e.setHours(23,59,59,999); }
  else if (r === "week") { const d=s.getDay()||7; s.setDate(s.getDate()-(d-1)); s.setHours(0,0,0,0); }
  else if (r === "month") { s.setDate(1); s.setHours(0,0,0,0); }
  else                   { s.setMonth(0,1); s.setHours(0,0,0,0); } // ytd: Jan 1 of this year
  return [s, e];
}

/**
 * Returns register shifts covering the requested business-day range.
 *
 * A restaurant day is one register shift (OPEN -> Z CLOSE), not midnight to
 * midnight. "Today" therefore means the currently open shift, or the most
 * recently closed shift before the next register is opened. "Yesterday" means
 * the immediately preceding shift. Calendar ranges use the Bangkok date of
 * shifts.opened_at so legacy rows with a stale business_day cannot leak into
 * the wrong report.
 */
export async function shiftIdsFor(r: DashRange, bounds: [Date, Date]): Promise<string[]> {
  const anchor = await currentBusinessShift();
  if (!anchor) return [];

  if (r === "today") return [anchor.id];

  if (r === "yesterday") {
    const { data } = await supabase.from("shifts").select("id")
      .lt("opened_at", anchor.opened_at)
      .order("opened_at", { ascending: false })
      .limit(1);
    return (data ?? []).map((shift) => shift.id);
  }

  let fromKey: string;
  let toKey: string;
  if (r === "custom") {
    fromKey = localDateKey(bounds[0]);
    toKey = localDateKey(bounds[1]);
  } else {
    const anchorKey = bangkokDateKey(new Date(anchor.opened_at));
    const anchorDate = dateFromKey(anchorKey);
    const start = new Date(anchorDate);
    if (r === "week") {
      const weekday = start.getDay() || 7;
      start.setDate(start.getDate() - (weekday - 1));
    } else if (r === "month") {
      start.setDate(1);
    } else {
      start.setMonth(0, 1);
    }
    fromKey = keyFromDate(start);
    toKey = anchorKey;
  }

  const [openedFrom] = bangkokDayUtcBounds(fromKey);
  const [, openedBefore] = bangkokDayUtcBounds(toKey);
  const { data } = await supabase.from("shifts").select("id")
    .gte("opened_at", openedFrom)
    .lt("opened_at", openedBefore)
    .order("opened_at", { ascending: true });
  return (data ?? []).map((shift) => shift.id);
}

export function rangeLabel(r: DashRange): string {
  return r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "Weekly" : r === "month" ? "Monthly" : r === "ytd" ? "YTD" : "Custom range";
}
