import type { DateRange } from "react-day-picker";

export type DateRangeStep = {
  range: DateRange;
  complete: boolean;
};

/**
 * A range always takes two deliberate clicks. The first click only stages the
 * start date; the second click completes a normalized start/end range.
 */
export function advanceDateRange(start: Date | undefined, clicked: Date): DateRangeStep {
  if (!start) {
    return { range: { from: clicked, to: undefined }, complete: false };
  }

  return clicked.getTime() < start.getTime()
    ? { range: { from: clicked, to: start }, complete: true }
    : { range: { from: start, to: clicked }, complete: true };
}
