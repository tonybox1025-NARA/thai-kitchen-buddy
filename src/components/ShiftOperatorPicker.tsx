import { Button } from "@/components/ui/button";

export const SHIFT_OPERATOR_NAMES = ["THA", "GIFT", "TANNIE", "JAY", "TONY"] as const;
export type ShiftOperatorName = (typeof SHIFT_OPERATOR_NAMES)[number];

export function ShiftOperatorPicker({
  value,
  onChange,
}: {
  value: ShiftOperatorName | "";
  onChange: (name: ShiftOperatorName) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold">Select employee / เลือกพนักงาน</p>
        <p className="text-sm text-muted-foreground">Choose the employee responsible for this shift action.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SHIFT_OPERATOR_NAMES.map((name) => (
          <Button
            key={name}
            type="button"
            variant={value === name ? "default" : "outline"}
            className="h-14 text-base font-bold"
            onClick={() => onChange(name)}
          >
            {name}
          </Button>
        ))}
      </div>
    </div>
  );
}
