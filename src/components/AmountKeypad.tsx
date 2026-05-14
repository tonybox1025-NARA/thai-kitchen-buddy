import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";
import { thb } from "@/lib/format";

type Props = {
  value: number;
  onChange: (n: number) => void;
};

export function AmountKeypad({ value, onChange }: Props) {
  const [raw, setRaw] = useState<string>(value > 0 ? String(Math.round(value)) : "");

  const commit = (next: string) => {
    const trimmed = next.replace(/^0+(?=\d)/, "").slice(0, 9);
    setRaw(trimmed);
    onChange(trimmed === "" ? 0 : Number(trimmed));
  };

  const press = (d: string) => commit(raw + d);
  const back = () => commit(raw.slice(0, -1));
  const clear = () => commit("");

  return (
    <div className="w-full">
      <div className="h-14 mb-3 flex items-center justify-end px-4 rounded-md border bg-muted/30 text-2xl font-semibold tabular-nums">
        {thb(Number(raw || 0))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <Button key={d} type="button" variant="outline" size="lg" className="h-14 text-xl font-semibold" onClick={() => press(d)}>{d}</Button>
        ))}
        <Button type="button" variant="outline" size="lg" className="h-14 text-base font-semibold" onClick={() => press("00")}>00</Button>
        <Button type="button" variant="outline" size="lg" className="h-14 text-xl font-semibold" onClick={() => press("0")}>0</Button>
        <Button type="button" variant="outline" size="lg" className="h-14" onClick={back}><Delete className="h-5 w-5" /></Button>
      </div>
      <Button type="button" variant="ghost" size="sm" className="w-full mt-2" onClick={clear}>Clear</Button>
    </div>
  );
}
