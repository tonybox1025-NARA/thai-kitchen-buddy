import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Props = {
  title?: string;
  onSubmit: (pin: string) => Promise<void> | void;
  onCancel?: () => void;
  error?: string | null;
  maxLen?: number;
};

export function PinKeypad({ title, onSubmit, onCancel, error, maxLen = 6 }: Props) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const press = (d: string) => {
    if (pin.length < maxLen) setPin(pin + d);
  };
  const back = () => setPin(pin.slice(0, -1));
  const submit = async () => {
    if (pin.length < 4) return;
    setBusy(true);
    try { await onSubmit(pin); setPin(""); } finally { setBusy(false); }
  };

  return (
    <div className="w-full max-w-sm mx-auto">
      <h3 className="text-xl font-semibold text-center mb-4">{title ?? t("enter_pin")}</h3>
      <div className="flex justify-center gap-3 mb-4 h-12 items-center">
        {Array.from({ length: maxLen }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 ${i < pin.length ? "bg-primary border-primary" : "border-muted-foreground/40"}`}
          />
        ))}
      </div>
      {error && <p className="text-destructive text-sm text-center mb-3">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <Button key={d} variant="outline" size="lg" className="h-16 text-2xl font-semibold" onClick={() => press(d)}>{d}</Button>
        ))}
        <Button variant="outline" size="lg" className="h-16" onClick={back}><Delete className="h-5 w-5" /></Button>
        <Button variant="outline" size="lg" className="h-16 text-2xl font-semibold" onClick={() => press("0")}>0</Button>
        <Button size="lg" className="h-16" onClick={submit} disabled={pin.length < 4 || busy}>{t("confirm")}</Button>
      </div>
      {onCancel && (
        <Button variant="ghost" className="w-full mt-3" onClick={onCancel}>{t("cancel")}</Button>
      )}
    </div>
  );
}
