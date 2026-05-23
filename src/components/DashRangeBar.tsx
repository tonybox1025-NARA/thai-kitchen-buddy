import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import type { DashRange } from "@/lib/dash-range";

type Props = {
  range: DashRange;
  onRange: (r: DashRange) => void;
  custom?: DateRange;
  onCustom: (r: DateRange | undefined) => void;
};

export function DashRangeBar({ range, onRange, custom, onCustom }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const customLabel = custom?.from
    ? custom.to && custom.to.getTime() !== custom.from.getTime()
      ? `${format(custom.from, "dd MMM")} – ${format(custom.to, "dd MMM yyyy")}`
      : format(custom.from, "dd MMM yyyy")
    : "Custom range";

  return (
    <div className="flex gap-2 flex-wrap">
      {(["today","yesterday","week","month"] as const).map((r) => (
        <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => onRange(r)}>
          {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "week" ? "This week" : "This month"}
        </Button>
      ))}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant={range === "custom" ? "default" : "outline"}
            className={cn(!custom?.from && "text-muted-foreground")}>
            <CalendarIcon className="h-3.5 w-3.5 mr-1" />
            {range === "custom" ? customLabel : "Custom range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar mode="range" selected={custom}
            onSelect={(r) => { onCustom(r); onRange("custom"); if (r?.from && r?.to) setPickerOpen(false); }}
            numberOfMonths={2} initialFocus className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
