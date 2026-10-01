import { Printer } from "lucide-react";
import { usePrintQueueStatus } from "@/lib/native-print-queue";

/** Small, non-blocking hint while tickets wait for a printer. Retries are automatic. */
export function PrintQueueStatus() {
  const { pending, oldestSeconds } = usePrintQueueStatus();
  if (pending === 0 || oldestSeconds < 15) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
      <Printer className="h-3.5 w-3.5 animate-pulse" />
      <span>{pending} ticket{pending === 1 ? "" : "s"} printing…</span>
    </div>
  );
}
