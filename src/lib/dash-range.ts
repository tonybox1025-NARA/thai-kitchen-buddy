import { supabase } from "@/integrations/supabase/client";

export type DashRange = "today" | "yesterday" | "week" | "month" | "custom";

export function rangeBounds(r: Exclude<DashRange, "custom">): [Date, Date] {
  const now = new Date();
  const s = new Date(now), e = new Date(now);
  if (r === "today")     { s.setHours(0,0,0,0); e.setHours(23,59,59,999); }
  else if (r === "yesterday") { s.setDate(s.getDate()-1); s.setHours(0,0,0,0); e.setDate(e.getDate()-1); e.setHours(23,59,59,999); }
  else if (r === "week") { const d=s.getDay()||7; s.setDate(s.getDate()-(d-1)); s.setHours(0,0,0,0); e.setHours(23,59,59,999); }
  else                   { s.setDate(1); s.setHours(0,0,0,0); e.setHours(23,59,59,999); }
  return [s, e];
}

/** Returns shift IDs covering the given range. */
export async function shiftIdsFor(r: DashRange, bounds: [Date, Date]): Promise<string[]> {
  if (r === "today") {
    const { data } = await supabase.from("shifts").select("id").eq("status","open")
      .order("opened_at",{ascending:false}).limit(1);
    return (data ?? []).map(s => s.id);
  }
  const [from, to] = bounds;
  const { data } = await supabase.from("shifts").select("id")
    .gte("business_day", from.toISOString().slice(0,10))
    .lte("business_day", to.toISOString().slice(0,10));
  return (data ?? []).map(s => s.id);
}

export function rangeLabel(r: DashRange): string {
  return r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "This week" : r === "month" ? "This month" : "Custom range";
}
