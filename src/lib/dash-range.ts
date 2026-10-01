import { supabase } from "@/integrations/supabase/client";
import { bangkokDateKey, bangkokDayUtcBounds } from "@/lib/business-day";
import { bkkDateKey, bkkPresetBounds, mondayOfKey, monthStartKey, yearStartKey } from "@/lib/bkk-time";

export type DashRange = "today" | "yesterday" | "week" | "month" | "ytd" | "custom";

type ShiftRef = {
  id: string;
  business_day: string;
  opened_at: string;
  closed_at: string | null;
  status: "open" | "closed";
};

async function currentBusinessShift(): Promise<ShiftRef | null> {
  const select = "id,business_day,opened_at,closed_at,status";
  const { data: openRows } = await supabase.from("shifts").select(select)
    .eq("status", "open").order("opened_at", { ascending: false }).limit(1);
  if (openRows?.[0]) return openRows[0] as ShiftRef;

  const { data: latestRows } = await supabase.from("shifts").select(select)
    .order("opened_at", { ascending: false }).limit(1);
  return (latestRows?.[0] as ShiftRef | undefined) ?? null;
}

/** Bangkok calendar bounds for a preset (UTC instants); independent of device timezone. */
export function rangeBounds(r: Exclude<DashRange, "custom">): [Date, Date] {
  return bkkPresetBounds(r);
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
    // Custom bounds are Bangkok-day instants (see pickerBounds), so read them back in Bangkok.
    fromKey = bkkDateKey(bounds[0]);
    toKey = bkkDateKey(bounds[1]);
  } else {
    const anchorKey = bangkokDateKey(new Date(anchor.opened_at));
    fromKey = r === "week" ? mondayOfKey(anchorKey) : r === "month" ? monthStartKey(anchorKey) : yearStartKey(anchorKey);
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
