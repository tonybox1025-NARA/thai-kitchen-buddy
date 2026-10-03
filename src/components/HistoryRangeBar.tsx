import { useState } from "react";
import type { ReactNode } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { advanceDateRange } from "@/lib/date-range-selection";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type HistoryRange = "today" | "yesterday" | "week" | "month" | "custom";

type Props = {
  range: HistoryRange;
  onRange: (range: HistoryRange) => void;
  custom?: DateRange;
  onCustom: (range: DateRange | undefined) => void;
  trailing?: ReactNode;
};

/** Shared report picker: the first click stages a start; the second applies and closes. */
export function HistoryRangeBar({ range, onRange, custom, onCustom, trailing }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [rangeStart, setRangeStart] = useState<Date>();
  const [draft, setDraft] = useState<DateRange>();

  const setPickerOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setRangeStart(undefined);
      setDraft(undefined);
    }
  };
  const customLabel = custom?.from
    ? custom.to && custom.to.getTime() !== custom.from.getTime()
      ? `${format(custom.from, "dd MMM")} – ${format(custom.to, "dd MMM yyyy")}`
      : format(custom.from, "dd MMM yyyy")
    : t("custom_range");
  const labels: Record<Exclude<HistoryRange, "custom">, string> = {
    today: t("today"),
    yesterday: t("yesterday"),
    week: t("this_week"),
    month: t("this_month"),
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["today", "yesterday", "week", "month"] as const).map((value) => (
        <Button key={value} size="sm" variant={range === value ? "default" : "outline"} onClick={() => onRange(value)}>
          {labels[value]}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant={range === "custom" ? "default" : "outline"} className={cn(!custom?.from && "text-muted-foreground")}>
            <CalendarIcon className="mr-1 h-3.5 w-3.5" />
            {range === "custom" ? customLabel : t("custom_range")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={draft ?? custom}
            onDayClick={(clicked) => {
              const step = advanceDateRange(rangeStart, clicked);
              setDraft(step.range);
              if (!step.complete) {
                setRangeStart(clicked);
                return;
              }
              onCustom(step.range);
              onRange("custom");
              setPickerOpen(false);
            }}
            numberOfMonths={2}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
      {trailing}
    </div>
  );
}
